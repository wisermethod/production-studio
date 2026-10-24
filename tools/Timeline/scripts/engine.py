"""Render the validated plan, verify readback and publish four complete files."""
import importlib.metadata
import json
import os
import re
from pathlib import Path
import shutil
import sys
import tempfile
from fractions import Fraction
from paths import TimelineError, screen
from plan import media_info, probe
from processes import child_env, digest, run_kinocut
from encoding import ENCODE_ARGS


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_otio(plan, sources, info, path):
    import opentimelineio as otio
    fps = plan["fps"]
    def time(n):
        return otio.opentime.RationalTime(n, fps)
    timeline = otio.schema.Timeline(name="Timeline cut", global_start_time=time(0))
    track = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
    timeline.tracks.append(track)
    for segment in plan["segments"]:
        key = segment["source"]
        length = (segment["end"] - segment["start"]) // segment["speed"]
        reference = otio.schema.ExternalReference(target_url=sources[key].as_uri(),
            available_range=otio.opentime.TimeRange(time(0), time(info[key]["frames"])))
        clip = otio.schema.Clip(name=segment["id"], media_reference=reference,
            source_range=otio.opentime.TimeRange(time(segment["start"]), time(length)))
        if segment["speed"] != 1:
            clip.effects.append(otio.schema.LinearTimeWarp(name="speed", time_scalar=segment["speed"]))
        track.append(clip)
    otio.adapters.write_to_file(timeline, str(path))


def verify_output(data, expected, fps):
    info = media_info(data, "output", fps)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    if info["frames"] != expected:
        raise TimelineError("output frame count differs from plan; output withheld, check FFmpeg and pinned Kinocut")
    if info["tags"] != {"color_primaries": "bt709", "color_transfer": "bt709", "color_space": "bt709", "color_range": "tv"}:
        raise TimelineError("output BT.709 tags are missing; output withheld, check FFmpeg")
    if video.get("codec_name") != "h264" or video.get("pix_fmt") != "yuv420p":
        raise TimelineError("output codec is not H.264 yuv420p; output withheld, check libx264")
    return info


def frame_hashes(path, size, runner, work, ffmpeg):
    """Decode once without scaling; retain each frame's size and MD5."""
    result = runner.run([ffmpeg, "-v", "info", "-xerror", "-nostdin", "-protocol_whitelist", "file,pipe",
                         "-i", str(path), "-map", "0:v:0", "-an", "-fps_mode", "passthrough",
                         "-vf", "showinfo=checksum=0", "-noautoscale", "-c:v", "rawvideo", "-pix_fmt", "yuv420p", "-f", "framemd5", "-"],
                        work, reads=[path], env=child_env(work), check=False)
    dimensions = re.findall(r"\[Parsed_showinfo_\d+ @ [^\]]+\]\s+n:\s*\d+[^\r\n]*?\bs:(\d+)x(\d+)",
                            result.stderr.decode("utf-8", errors="replace"))
    if any([int(w), int(h)] != size for w, h in dimensions):
        raise TimelineError("frame size changes in " + path.name + "; output withheld, supply fixed-size yuv420p media")
    if result.returncode:
        raise TimelineError("frame decode failed for " + path.name + "; output withheld, check the recording and FFmpeg")
    frames = []
    try:
        for line in result.stdout.decode("ascii").splitlines():
            if not line or line.startswith("#"):
                continue
            fields = [field.strip() for field in line.split(",")]
            if len(fields) != 6 or len(fields[5]) != 32:
                raise ValueError()
            frames.append((int(fields[4]), fields[5]))
    except (ValueError, UnicodeError):
        raise TimelineError("unreadable frame hashes; output withheld, check FFmpeg") from None
    expected_size = size[0] * size[1] * 3 // 2
    if any(length != expected_size for length, _ in frames):
        raise TimelineError("frame size changes in " + path.name + "; output withheld, supply fixed-size yuv420p media")
    if len(dimensions) != len(frames):
        raise TimelineError("unreadable frame hashes; output withheld, check FFmpeg")
    return frames


def compare_frames(plan, sources, info, final, runner, work, ffmpeg):
    originals = {key: frame_hashes(path, info[key]["size"], runner, work, ffmpeg) for key, path in sources.items()}
    output = frame_hashes(final, next(iter(info.values()))["size"], runner, work, ffmpeg)
    position = 0
    for segment in plan["segments"]:
        for source_frame in range(segment["start"], segment["end"], segment["speed"]):
            source = originals[segment["source"]]
            if position >= len(output) or source_frame >= len(source) or output[position] != source[source_frame]:
                raise TimelineError("frame mismatch at segment " + segment["id"] + ", output frame " + str(position) +
                                    ", source frame " + str(source_frame) +
                                    "; output withheld, check the source and frame selection")
            position += 1
    if position != len(output):
        raise TimelineError("output frame count differs from plan; output withheld, check frame selection")
    return {"frames_compared": position, "all_equal": True}


