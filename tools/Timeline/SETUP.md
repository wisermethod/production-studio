# Timeline Setup

System dependencies are once per machine, packages once per interpreter in this plugin copy (`wiser/tools/RUNNING.md`). Run from this tool's directory.

## 1. Interpreter and system programs

```bash
python3 -c 'import sys; print(sys.version.split()[0]); sys.exit(not (3, 11) <= sys.version_info[:2] <= (3, 13))'
python3 -m venv --help
python3 scripts/timeline.py help
python3 scripts/timeline.py check
```

Render needs Python 3.11 to 3.13 only and compatible pinned binary wheels. Kinocut 1.16.1 requires Python 3.11 or newer. OpenTimelineIO 0.18.1 provides binary wheels for Python 3.9 to 3.13 on Apple Silicon macOS, Linux x86_64 and aarch64, and Windows; it provides none for Python 3.14 or Intel Macs. The supported render range is therefore Python 3.11 to 3.13 only, on those wheel platforms. Help and check run with Python 3.9 or newer. If `python3` is outside that range, run the first check with an available supported interpreter and use that interpreter for render, as TOOL.md's Quick Start shows. `check` surveys this interpreter, all 35 exact pins in its own `.venv` environment, FFmpeg, ffprobe and libx264 without installing or writing anything.

TOOL.md's Dependencies section gives the system checks. When one fails, follow `wiser/standards/script-contract.md` System dependencies: consult that dependency's own current documentation, run what the host can run, and hand the person only what the host cannot do. Machine-level changes need the person's approval. Timeline installs no system program, and keeps no system-install walkthrough here.

## 2. Packages

The first render without usable pins reports all 35 pins, about 95 MB, the two hosts `pypi.org` and `files.pythonhosted.org`, and the tool's `.venv/python<major>.<minor>/`. Put that report to the person. Their consent is `--install` on the same render, or `WISER_ALLOW_INSTALL=1` for an unattended run. A matching plugin-copy consent marker also authorizes it. The authorized command installs and completes the render. Help and check refuse install flags.

`requirements.txt` pins the entire runtime set, including `kinocut==1.16.1` and `OpenTimelineIO==0.18.1`. Only binary wheels are accepted; no compilation or machine-Python install occurs. pip's cache is disabled by command and child environment. `NOTICE.md` records inspected metadata and the supported interpreter and binary-wheel rule. Distinct interpreter environments coexist under `.venv/`; package readiness inspects only this interpreter's environment.

A failed install names its incomplete cache. Check venv support, compatible pinned wheels and permissions, then remove that incomplete interpreter cache and retry with consent, applying the constitution's Irreversibles before removal. No supported wheel means a refusal; substituting another package version is not a repair this version performs. `tools/AGENTS.md` is the write inventory.

## 3. Verify

Run `python3 -B -m unittest discover -s test` with the chosen interpreter from this directory. Tests requiring Kinocut skip visibly if this interpreter lacks the pins; skipped tests do not establish rendering readiness. Test media is generated with FFmpeg in OS temporary directories and removed afterward. No media ships.

Follow TOOL.md's Success checks on a silent, constant-rate recording and a new output directory. Inspect the success object's frame count, duration, all four colour tags, assumptions and file hashes, and read cut.otio with OpenTimelineIO. A read-only check returns exit 0 even for missing requirements, so read its fields.

## Troubleshooting

An absent interpreter or system program follows step 1. `packages missing` follows step 2's consent decision. `wheel install failed` follows its incomplete-cache repair and binary-wheel constraint. A source, plan, path or readback refusal follows TOOL.md's Troubleshooting table.
