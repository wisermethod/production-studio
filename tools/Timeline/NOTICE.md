# Third-party notice: Timeline

This tool installs its 35 pinned runtime packages into interpreter-specific Python virtual environments inside its own `.venv/`, on an authorized render under `wiser/tools/RUNNING.md`. **This repository redistributes none of these packages.** It downloads no models, fonts or compositions.

**Installed Python 3.11.15 environment metadata inspected 2026-10-24 on macOS arm64, read independently with Python 3.11.15 and Python 3.14.7.** Versions below are the installed distributions matching requirements.txt. Licence labels come from their own License-Expression or License fields, falling back to their licence classifiers where stated. Declared licence files in the installed distributions remain the complete notices.

**Python 3.14.7 was also tested on 2026-10-24.** Its wheels-only install could not resolve OpenTimelineIO 0.18.1, reporting no matching distribution. No runtime distribution was installed in that interpreter's environment, so no native Python 3.14 runtime snapshot is available. That interpreter also read the 35 distributions' metadata in the Python 3.11 environment; all versions and licence fields matched the first reading. This is a metadata comparison, not evidence of Python 3.14 binary compatibility.

| Package | Python 3.11.15 installed version | Licence stated by installed metadata |
|---------|---------------------------------|--------------------------------------|
| `annotated-types` | 0.8.0 | MIT |
| `anyio` | 4.15.1 | MIT |
| `attrs` | 26.1.0 | MIT |
| `certifi` | 2026.10.23 | MPL-2.0 |
| `cffi` | 2.1.1 | MIT-0 |
| `click` | 8.5.0 | BSD-3-Clause |
| `cryptography` | 50.0.2 | Apache-2.0 OR BSD-3-Clause |
| `h11` | 0.16.0 | MIT |
| `httpcore` | 1.0.9 | BSD-3-Clause |
| `httpx` | 0.28.1 | BSD-3-Clause |
| `httpx-sse` | 0.4.3 | MIT |
| `idna` | 3.20 | BSD-3-Clause |
| `jsonschema` | 4.26.0 | MIT |
| `jsonschema-specifications` | 2025.9.1 | MIT |
| `kinocut` | 1.16.1 | Apache-2.0 |
| `markdown-it-py` | 4.2.0 | MIT (licence classifier) |
| `mcp` | 1.30.0 | MIT |
| `mdurl` | 0.1.2 | MIT (licence classifier) |
| `opentimelineio` | 0.18.1 | Apache 2.0 License |
| `pycparser` | 3.12 | BSD-3-Clause |
| `pydantic` | 2.14.1 | MIT |
| `pydantic-settings` | 2.16.1 | MIT |
| `pydantic-core` | 2.50.1 | MIT |
| `pygments` | 2.21.0 | BSD-2-Clause |
| `pyjwt` | 2.15.1 | MIT |
| `python-dotenv` | 1.2.4 | BSD-3-Clause |
| `python-multipart` | 0.0.32 | Apache-2.0 |
| `referencing` | 0.37.0 | MIT |
| `rich` | 15.0.0 | MIT |
| `rpds-py` | 2026.9.1 | MIT |
| `sse-starlette` | 3.5.1 | BSD-3-Clause |
| `starlette` | 1.10.0 | BSD-3-Clause |
| `typing-inspection` | 0.4.4 | MIT |
| `typing-extensions` | 4.16.0 | PSF-2.0 |
| `uvicorn` | 0.54.0 | BSD-3-Clause |

pip and setuptools are environment bootstrap packages, not runtime pins. The inspected Python 3.11.15 environment holds pip 24.0 and setuptools 79.0.1; the incomplete Python 3.14.7 environment holds pip 26.2.1 and no setuptools. pip 24.0 states MIT in License; pip 26.2.1 states MIT in License-Expression. setuptools 79.0.1 has no licence field or classifier; its declared LICENSE contains the MIT permission text. No package content or licence file is copied into this repository.

## System programs, none installed by this tool

FFmpeg and ffprobe supply decoding, encoding, remuxing and inspection outside the Python package set. Their licence is LGPL-2.1-or-later or GPL-2.0-or-later depending on the selected build and its codecs. That installed build's own notices govern it. Python supplies the interpreter and venv under its own terms. Timeline runs these system programs and installs none of them.
