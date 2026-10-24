---
name: Timeline
type: tool
category: media
description: Cuts silent recordings to exact planned frames and writes a BT.709 video, an OpenTimelineIO timeline and processing records
version: 0.1.0
gaps:
  - Cutting a recording that carries audio
  - Slowing a segment down or changing its speed by other than a whole number
---

# Timeline

## Context

This tool does not capture or redact a recording; run `wiser/tools/Screen Capture/TOOL.md` first. It does not set loudness or make the final encode; the calling skill runs `wiser/tools/video-edit/TOOL.md` afterward. It renders no HTML or HyperFrames composition. This version provides no cutting of a recording that carries audio, and no slowing a segment down or changing its speed by other than a whole number.

Use it to cut one video from one or more silent screen recordings according to integer source-frame indices. It reaches no account and makes no network call except the consented package install. Follow the constitution's Writes for destinations and Behavioral Core when a dependency stops work.

Classifier seam: none.

## Inputs

Keep the requested cut and destination in `<cut_request>` and the supplied plan and recordings in `<source_material>`. Is the intended source, frame range or destination ambiguous? Yes: ask before running render. No: use the supplied plan.

Pass an absolute JSON plan path and a new absolute output directory whose parent already exists. Source paths may be absolute or relative to the plan's directory. Every path is screened and its resolved value used. The screen refuses private configuration filenames and a directory named `memory` by resolved spelling, including symbolic links to them; a hard link retains no other name for that check. Credential storage is also screened by device and inode, including hard links to its files. An output resolving inside this tool is refused. Sources must have one fixed-size video stream, no audio stream, a constant rate exactly equal to the plan's positive integer fps, and matching dimensions across sources. Dimensions must be even for yuv420p. A declared primaries, transfer or matrix tag must be BT.709; absent or unknown fields are taken as BT.709 and reported by source id. Only pixel format `yuv420p` is accepted. Full range (`color_range=pc`) and nonzero rotation or display matrices are refused. Absent range is taken as TV range and reported with the BT.709 assumption; source tags are recorded as read.

## Quick Start

Run from this tool's directory. Prove the interpreter with Dependencies before its first invocation.

```bash
python3 scripts/timeline.py help
python3 scripts/timeline.py check
```

Help works with Python 3.9 or newer and no packages. **Render requires an interpreter of Python 3.11 to 3.13 only.** If `python3` is outside that range, the agent runs the declared version check with an available supported interpreter, then prefixes render with that interpreter, for example:

```bash
python3.11 scripts/timeline.py render --plan /path/to/work/plan.json --output /path/to/work/cut
```

Does the command report `packages missing`? Yes: put the report to the person, then on their consent repeat that same command with `--install`; it installs and finishes the cut. No: read the JSON result or the named refusal below. `WISER_ALLOW_INSTALL=1` permits an unattended install. A consent marker for this plugin copy also permits it. `check` only surveys; read its fields, since its exit status is 0 even when requirements are absent.

## Dependencies

Python is the declared interpreter under `wiser/standards/script-contract.md` Runtimes. These are system dependencies, never installed by Timeline. A failed check follows that standard's System dependencies clause; preparation is in `SETUP.md`, package metadata in `NOTICE.md`.

| Dependency | Needed for | Presence check |
|------------|------------|----------------|
| Python 3.11 to 3.13 only, with venv and compatible binary wheels | Render and its pinned packages | `python3 -c 'import sys; print(sys.version.split()[0]); sys.exit(not (3, 11) <= sys.version_info[:2] <= (3, 13))'` prints the version and exits 0 |
| Python venv | Tool-local wheel environments | `python3 -m venv --help` prints usage |
| FFmpeg with libx264 | Frame selection, H.264 encoding, Kinocut operations and tag remux | `ffmpeg -hide_banner -encoders` lists `libx264` |
| ffprobe, supplied with FFmpeg | Source validation and output readback | `ffprobe -version` succeeds |

`check` reports Python's version and whether it is 3.11 to 3.13, FFmpeg and ffprobe paths and versions, FFmpeg's libx264 availability, and all 35 package pins in this interpreter's environment. It does no install and writes no consent marker. Package state is `absent`, `incomplete` or `complete`.

Kinocut 1.16.1 requires Python 3.11 or newer. OpenTimelineIO 0.18.1 provides binary wheels for Python 3.9 to 3.13 on Apple Silicon macOS, Linux x86_64 and aarch64, and Windows; it provides none for Python 3.14 or Intel Macs. The supported render range is therefore Python 3.11 to 3.13 only, on those wheel platforms.

