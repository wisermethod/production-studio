"""Closed frame-plan schema and read-only media validation."""
import json
from fractions import Fraction
from pathlib import Path
import re
from paths import TimelineError, screen


# One trim per segment runs inside Kinocut 1.16.1's 600-second limit per FFmpeg step (kinocut/limits.py).
MAX_SEGMENT_FRAMES = 18000
IDENTITY = [[65536, 0, 0], [0, 65536, 0], [0, 0, 1073741824]]


def identity_matrix(text):
    try:
        rows = [[int(v) for v in line.split(":", 1)[1].split()] for line in str(text).strip().splitlines()]
    except (IndexError, ValueError):
        return False
    return rows == IDENTITY


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise TimelineError("duplicate key " + key + "; remove the duplicate")
        result[key] = value
    return result


def fields(obj, keys, label):
    if not isinstance(obj, dict):
        raise TimelineError(label + " must be an object; use the plan schema")
    for key in obj:
        if key not in keys:
            raise TimelineError("unknown key " + label + "." + key + "; remove it")
    for key in keys:
        if key not in obj:
            raise TimelineError("missing field " + label + "." + key + "; supply it")


def integer(value, label, minimum):
    if type(value) is not int or value < minimum:
        raise TimelineError(label + " must be an integer >= " + str(minimum) + "; use the plan schema")


def identifier(value, label, used):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9-]+", value):
        raise TimelineError(label + " must use lowercase letters, digits and hyphens; use a valid id")
    if value in used:
        raise TimelineError("duplicate id " + value + "; use unique ids")
    used.add(value)


def load(path, tool):
    try:
        plan = json.loads(path.read_text(), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError, OSError):
        raise TimelineError("plan is not readable JSON; repair the plan file") from None
    fields(plan, ("fps", "sources", "segments"), "plan")
    integer(plan["fps"], "fps", 1)
    for key in ("sources", "segments"):
        if not isinstance(plan[key], list) or not plan[key]:
            raise TimelineError(key + " must be a nonempty list; supply the plan entries")
    if len(plan["segments"]) > 63:
        raise TimelineError("plan has more than 63 segments; use at most 63 trims plus one Kinocut merge")
    ids, source_ids, sources = set(), set(), {}
    for source in plan["sources"]:
        fields(source, ("id", "path"), "source")
        identifier(source["id"], "source.id", ids)
        source_ids.add(source["id"])
        value = source["path"]
        if not isinstance(value, str) or not value:
            raise TimelineError("source.path must be a nonempty path; supply the recording")
        # Joining does not open the caller's path; the screen resolves before use.
        sources[source["id"]] = screen(str(path.parent / value), "source " + source["id"], tool)
    segment_ids = ids
    for segment in plan["segments"]:
        fields(segment, ("id", "source", "start", "end", "speed"), "segment")
        identifier(segment["id"], "segment.id", segment_ids)
        if not isinstance(segment["source"], str) or segment["source"] not in source_ids:
            raise TimelineError("segment.source is unknown; name a declared source id")
        integer(segment["start"], "segment.start", 0)
        integer(segment["end"], "segment.end", 1)
        integer(segment["speed"], "segment.speed", 1)
        if segment["end"] <= segment["start"]:
            raise TimelineError("segment " + segment["id"] + " is empty or reversed; use start < end")
        if (segment["end"] - segment["start"]) % segment["speed"]:
            raise TimelineError("segment " + segment["id"] + " length is not divisible by speed; align its end frame")
        if (segment["end"] - segment["start"]) // segment["speed"] > MAX_SEGMENT_FRAMES:
            raise TimelineError("segment " + segment["id"] + " has more output frames than the at most 18000 that fit "
                                "Kinocut's 600-second limit per FFmpeg step; split it into shorter segments")
    return plan, sources


