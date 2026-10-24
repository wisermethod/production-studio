import copy
import contextlib
import io
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch
from support import TOOL, ffmpeg, plan, recording, save, temporary
import plan as plans
import timeline
from processes import Runner
from paths import TimelineError


@unittest.skipIf(sys.version_info < (3, 11), "render requires Python 3.11 or newer")
@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg and ffprobe are required for generated media")
class MediaRefusalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = temporary()
        cls.root = Path(cls.temp.name)
        recording(cls.root / "a.mp4", frames=60)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def refused(self, value, message):
        with temporary() as d:
            root = Path(d)
            for source in value["sources"]:
                source["path"] = str(self.root / source["path"])
            p = save(root, value)
            before = sorted(root.iterdir())
            out, err = io.StringIO(), io.StringIO()
            with patch.object(timeline.install, "ensure") as ensure, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                status = timeline.main(["render", "--plan", str(p), "--output", str(root / "out"), "--install"])
            self.assertEqual((status, out.getvalue()), (1, ""))
            self.assertIn(message, err.getvalue())
            self.assertEqual(before, sorted(root.iterdir()))
            ensure.assert_not_called()

    def test_audio_refused(self):
        target = self.root / "audio.mp4"
        ffmpeg(["-i", str(self.root / "a.mp4"), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "2", "-c:v", "copy", "-c:a", "aac", str(target)])
        self.refused(plan(target.name), "has an audio stream")

    def test_wrong_rate_refused(self):
        recording(self.root / "rate.mp4", fps=25, frames=50)
        self.refused(plan("rate.mp4"), "rate differs from fps")

    def test_vfr_refused(self):
        ffmpeg(["-i", str(self.root / "a.mp4"), "-vf", "select=not(eq(mod(n\\,7)\\,1))", "-fps_mode", "vfr", "-c:v", "libx264", str(self.root / "vfr.mp4")])
        self.refused(plan("vfr.mp4"), "variable")

    def test_vfr_timestamps_with_matching_rates(self):
        data = plans.probe(self.root / "a.mp4", Runner(), self.root, "ffprobe")
        frames = [f for f in data["frames"] if f.get("media_type") == "video"]
        frames[2]["best_effort_timestamp"] += 1
        with self.assertRaisesRegex(TimelineError, "variable frame rate"):
            plans.media_info(data, "planted", 30)

    def test_size_mismatch_refused(self):
        recording(self.root / "size.mp4", size="98x64", frames=60)
        p = plan()
        p["sources"].append({"id": "b", "path": "size.mp4"})
        self.refused(p, "different frame sizes")

    def test_segment_outside_refused(self):
        p = plan()
        p["segments"][0]["end"] = 61
        self.refused(p, "outside its source")

    def test_untagged_and_partial_accepted(self):
        data = plans.probe(self.root / "a.mp4", Runner(), self.root, "ffprobe")
        for missing in (("color_transfer",), ("color_primaries", "color_transfer", "color_space")):
            current = copy.deepcopy(data)
            for key in missing:
                current["streams"][0].pop(key, None)
            info = plans.media_info(current, "untagged", 30)
            self.assertTrue(info["assumed_bt709"])
            self.assertEqual(info["frames"], 60)
        self.assertFalse(plans.media_info(data, "tagged", 30)["assumed_bt709"])


for _tag, _filter in (("color_primaries", "colour_primaries=9"), ("color_transfer", "transfer_characteristics=16"), ("color_space", "matrix_coefficients=9")):
    def _test(self, tag=_tag, bitfilter=_filter):
        name = tag + ".mp4"
        ffmpeg(["-i", str(self.root / "a.mp4"), "-c:v", "copy", "-bsf:v", "h264_metadata=" + bitfilter, str(self.root / name)])
        self.refused(plan(name), tag + " is not BT.709")
    setattr(MediaRefusalTests, "test_non709_" + _tag, _test)