## Configuration

None: no account, credential or configuration file. `--env` is refused. Install consent follows `wiser/tools/RUNNING.md`. The nearest ancestor holding `tools/AGENTS.md` is the plugin root; its `.wiser-consent` names its realpath, the install date and `Timeline`. A marker naming another copy is ignored. An authorized install writes the marker when installation starts.

All 35 exact pins in `requirements.txt`, including Kinocut 1.16.1 and OpenTimelineIO 0.18.1, install as binary wheels only, about 95 MB per interpreter, from `pypi.org` and `files.pythonhosted.org`. Environments sit under `.venv/python<major>.<minor>/` so interpreters can coexist. pip's cache and version check are disabled by flags and a sanitized child environment; no package goes into the machine's Python. Use the same interpreter for check and render. The full write inventory is `tools/AGENTS.md`.

## Usage

Prefix commands with `python3 scripts/timeline.py`, using the interpreter decision above. This is the closed command set; no command accepts positional extras, repeated flags or flags belonging to another command. Values follow a flag as a separate argument.

| Command | Purpose and arguments |
|---------|-----------------------|
| `help` | Complete usage, before dependency checks; no arguments |
| `--help` | Top-level alias for help; no arguments |
| `check` | Read-only survey, one JSON object; no flags |
| `render` | Validate and render one plan; requires `--plan` and `--output`; accepts `--install` |

| Flag | Command and effect | Default and bounds |
|------|--------------------|--------------------|
| `--help` | Top-level only: print usage | No other arguments |
| `--plan <path>` | render: JSON plan | Required, absolute existing file; resolved before reading |
| `--output <path>` | render: new directory for the four files | Required, absolute, parent exists, outside this tool; existing destinations refused |
| `--install` | render: authorize the pinned install and finish this render | Off; refused by help and check |

### Plan JSON

```json
{
  "fps": 30,
  "sources": [{"id": "rec", "path": "rec.mp4"}],
  "segments": [
    {"id": "open", "source": "rec", "start": 120, "end": 300, "speed": 1},
    {"id": "work", "source": "rec", "start": 300, "end": 480, "speed": 2},
    {"id": "answer", "source": "rec", "start": 480, "end": 1110, "speed": 1}
  ]
}
```

These are exactly the required keys at each level. Unknown and duplicate JSON keys are refused by name. `sources` and `segments` are nonempty lists. At most 63 segments are accepted: one Kinocut trim per segment plus the merge fits its 64-step workflow limit. Ids are unique across both lists and use only lowercase ASCII letters, digits and hyphens. Every segment names a declared source. `fps`, `start`, `end` and `speed` are integers, never booleans or numeric strings. `fps` is positive. `0 <= start < end <= source frame count`, with `end` exclusive. `speed >= 1`, and `end - start` must be divisible by speed. Segments may reuse or overlap a source. List order is cut order.

A segment contributes `(end - start) / speed` frames. Its output frame `j` comes from source frame `start + j * speed`. Every segment uses FFmpeg `trim=start_frame:end_frame` and new timestamps, with frame-number `select` added for speeds above 1, never `kino speed`: the installed Kinocut 1.16.1 implementation uses setpts without a frame-rate step and does not land exact output frames.

## Output

Render success is one JSON object naming the four files and their SHA-256 values, `frame_count`, `duration` read back from the MP4, all four colour tags read back, and `assumed_bt709` source ids. Failure leaves stdout empty and exits 1.

A new output directory contains exactly:

| File | Contents |
|------|----------|
| `cut.mp4` | H.264 libx264, yuv420p, plan rate, BT.709 primaries, transfer and matrix, TV range, in H.264 VUI and MP4 colr metadata |
| `cut.otio` | OpenTimelineIO timeline of the same plan, global start 0, one video track, one clip per segment, original source URI and full available frame range; clip source start is the planned first frame and duration the output length, with LinearTimeWarp for speeds above 1 |
| `kinocut-receipt.json` | Unmodified Kinocut cutfile receipt with each trim and the merge and their input/output hashes |
| `record.json` | Original plan object and file hash; resolved source paths, hashes, full frame counts, sizes, rates, duration, tags and assumptions; ordered direct subprocess arguments, working directories, exit statuses and hashes of their input/output data files; cutfile contents and hash; encode counts and Python, Kinocut, OpenTimelineIO and FFmpeg versions; checked output metadata and hashes |

