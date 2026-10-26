# Tools

Deterministic operations that skills and experts call; `wiser/standards/primitives.md` owns the type. Running one is `wiser/tools/RUNNING.md`; the contract is `wiser/standards/script-contract.md`. The directory is flat, and the index below is grouped by category.

## Installing

Scene Composer installs nothing.

Timeline installs its 35 exact wheel pins, about 95 MB per interpreter, from `pypi.org` and `files.pythonhosted.org`, into its own `.venv/`. Consent follows `wiser/tools/RUNNING.md`. An authorized render installs and finishes the cut. Nothing installs into the machine's Python.

## Everything a tool writes, and where

| What | Where | Which tools |
|------|-------|-------------|
| HTML project page, linked stylesheet and seek script | New caller-named `--output` directory, under `project/` | Scene Composer |
| Still and font copies under fixed names | The same output's `project/` directory | Scene Composer |
| Scene caption track, captions.srt | The same output directory | Scene Composer |
| Hash manifest and resolved cues, compose.json | The same output directory | Scene Composer |
| Joined caption track | New caller-named `--output` SRT file | Scene Composer |
| Output directory with cut.mp4, cut.otio, kinocut-receipt.json and record.json | New caller-named `--output` directory | Timeline |
| Sources, intermediate clips, cutfile and isolated home, cache and temporary files | New hidden `.timeline-work-<random>` sibling of output, removed on success and failure; a forced kill can leave it | Timeline |
| Python wheel environments | `Timeline/.venv/python<major>.<minor>/`, one per interpreter | Timeline |
| Plugin consent marker | `.wiser-consent` at this plugin root | Timeline |
| pip download cache | Disabled by flags and child environment; none survives | Timeline |

<!-- generated:index -->

### Media

| Tool | Description |
|------|-------------|
| `Scene Composer/TOOL.md` | Composes one still walkthrough scene into a seek-driven HTML project with frame-aligned SRT captions and joins scene caption tracks |
| `Timeline/TOOL.md` | Cuts silent recordings to exact planned frames and writes a BT.709 video, an OpenTimelineIO timeline and processing records |

<!-- /generated:index -->
