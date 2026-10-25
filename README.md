# Production Studio

A WISER plugin for producing and editing video, training videos first: scripts written for ear and eye, narration in your own cloned voice, screen walkthroughs, animation, editing and publishing. Its first skills, experts and tools are being built; each family's `AGENTS.md` index lists what it holds.

## Install

Point your harness at this repository as a plugin root, or add the repository as a marketplace and install `production-studio@wiser-method-production-studio` from its catalog.

Work lands in the working folder you attach, never in this repository.

## What it needs

Production Studio loads beside the base plugin `wiser`, which carries the connectors and the tools it calls. What each part needs, as it stands today:

- **Narration** (`skills/Narrate/`): an app that can attach Wiser's local gateway, which today means Claude Code, Codex, Grok or Cursor, with xAI's `speech` module connected. It also needs FFmpeg with ffprobe. It checks each take with `wiser`'s `Transcribe Audio`, which needs Python 3.8 or newer and downloads its speech packages and model weights once, when you allow it.
- **A voice clone** (`skills/Set Up Voice Clone/`): an xAI account where xAI offers voice clones, today the United States except Illinois. The person whose voice clone it is records it in xAI's console; the plugin takes no recording of anyone.
- **Scripts** (`skills/Write Script/`): stills of the product's steps, taken for the script. Nothing to install.
- **Cutting recordings** (`tools/Timeline/`): Python 3.11 to 3.13, an Apple Silicon Python on a Mac, and FFmpeg with libx264 and ffprobe. With your consent it installs its packages, about 95 MB, into its own folder.

Narration is billed by xAI, per character; the skill tells you the cost before any call.