Each encode uses CRF 0, medium preset, one thread and yuv420p, with the same explicit colour settings. Each segment has two encode passes and zero lossy generations. Before success, Timeline decodes the output and each source once to frame MD5 hashes and requires every output frame to equal its planned source frame, with the exact planned count. The record's `frame_comparison` gives `frames_compared` and `all_equal`. The first mismatch names the segment, zero-based output frame and source frame and withholds the output. Two renders on the same stack decode identically. Lossless coding can produce large files; final delivery encoding belongs to the calling skill.

Kinocut 1.16.1 exposes no trim-quality parameter. The tool's internal child adapter binds that version's quality-argument seam to the shared arguments in `scripts/encoding.py` without changing the installed package. Timeline first writes every segment to its own MP4 with frame-number boundaries. One cutfile trims each of those clips from 0 for its whole length and merges everything. Kinocut reads only these generated MP4s, never a caller recording. Final tagging remuxes without encoding. Kinocut's own receipt describes its internal steps; the record describes the subprocesses Timeline directly starts, including install processes when installation is necessary, with their declared data-file reads/writes. Runtime library and operating-system file accesses are not a filesystem trace.

Processing uses a new hidden `.timeline-work-<random>` sibling of output. Source files are hard-linked into it, or copied on link failure, with that choice recorded. It holds the cutfile, intermediates, and Kinocut's isolated home, cache and temporary folders. Every child process, including FFmpeg and ffprobe probes, uses a named allow-listed environment from `scripts/processes.py`; paid vision credentials are absent, and an empty `MCP_VIDEO_HYPERFRAMES_COMMAND` blocks even a planted local HyperFrames executable. Paths in process records inside the work directory are relative to it; `output/<name>` names a final output file, `tool/<relative path>` names a file inside this tool, and every other path stays absolute and readable after cleanup. The work directory is removed on success and failure, so intermediate hashes describe ephemeral files. `record.json` hashes the other three final files; its own hash is in the success object, avoiding a self-referential hash.

Every source, flag, schema field and preflight media constraint is validated before install or work-directory creation. Preflight sorts video packet timestamps into presentation order to check constant rate and count frames, taking dimensions from the stream without decoding. A mid-stream frame-size change needs decoding and is caught during the render frame comparison, which disables automatic scaling and checks frame byte sizes. The four files are completed and the video read back before output is created; a frame, frame-count or tag mismatch withholds success. Existing output names are never replaced. A forced process kill can leave its hidden work directory; remove only the abandoned directory identified for that run.

## Script Contract

This tool follows `wiser/standards/script-contract.md`. What a person meets at install and run time is `wiser/tools/RUNNING.md`; this tool's plan-relative source paths and per-interpreter caches are documented above. Importing the entry script runs no command. No credential configuration is needed. The write inventory is `tools/AGENTS.md`.

## Troubleshooting

