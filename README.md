# Production Studio

A WISER plugin for producing and editing video, training videos first: scripts written for ear and eye, narration in your own voice clone, screen walkthroughs, animation, editing and publishing. Its first skills, experts and tools are being built; each family's `AGENTS.md` index lists what it holds.

## Install

Point your harness at this repository as a plugin root, or add the repository as a marketplace and install `production-studio@wiser-method-production-studio` from its catalog.

Work lands in the working folder you attach, never in this repository.

## What it needs

Production Studio loads beside the base plugin `wiser`, which carries the connectors and the tools it calls. What each part needs, as it stands today:

- **Narration** (`skills/Narrate/`): the root's route and the person's voice clone recorded by Set Up Voice Clone, Node 22 or later, and FFmpeg with ffprobe. ElevenLabs needs its `speech` module connected through Wiser's local gateway in Claude Code, Codex, Grok or Cursor. The free route runs locally through `wiser`'s Chatterbox, with English word alignment through `Transcribe Audio`, which needs CPython 3.9 to 3.13 and its separate alignment packages and weights. Both routes check English takes through that tool's independent transcription, which needs Python 3.8 or newer and downloads its speech packages and model weights once, when you allow it. Packages stay in the tools' own folders and weights in the person-scoped models folder.
- **A voice clone** (`skills/Set Up Voice Clone/`): choose ElevenLabs on your own account and plan, or the free local route. An existing ElevenLabs clone can be listed and confirmed; creating one uploads a measured MP3 through the local gateway and may need ElevenLabs' own verification. The free route needs an Apple silicon Mac on macOS 12.3 or later, native arm64 CPython 3.11 and FFmpeg. There is no RAM floor: Chatterbox's offline check and your accepted reference-recording trial decide, refusing more than 3.0 compute seconds per second of audio. Short scenes can be slower than the trial. Setup states its lower quality and Resemble's Perth watermark. The route takes about 4.7 GB including alignment; the tool conservatively checks 6.7 GiB free at each destination including an installation reserve. Downloads follow your route choice and install consent; no recording is used for cloning before the one consent answer is saved.
- **Scripts** (`skills/Write Script/`): stills of the product's steps, taken for the script. Nothing to install.
- **Cutting recordings** (`tools/Timeline/`): Python 3.11 to 3.13, an Apple Silicon Python on a Mac, and FFmpeg with libx264 and ffprobe. With your consent it installs its packages, about 95 MB, into its own folder.
- **Take filing** (`tools/Narration Takes/`): Node 22 or later and ffprobe. Nothing to install.
- **Walkthrough scenes** (`tools/Scene Composer/`): Node 22 or later, and the font files the scene's text uses. Nothing to install. Its scenes render through `wiser`'s `video-render`, which installs HyperFrames and its own Chrome once, when you allow it.
- **Animated scenes** (`skills/Animate Scenes/`): everything walkthrough scenes need, above, and FFmpeg for `video-render`'s files. An explainer scene, such as a graphic of a process's steps, runs `wiser`'s `Animated Explainer`, which draws through `wiser`'s `render` and asks you to approve its words. Each scene is checked by the Animator in a second context, which an app that can open one, such as Claude Code or Cowork, gives; in another app you open a new chat for that step.
- **The finished video** (`skills/Assemble Video/`): `wiser`'s `video-edit` 0.2.0 or later, which needs Node and FFmpeg with ffprobe, `libx264` and `libopus`; Node 22 or later for `Scene Composer`'s caption join. Nothing to install. It does not yet cut a screen recording into scenes.
- **Publishing** (`skills/Publish Video/`): an app that can attach Wiser's local gateway, with `wiser`'s YouTube connector connected to your own channel through your own Google app. It also needs FFmpeg with ffprobe for the thumbnail's frame, and `wiser`'s `render` for the thumbnail. A custom thumbnail needs a verified channel, and chapters show once the channel has YouTube's Advanced features. Uploading is free; it uses your Google project's daily quota.
- **Produce Video** (`skills/Produce Video/`): a native macOS host for capture and the finished video's privacy check, `wiser`'s `Browser Control` for a web product, and `wiser`'s `Screen Capture` with its permissions for a macOS app, besides everything the skills it runs need, above.

ElevenLabs narration is billed by the account's plan; Narrate shows character-based estimates before billing, and every synthesis needs gateway confirmation. The free route costs no money; Narrate shows expected compute time from your accepted trial. Its alignment supports English and a restricted token set; unsupported text stops before synthesis.