def render(tool, plan_path, plan, sources, info, output, cache, runner, programs):
    work = Path(tempfile.mkdtemp(prefix=".timeline-work-", dir=str(output.parent)))
    try:
        stage = work / "deliverable"
        stage.mkdir()
        for name in ("home", "cache", "tmp"):
            (work / name).mkdir()
        linked, source_records = {}, []
        for index, (key, source) in enumerate(sources.items()):
            target = work / ("source-%d%s" % (index, source.suffix or ".mp4"))
            try:
                os.link(source, target)
                method = "hard-link"
            except OSError:
                shutil.copyfile(source, target)
                method = "copy"
            linked[key] = target
            source_records.append({"id": key, "path": str(source), "sha256": digest(source), **info[key],
                                   "staged": target.name, "staging": method})
        cut_sources = []
        ops, lengths, passes, clips = [], [], [], []
        for index, segment in enumerate(plan["segments"]):
            length = (segment["end"] - segment["start"]) // segment["speed"]
            lengths.append(length)
            clip = work / ("clip-%d.mp4" % index)
            # Declare the frames BT.709 TV range, as an untagged source is taken to be, so FFmpeg converts nothing.
            vf = "setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,trim=start_frame=%d:end_frame=%d" % (
                segment["start"], segment["end"])
            if segment["speed"] > 1:
                vf += ",select=not(mod(n\\,%d))" % segment["speed"]
            vf += ",setpts=N/(%d*TB)" % plan["fps"]
            runner.run([programs["ffmpeg"], "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", str(linked[segment["source"]]),
                        "-map", "0:v:0", "-an", "-vf", vf,
                        "-fps_mode", "passthrough", *ENCODE_ARGS, "-movflags", "+faststart+write_colr", str(clip)],
                       work, reads=[linked[segment["source"]]], writes=[clip], env=child_env(work))
            verify_output(probe(clip, runner, work, programs["ffprobe"]), length, plan["fps"])
            src = "clip%d" % index
            cut_sources.append({"id": src, "path": clip.name})
            clips.append(clip)
            ops.append({"id": "segment%d" % index, "op": "trim", "src": src, "start": 0,
                        "duration": float(Fraction(length, plan["fps"]))})
            passes.append({"id": segment["id"], "encode_passes": 2,
                           "lossy_encodes": 0})
        ops.append({"id": "merge", "op": "merge", "srcs": ["segment%d" % i for i in range(len(lengths))]})
        cutfile = work / "cutfile.json"
        dump(cutfile, {"name": "timeline", "version": 1, "sources": cut_sources, "ops": ops})
        raw = work / "merged.mp4"
        receipt = stage / "kinocut-receipt.json"
        run_kinocut([str(cache / "bin/python3"), "-B", str(tool / "scripts/kino_bridge.py"),
                     str(cutfile), str(raw), str(receipt)], work, runner,
                    reads=[cutfile, *clips, tool / "scripts/kino_bridge.py", tool / "scripts/encoding.py"],
                    writes=[raw, receipt])
        kino_receipt = json.loads(receipt.read_text())
        if kino_receipt.get("status") != "completed":
            raise TimelineError("Kinocut receipt is not completed; output withheld, check the pinned environment")
        final = stage / "cut.mp4"
        # No further encode: set H.264 VUI and MP4 colr metadata together.
        runner.run([programs["ffmpeg"], "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", str(raw), "-map", "0:v:0", "-an",
                    "-c:v", "copy", "-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
                    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
                    "-movflags", "+faststart+write_colr", str(final)], work, reads=[raw], writes=[final], env=child_env(work))
        output_info = verify_output(probe(final, runner, work, programs["ffprobe"]), sum(lengths), plan["fps"])
        comparison = compare_frames(plan, linked, info, final, runner, work, programs["ffmpeg"])
        otio = stage / "cut.otio"
        write_otio(plan, sources, info, otio)
        hashes = {name: digest(stage / name) for name in ("cut.mp4", "cut.otio", "kinocut-receipt.json")}
        record = {"version": "0.1.0", "plan": plan, "plan_sha256": digest(plan_path),
                  "sources": source_records, "segments": passes, "encoding_arguments": ENCODE_ARGS,
                  "versions": {"python": sys.version.split()[0], "kinocut": importlib.metadata.version("kinocut"),
                               "opentimelineio": importlib.metadata.version("OpenTimelineIO"), "ffmpeg": programs["ffmpeg_version"]},
                  "processes": runner.relative_records(work, output, tool), "frame_comparison": comparison,
                  "path_base": {"work": "removed hidden sibling", "output": str(output)},
                  "cutfile": {"sha256": digest(cutfile), "contents": json.loads(cutfile.read_text())},
                  "files": hashes, "output": {**output_info, "sha256": hashes["cut.mp4"]}}
        dump(stage / "record.json", record)
        hashes["record.json"] = digest(stage / "record.json")
        # Reserve the destination without replacing even an empty directory.
        screen(str(output), "--output", tool, destination=True)
        output.mkdir()
        try:
            for name in hashes:
                os.rename(stage / name, output / name)
        except BaseException:
            shutil.rmtree(output)
            raise
        return {"files": {name: {"path": str(output / name), "sha256": value} for name, value in hashes.items()},
                "frame_count": output_info["frames"], "duration": output_info["duration"], "tags": output_info["tags"],
                "assumed_bt709": [key for key, value in info.items() if value["assumed_bt709"]]}
    finally:
        shutil.rmtree(work)