| Refusal message | Cause | Fix |
|-----------------|-------|-----|
| `missing command`, `unknown command [name]`, `unknown argument [name]`, `repeated flag [name]`, `missing value for [name]`, `missing flag [name]` | Command or flag violates the closed set | Run `python3 scripts/timeline.py help`; pass each required flag once |
| `render refuses Python [version]; requires Python 3.11 to 3.13 only` | Unsupported interpreter or wheel range | Run the version check in Dependencies with Python 3.11 to 3.13 and use it for render; the pinned wheel rule above applies |
| `[path] must be a nonempty path without control characters`, `[path] must be absolute` | Invalid caller path | Supply an absolute work path; source paths can instead be plan-relative |
| `path cannot be resolved`, `path cannot be screened` | Unreadable ancestor or symbolic-link loop | Repair permissions or the loop |
| `[path] names the connector key`, `[path] is in the credential directory`, `[path] identifies a file in the credential directory`, `[path] cannot screen the credential directory` | Credential path, hard-link alias or unavailable screen | Choose a work path outside credentials or repair access for the screen |
| `[path] names private configuration or memory` | Resolved private filename or store | Supply a recording, plan or output in a work directory |
| `[path] resolves inside the tool`, `[path] already exists`, `[path] parent is absent`, `[path] is not a readable file` | Unsafe or unavailable destination/source | Choose a new work directory with an existing parent, or repair the source path |
| `plan is not readable JSON`, `duplicate key [name]` | Malformed plan or repeated JSON key | Repair JSON and retain each key once |
| `[level] must be an object`, `unknown key [level.name]`, `missing field [level.name]` | Schema violation | Use exactly the documented keys and object shapes |
| `[field] must be an integer >= [n]`, `sources must be a nonempty list`, `segments must be a nonempty list`, `source.path must be a nonempty path` | Missing or wrongly typed value | Use the plan's stated types and bounds, without booleans for integers |
| `[id] must use lowercase letters, digits and hyphens`, `duplicate id [name]`, `segment.source is unknown` | Invalid id or reference | Use unique ids and a declared source |
| `segment [id] is empty or reversed`, `segment [id] length is not divisible by speed`, `segment [id] is outside its source` | Invalid frame interval | Correct the exclusive end, start or whole-number speed |
| `plan has more than 63 segments` | Kinocut allows 64 workflow steps including the merge | Supply at most 63 segments |
| `source [id] pixel format [format] is not yuv420p`, `source [id] color_range pc is full range`, `source [id] has nonzero or unreadable rotation/display matrix` | Conversion or rotation would break exact frame preservation | Supply unrotated TV-range yuv420p media |
| `source [id] has an audio stream` | Recording carries audio | Supply a silent recording; this version does not cut audio |
| `source [id] must have one video stream`, `source [id] has unreadable frame metadata` | Unsupported or unreadable recording | Supply one readable constant-rate video stream |
| `source [id] rate differs from fps or is variable`, `source [id] is variable frame rate` | Rate or timestamps violate fps | Supply constant-rate media at the plan's rate |
| `sources have different frame sizes`, `source [id] frame size changes`, `source [id] size must be positive and even for yuv420p` | Incompatible dimensions | Supply fixed, even, matching dimensions |
| `source [id] [colour tag] is not BT.709` | Declared primaries, transfer or matrix differs | Supply BT.709 or untagged media; do not relabel another colour space |
| `missing ffmpeg`, `missing ffprobe`, `ffmpeg has no libx264 encoder` | System dependency check failed | Make the named Dependencies check pass |
| `requirements must be exact pins`, `requirements contain a duplicate pin` | Damaged manifest | Restore requirements.txt |
| `plugin root missing tools/AGENTS.md` | Incomplete plugin copy | Restore its family index |
| `packages missing` | Absent/incomplete pins without consent | Put the report to the person and apply Quick Start's install decision |
| `wheel install failed at [cache]` | Interpreter, wheel support, directory permission or pip failure | Check venv and compatible pinned binary wheels; remove that incomplete interpreter cache, then retry an authorized render |
| `process could not start: [program]`, `process failed: [program] exit [status]`, `ffprobe returned invalid JSON` | Program launch, processing or readback failed | Check Dependencies, readable inputs, permissions and disk space |
| `Kinocut [class] code=[code]`, `Kinocut child exit [status]` | Kinocut failed with the named structured cause, or its bridge exited without a diagnostic | Output is withheld; check the cutfile, inputs and pinned environment |
| `frame mismatch at segment [id], output frame [j], source frame [n]`, `frame size changes in [file]`, `frame decode failed for [file]`, `unreadable frame hashes` | Decoded frames differ from the plan or cannot be verified | Output is withheld; supply fixed-size media and check source, frame selection and FFmpeg |
| `Kinocut receipt is not completed` | Cutfile did not complete | Output is withheld; check the pinned environment |
| `output frame count differs from plan`, `output BT.709 tags are missing`, `output codec is not H.264 yuv420p` | Written candidate violates the output contract | Output is withheld; check FFmpeg, libx264 and the pinned environment |
| `processing failed or was interrupted` | File error, package import failure or interruption | Check input, cache, permissions and disk space; retry with a fresh output |

## Success

- Help prints complete usage without packages, including on Python 3.9; check prints one read-only survey and writes no marker.
- Render uses Python 3.11 to 3.13 only under the pinned binary-wheel rule, validates the whole plan before installing or writing work files, refuses every unknown field or flag by name, and leaves stdout empty on failure.
- A checked cut has exactly the sum of the segment output lengths, each output frame matching its planned source frame, at the plan rate, with BT.709 and TV range read back.
- OTIO references original sources and carries each planned range and speed. The Kinocut receipt retains its trims and merge, and the record accounts for source hashes, processes, encode generations and checked output.
- Exactly four files appear at the new output, every final hash is in the success object, the hidden work directory is removed, and a repeat render decodes identically.
