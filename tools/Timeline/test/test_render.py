import contextlib
import hashlib
import copy
import io
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import unittest
from unittest.mock import patch
from support import TOOL, READY, REASON, call, ffmpeg, frames, recording, save, temporary
import install
import timeline
import engine
from paths import TimelineError
from processes import Runner, digest, run_kinocut


@unittest.skipUnless(READY, REASON)
class RenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(install.site_for(install.cache_for(TOOL))))
        cls.temp = temporary()
        cls.root = Path(cls.temp.name).resolve()
        recording(cls.root / "a.mp4")
        recording(cls.root / "b.mp4", offset=256)
        cls.plan = {"fps": 30, "sources": [{"id": "a", "path": "a.mp4"}, {"id": "b", "path": "b.mp4"}],
                    "segments": [{"id": "one", "source": "a", "start": 7, "end": 38, "speed": 1},
                                 {"id": "two", "source": "b", "start": 10, "end": 70, "speed": 2},
                                 {"id": "three", "source": "a", "start": 9, "end": 99, "speed": 3},
                                 {"id": "four", "source": "b", "start": 16, "end": 140, "speed": 4}]}
        cls.plan_path = save(cls.root, cls.plan)
        cls.output = cls.root / "cut"
        cls.result = call(["render", "--plan", str(cls.plan_path), "--output", str(cls.output)])
        if cls.result.returncode:
            raise AssertionError(cls.result.stderr)
        cls.success = json.loads(cls.result.stdout)
        cls.record = json.loads((cls.output / "record.json").read_text())

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_render_command_and_four_files(self):
        self.assertEqual(self.result.returncode, 0)
        self.assertEqual(set(p.name for p in self.output.iterdir()), {"cut.mp4", "cut.otio", "kinocut-receipt.json", "record.json"})
        self.assertEqual(self.success["frame_count"], 122)
        self.assertAlmostEqual(self.success["duration"], 122 / 30, places=5)
        self.assertEqual(self.success["assumed_bt709"], [])
        self.assertEqual(list(self.root.glob(".timeline-work-*")), [])

    def test_exact_frames_speeds_and_quality(self):
        original = {s["id"]: frames(self.root / s["path"]) for s in self.plan["sources"]}
        output = frames(self.output / "cut.mp4")
        expected = [original[s["source"]][n] for s in self.plan["segments"] for n in range(s["start"], s["end"], s["speed"])]
        self.assertEqual(len(output), len(expected))
        for n, (a, b) in enumerate(zip(expected, output)):
            mse = sum((x - y) ** 2 for x, y in zip(a, b)) / len(a)
            psnr = 99 if mse == 0 else 10 * math.log10(255 ** 2 / mse)
            self.assertGreaterEqual(psnr, 40, "output frame %d" % n)

    def test_bt709_stream_and_container(self):
        expected = {"color_primaries": "bt709", "color_transfer": "bt709", "color_space": "bt709", "color_range": "tv"}
        self.assertEqual(self.success["tags"], expected)
        data = (self.output / "cut.mp4").read_bytes()
        index = data.index(b"colrnclx") + 8
        prim, transfer, matrix, full = struct.unpack(">HHHB", data[index:index+7])
        self.assertEqual((prim, transfer, matrix, full >> 7), (1, 1, 1, 0))
        stream = self.root / "stream.h264"
        ffmpeg(["-i", str(self.output / "cut.mp4"), "-c:v", "copy", "-bsf:v", "h264_mp4toannexb", "-f", "h264", str(stream)])
        result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=color_primaries,color_transfer,color_space,color_range", "-of", "json", str(stream)], capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout)["streams"][0], expected)

    def test_otio_readback(self):
        import opentimelineio as otio
        tl = otio.adapters.read_from_file(str(self.output / "cut.otio"))
        self.assertEqual((tl.global_start_time.value, tl.global_start_time.rate), (0, 30))
        self.assertEqual(len(tl.tracks), 1)
        self.assertEqual(tl.tracks[0].kind, otio.schema.TrackKind.Video)
        self.assertEqual(len(tl.tracks[0]), 4)
        position = 0
        for clip, segment in zip(tl.tracks[0], self.plan["segments"]):
            length = (segment["end"] - segment["start"]) // segment["speed"]
            self.assertEqual(clip.name, segment["id"])
            self.assertEqual(clip.media_reference.target_url, (self.root / (segment["source"] + ".mp4")).as_uri())
            self.assertEqual(clip.media_reference.available_range.duration.value, 180)
            self.assertEqual(clip.source_range.start_time.value, segment["start"])
            self.assertEqual(clip.source_range.duration.value, length)
            self.assertEqual(clip.range_in_parent().start_time.value, position)
            self.assertEqual(len(clip.effects), int(segment["speed"] != 1))
            if clip.effects:
                self.assertEqual(clip.effects[0].time_scalar, segment["speed"])
            position += length
        self.assertEqual(tl.duration().value, 122)

    def test_record_hashes_and_receipt(self):
        record = self.record
        self.assertEqual(record["plan"], self.plan)
        self.assertEqual(record["plan_sha256"], digest(self.plan_path))
        for source in record["sources"]:
            self.assertEqual(source["sha256"], digest(Path(source["path"])))
            self.assertEqual((source["frames"], source["size"], source["rate"]), (180, [96, 64], "30"))
        for name, value in record["files"].items():
            self.assertEqual(value, digest(self.output / name))
        for name, info in self.success["files"].items():
            self.assertEqual(info["sha256"], digest(self.output / name))
        self.assertEqual(record["output"]["sha256"], digest(self.output / "cut.mp4"))
        receipt = json.loads((self.output / "kinocut-receipt.json").read_text())
        self.assertEqual(receipt["status"], "completed")
        self.assertEqual([s["op"] for s in receipt["steps"]], ["trim"] * 4 + ["merge"])
        for step in receipt["steps"]:
            self.assertTrue(step["input_hashes"])
            self.assertRegex(step["output_hash"], r"^sha256:[a-f0-9]{64}$")
        self.assertEqual([s["encode_passes"] for s in record["segments"]], [2, 2, 2, 2])
        self.assertEqual([s["lossy_encodes"] for s in record["segments"]], [0, 0, 0, 0])
        self.assertEqual(record["versions"]["kinocut"], "1.16.1")
        self.assertEqual(record["versions"]["opentimelineio"], "0.18.1")
        for process in record["processes"]:
            self.assertEqual(process["exit_status"], 0)
            self.assertTrue(all(not a.startswith("../") for a in process["arguments"]))

    def test_record_every_process_file_hash_before_cleanup(self):
        output = self.root / "hash-run"
        checked = []
        original_remove = shutil.rmtree
        def inspect(directory, *args, **kwargs):
            directory = Path(directory)
            if directory.name.startswith(".timeline-work-") and output.exists():
                record = json.loads((output / "record.json").read_text())
                receipt = json.loads((output / "kinocut-receipt.json").read_text())
                for step in receipt["steps"]:
                    self.assertEqual("sha256:" + digest(directory / step["output"]), step["output_hash"])
                for proc in record["processes"]:
                    for item in proc["read"] + proc["wrote"]:
                        value = item["path"]
                        path = output / value[7:] if value.startswith("output/") else TOOL / value[5:] if value.startswith("tool/") else directory / value
                        self.assertEqual(digest(path), item["sha256"])
                        checked.append(path)
            return original_remove(directory, *args, **kwargs)
        with patch.object(engine.shutil, "rmtree", side_effect=inspect), contextlib.redirect_stdout(io.StringIO()):
            code = timeline.main(["render", "--plan", str(self.plan_path), "--output", str(output)])
        self.assertEqual(code, 0)
        self.assertGreater(len(checked), 20)

    def test_repeated_renders_decode_identically(self):
        other = self.root / "repeat"
        result = call(["render", "--plan", str(self.plan_path), "--output", str(other)])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([hashlib.sha256(f).hexdigest() for f in frames(self.output / "cut.mp4")],
                         [hashlib.sha256(f).hexdigest() for f in frames(other / "cut.mp4")])

    def test_cleanup_after_failure(self):
        output = self.root / "fail"
        with patch.object(engine, "run_kinocut", side_effect=TimelineError("planted failure")), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = timeline.main(["render", "--plan", str(self.plan_path), "--output", str(output)])
        self.assertEqual(code, 1)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob(".timeline-work-*")), [])

    def test_copy_fallback(self):
        output = self.root / "copied"
        with patch.object(engine.os, "link", side_effect=OSError("synthetic cross-device link")), contextlib.redirect_stdout(io.StringIO()):
            code = timeline.main(["render", "--plan", str(self.plan_path), "--output", str(output)])
        self.assertEqual(code, 0)
        record = json.loads((output / "record.json").read_text())
        self.assertEqual([s["staging"] for s in record["sources"]], ["copy", "copy"])
        self.assertEqual(frames(output / "cut.mp4"), frames(self.output / "cut.mp4"))

    def test_readback_missing_frames_and_tags(self):
        from plan import probe
        data = probe(self.output / "cut.mp4", Runner(), self.root, "ffprobe")
        for field in ("frames", "tags"):
            broken = copy.deepcopy(data)
            if field == "frames":
                broken["packets"].pop()
            else:
                broken["streams"][0].pop("color_transfer")
            with self.assertRaises(TimelineError):
                engine.verify_output(broken, 122, 30)

    def test_hyperframes_block_and_control(self):
        with temporary() as d:
            root = Path(d).resolve()
            work = root / "nested"
            work.mkdir()
            binary = root / "node_modules/.bin/hyperframes"
            binary.parent.mkdir(parents=True)
            marker = root / "marker"
            binary.write_text("#!/bin/sh\nprintf planted > '" + str(marker) + "'\n")
            binary.chmod(0o700)
            code = "import subprocess; from kinocut.hyperframes_engine import _hyperframes_command_prefix; subprocess.run(_hyperframes_command_prefix(),check=True)"
            args = [str(install.cache_for(TOOL) / "bin/python3"), "-c", code]
            with self.assertRaises(TimelineError):
                run_kinocut(args, work, Runner())
            self.assertFalse(marker.exists())
            from processes import child_env
            env = child_env(work)
            env.pop("MCP_VIDEO_HYPERFRAMES_COMMAND")
            Runner().run(args, work, env=env)
            self.assertTrue(marker.exists())