def probe(path, runner, cwd, ffprobe):
    result = runner.run([ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-show_packets",
                         "-show_entries", "stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,time_base,color_space,color_transfer,color_primaries,color_range:stream_side_data=rotation,displaymatrix:packet=codec_type,stream_index,pts:format=duration",
                         "-of", "json", str(path)], cwd, reads=[path])
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise TimelineError("ffprobe returned invalid JSON; check ffprobe -version and the recording") from None


def media_info(data, source_id, fps):
    label = "source " + source_id
    streams = data.get("streams", [])
    if any(s.get("codec_type") == "audio" for s in streams):
        raise TimelineError(label + " has an audio stream; supply a silent recording")
    videos = [s for s in streams if s.get("codec_type") == "video"]
    if len(videos) != 1:
        raise TimelineError(label + " must have one video stream; supply one constant-rate recording")
    video = videos[0]
    if video.get("pix_fmt") != "yuv420p":
        raise TimelineError(label + " pixel format " + str(video.get("pix_fmt", "unknown")) + " is not yuv420p; supply yuv420p media")
    if video.get("color_range") == "pc":
        raise TimelineError(label + " color_range pc is full range; supply TV-range media")
    for side in video.get("side_data_list", []):
        if "rotation" in side or "displaymatrix" in side or "Display" in str(side.get("side_data_type", "")):
            # A flip reads as rotation 0, so only the identity matrix itself is accepted.
            try:
                zero = Fraction(str(side["rotation"])) == 0
            except (KeyError, ValueError, ZeroDivisionError):
                zero = False
            if not (zero and identity_matrix(side.get("displaymatrix"))):
                raise TimelineError(label + " has a rotation, flip or unreadable display matrix; supply unrotated, unflipped media")
    try:
        rate = Fraction(video["r_frame_rate"])
        average = Fraction(video["avg_frame_rate"])
        base = Fraction(video["time_base"])
        packets = [p for p in data["packets"] if p.get("codec_type") == "video" and p.get("stream_index") == video["index"]]
        ticks = sorted(int(p["pts"]) for p in packets)
        if not packets:
            raise ValueError()
        if rate != fps or average != fps:
            raise TimelineError(label + " rate differs from fps or is variable; supply constant-rate media at plan fps")
        if any((b - a) * base != Fraction(1, fps) for a, b in zip(ticks, ticks[1:])):
            raise TimelineError(label + " is variable frame rate; supply constant-rate media at plan fps")
        size = [int(video["width"]), int(video["height"])]
        if any(n <= 0 or n % 2 for n in size):
            raise TimelineError(label + " size must be positive and even for yuv420p; supply even dimensions")
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        raise TimelineError(label + " has unreadable frame metadata; supply a valid constant-rate recording") from None
    tags = {k: video.get(k, "unknown") for k in ("color_primaries", "color_transfer", "color_space", "color_range")}
    for key in ("color_primaries", "color_transfer", "color_space"):
        if tags[key] not in ("bt709", "unknown", "unspecified", None):
            raise TimelineError(label + " " + key + " is not BT.709; supply BT.709 or untagged media")
    return {"frames": len(packets), "size": size, "rate": str(rate), "tags": tags,
            "assumed_bt709": any(tags[k] != "bt709" for k in ("color_primaries", "color_transfer", "color_space")) or tags["color_range"] in ("unknown", "unspecified", None),
            "duration": float(data["format"]["duration"])}


def validate_media(plan, sources, runner, cwd, ffprobe):
    info = {key: media_info(probe(path, runner, cwd, ffprobe), key, plan["fps"]) for key, path in sources.items()}
    sizes = {tuple(i["size"]) for i in info.values()}
    if len(sizes) != 1:
        raise TimelineError("sources have different frame sizes; supply recordings of the same size")
    for segment in plan["segments"]:
        if segment["end"] > info[segment["source"]]["frames"]:
            raise TimelineError("segment " + segment["id"] + " is outside its source; use end <= source frame count")
    return info
