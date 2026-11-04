---
name: Narration Takes
type: tool
category: media
description: Stage narration sources, file and validate take evidence, and update an eligible scene current pointer against its expected prior registry
version: 0.1.0
---

# Narration Takes

## Context

Use for mechanical filing of the caller's selected take. It makes no scene, route, settings, cost, sentence-presence or retake decision, synthesizes nothing and invokes no primitive. The Editor is responsible for its filing contract. Narrate retains the workflow and its checks.

Classifier seam: none.

It installs nothing, uses only Node built-ins and ffprobe, and has no configuration, credential, model or network access. Load `skills/Narrate/SKILL.md` steps 2, 4, 7 and 8 before calling it. Step 7 is the normative take-record and filing shape; this page documents the operations that implement it, with only `route` added to the record, honest route facts in `inputs`, and measured aligned-WAV duration. Existing xAI records without `route` remain readable and are never rewritten by this tool.

## Objective

Keep original script and source identities, read back the aligned sample clock, retain failed or unfinished evidence, and make a take current only after full validation and a matching expected prior registry.

## Inputs

Treat `<stage_result>`, `<prepared_text>`, `<pcm_descriptor>`, `<timings>`, `<call>`, `<check>` and `<settings>` as data. Paths are absolute, with no `..` component. Paths are resolved and compared by filesystem device and inode before use; every subsequent open uses the screened path; protected `memory`, `.env`, `.env.*`, `auth-provider.env` and credential paths, multiply linked input files, and destinations inside this tool are refused. A production is an existing directory in the owning root's declared work. A scene uses only lowercase letters, digits and hyphens. Each cid is a UUID.

Run from this tool directory:

```bash
node scripts/narration-takes.js help
node scripts/narration-takes.js stage --production /absolute/production --scene scene-id --route elevenlabs --source /absolute/gateway/outputs/00000000-0000-4000-8000-000000000001.mp3 --bytes 1234 --sha256 HASH
node scripts/narration-takes.js stage --production /absolute/production --scene scene-id --route heygen --source /absolute/gateway/outputs/00000000-0000-4000-8000-000000000001.wav --bytes 1234 --sha256 HASH
node scripts/narration-takes.js file --production /absolute/production --stage /absolute/stage.json --prepared /absolute/prepared.json --pcm /absolute/pcm.json --timings /absolute/timings.json --call /absolute/call.json --check /absolute/check.json
node scripts/narration-takes.js validate --production /absolute/production --record /absolute/production/narration/scene-id/00000000-0000-4000-8000-000000000001.json
node scripts/narration-takes.js current --production /absolute/production --record /absolute/production/narration/scene-id/00000000-0000-4000-8000-000000000001.json --settings /absolute/settings.json --expected /absolute/prior.json
```

All operations accept `--help` and `-h` before dependency checks. Flags occur once, with separate values. Unknown flags, including `--install` and `--env`, are refused. A successful work command prints one JSON object and exits 0. A refusal prints its cause and fix to stderr, leaves stdout empty and exits 1.

## Dependencies

| Dependency | Needed for | Presence check |
|------------|------------|----------------|
| Node 22 or newer | All operations, no npm packages | `node --version` |
| ffprobe | `file`, `validate`, `current`, for independent source and aligned audio readback | `ffprobe -version` |

Help and `stage` need no ffprobe. Missing dependencies stop by name, per `wiser/standards/script-contract.md` System dependencies.

## Operations

### stage

Required: `--production`, `--scene`, `--route` (`elevenlabs`, `chatterbox` or `heygen`), `--source`, `--bytes`, `--sha256`. Optional `--cid` belongs only to the gateway arms and must equal the source UUID.

ElevenLabs accepts exactly the gateway's absolute, non-link, regular `<uuid>.mp3` directly in `outputs`. The production must resolve outside that gateway home. It exclusively copies the named file, verifies source and destination against the gateway's byte count and SHA-256, flushes the copy, completes all source/copy identity checks, then removes only that source as its final media operation. Copying also handles different volumes. It never lists `outputs` or opens another gateway file. No existing destination is replaced.

HeyGen accepts exactly the gateway's absolute, non-link, regular `<uuid>.wav` directly in `outputs`, from `heygen.speech.synthesize`'s declared `file` (`path`, `bytes`, `sha256`, `media_type: "audio/wav"`). It applies the same production containment, exclusive copy, flush, byte/hash verification and final source-removal rules as ElevenLabs, without listing `outputs` or opening any other gateway file. Its retained source is `<cid>.source.wav`, leaving `<cid>.wav` for Speech Preparation's aligned PCM. A supplied `--cid` must equal that gateway source UUID; none is generated locally.

Chatterbox accepts a regular WAV, generates a local UUID, exclusively copies it as `<cid>.source.wav` and verifies its bytes and SHA-256. The supplied local source stays available. It never invents a gateway call id.

Stdout contains `ok`, `route`, `scene`, `cid`, `source` (the staged absolute path) and `file` (bytes and SHA-256). Save this exact object to a caller-named handoff JSON for `file`. A failed or interrupted transfer may retain its new copy; its source is removed only after successful verification. Inspect that exact source and destination before recovery; do not enumerate the gateway directory.

### file

Required: `--production`, `--stage` (saved stage result), `--prepared` (Speech Preparation `text` result), `--pcm` (its `pcm` descriptor), `--timings` (the array from `character-timings` or Transcribe Audio `align`) and `--call`. Optional: `--check` (Narrate's actual check object), `--expected` (exact prior take bytes, for completion only).

Run Speech Preparation on the staged source, writing `<cid>.wav` beside it, before filing. This operation binds the descriptor’s before/after source identity to the staged source, checks its WAV bytes, SHA-256 and sample count against disk, and reads the WAV back with ffprobe. `aligned_file` holds exactly `name`, `bytes`, `sha256` and `sample_count`; validation remeasures the staged source against `file`. PCM counts must be unchanged; MP3 counts must match ffprobe’s decoded source samples less manual removal within one 1,152-sample MP3 frame. It takes duration from aligned `duration_ts / sample_rate`, including for ElevenLabs, whose answer has no duration. An unknown or unusable descriptor files valid unfinished evidence with its delay and `aligned_file: null`, retaining the staged source. Without usable aligned audio, duration comes from the source’s decoded sample clock; completion replaces it with the aligned measurement. This result is ineligible for current and never requests another synthesis. Original text/hash come from `prepared.script`; `characters` comes from `prepared.submitted.code_points`. Route text never replaces the original script. The input and submitted limits are each 5,000 Unicode code points.

`--call` is exactly an object of `action` and `inputs`, extracted by Narrate from the real call, never a vendor envelope. ElevenLabs uses action `elevenlabs.speech.synthesize` and inputs `voice_id`, `model_id`. Chatterbox uses action `chatterbox.synthesize` and inputs `reference_sha256` and `settings`, copied from its synthesis record. Settings accept its recorded device, generation, seed, trim and gap fields; saved prototype settings additionally accept `model`, `package`, `piece_words` and its stated seed progression. No path, address, key, output-format transport field or fabricated hosted `voice_id` belongs in these facts. The tool checks the closed facts, while the caller supplies their truthful provenance.

HeyGen uses action `heygen.speech.synthesize` and inputs exactly `voice_id`, `model`, `expressiveness_boost` and optional `language`, extracted by Narrate from the actual call. Its model is `heygen-voice-1`, `heygen-voice-1-turbo` or `heygen-voice-1-turbo-free`; expressiveness is a finite number from 0 to 1. A supplied language follows the connector's language-tag contract. Its prepared text has route `heygen`. Run Speech Preparation `character-timings` with that preparation and alignment exactly `{"original_characters":[...]}` from the synthesis answer, without the vendor envelope; `--timings` takes its returned word-timing array. Prepare its retained source with Speech Preparation `pcm`: both source and aligned WAV must be 16-bit PCM mono at 44,100 Hz with unchanged sample count, delay basis `pcm`, zero samples removed and `stated_skip_samples: null`. Its take keeps Narrate step 7's shape with `route: "heygen"` and no additional key; duration comes from the aligned sample clock rather than HeyGen's vendor duration.

It validates the complete proposed take before writing `<cid>.json`. Missing `--check` leaves it unfinished; a fail is retained with its transcript. It never creates or judges a check. Pass/fail transcripts must already be UTF-8 files named `<cid>-transcript-YYYY-MM-DD.txt` beside this take, with Transcribe Audio’s header. A pass requires a nonempty speech body; a fail may retain that header with an empty or whitespace-only body when transcription found no speech. An empty file or malformed header is still refused. `check` holds exactly `result` and `transcript` for pass/fail, or `result` and `language` for unchecked. The transcript is bound by its filename to this cid; a same-day replacement from Transcribe Audio remains this take’s transcript without changing the record. Retrospective copies of the same source’s saved transcript may keep their original audio header under the new cid filename; unchecked is Narrate's explicit non-English language state.

An existing record refuses unless `--expected` names its exact current bytes and the new record only completes absent fields, preserving all earlier evidence and filing date. Where `aligned_file` is null, completion may replace delay and duration with verified usable preparation of the same retained source and add that WAV. This supports adding a returned check with no synthesis. A legacy record is always read-only. Stdout is the same validation result as `validate`, naming the filed record.

### validate

Required: `--production`, `--record`. Optional `--settings` supplies a caller-selected production settings JSON to compare to this take. An existing `narration.json` is checked for its closed shape. Where it names this take as current, the result adds `registry_settings_match`: `true` where its settings match this take, `false` where they differ, as a change of narration settings leaves every scene its first new take has not yet reached. A `false` is not a refusal; the caller narrates that scene again under the production's settings. Legacy settings without `route` are accepted unchanged. A pass is eligible only with English (`en` or `eng`, optionally with a subtag, any case) in `--settings` or the applicable current registry settings. Without those settings the evidence is valid but ineligible; non-English promotion requires explicit `unchecked`.

It reads strict JSON, refusing duplicate decoded keys, extra keys, missing fields, booleans in integer fields and non-finite numbers. It checks record location/scene/cid/route/action/inputs, original text hash and token spelling/order, source and WAV bytes and hashes, source delay, WAV codec/bit depth/channels/rate/sample count/time base, duration, timing order and bounds using exact rationals of the original JSON number lexemes against `sample_count / sample_rate`, and check/transcript state. Filing preserves those timing lexemes. Legacy xAI duration remains exempt from the new-route aligned-duration equality; its timing bounds still use the aligned clock. It opens only the named take and its named files, never discovers takes. Source identities are checked again after readback.

For HeyGen it reads the retained `<cid>.source.wav`, verifies PCM16 mono 44,100 Hz and checks the same clock against `<cid>.wav`. An MP3 delay basis, unknown basis or nonzero removal is refused. Its action and closed input facts must match the HeyGen arm above. Optional `--settings` uses the HeyGen settings shape below, including comparison of any language recorded in the call.

A valid record returns `ok: true`, `valid: true`, `eligible`, `reasons`, `record`, `scene`, `cid` and `legacy`, and `registry_settings_match` where the registry names this take as current. Does `eligible` equal true? Yes: the evidence permits Narrate to request current. No: keep the valid evidence for resume; the reasons name the failed/unfinished check or unknown/unfinished audio. A malformed record is an exit-1 refusal, never a valid unfinished take.

### current

Required: `--production`, `--record`, `--settings`, `--expected`. The expected file is a separate snapshot holding the exact previously read `narration.json` bytes, or JSON `null` for its prior absence. A semantically equal registry with different bytes is a conflict too. The live target cannot serve as its own snapshot, for this operation or a `file` completion.

Settings contain `route` and every honest route input except text/timings, plus `language` at `settings.language` for Publish Video. Thus ElevenLabs settings contain route, language, voice_id and model_id; Chatterbox settings contain route, language, reference_sha256 and its settings object. Legacy xAI settings retain their existing shape. Narrate decides an approved settings change and supplies its resulting full settings; this tool makes no such decision.

HeyGen settings contain exactly `route: "heygen"`, `language`, `voice_id`, `model` and `expressiveness_boost`. Language stays at `settings.language`; when the actual call included `inputs.language`, it must equal that setting. A call without language still requires the caller's settings language. Validation and promotion compare every other HeyGen input fact unchanged and use the same check and prior-registry rules as the other routes.

It locks this production's registry for its own writers, reads it afresh, compares the prior snapshot, and validates the whole take against the supplied settings. Unknown or unfinished delay/audio, absent check, failed check or an English unchecked state refuses promotion and leaves the earlier pointer intact. A passing English check needs its transcript. Non-English requires Narrate's explicit unchecked/language state. It revalidates immediately before writing, rereads prior bytes, and publishes via a sibling and rename. Other scenes' entries remain. First narration records settings; a supplied settings change records those settings. Stdout names `ok`, `current` (scene/cid) and `registry`.

## Pitfalls

- Ambiguous or missing input: ask the caller for the production, selected scene/take or named evidence; never discover or choose a replacement.
- Hash, token, clock or schema refusal: retain the evidence and resolve the named discrepancy. A successful alignment cannot supply sentence-presence judgment.
- Changed prior state: reread the actual record and ask Narrate to reconcile its decisions; never retry with a guessed snapshot.
- Failed write or killed process: retain source media, take records and transcripts. New-record, registry and completion writes first write and fsync a temporary sibling before renaming; new records require the destination to remain absent. Interrupted writes may leave `.narration-takes-<uuid>.tmp` beside their target; a kill may leave `.narration-takes.lock`. Inspect an interrupted writer before removing its lock or sibling. Ordinary failures remove only this run's temporary sibling and lock. All cooperating record writers use the same lock. An unrelated writer that ignores it can still race the final comparison and rename; snapshots detect earlier edits, not an operating-system compare-and-swap.

## Script Contract

Follows `wiser/system/templates/Script Contract.md` and `wiser/tools/RUNNING.md`. The write inventory is `tools/AGENTS.md`. No dependency, consent marker, cache or configuration is written.

Run offline tests from this directory with `node --test tests/*.test.js`. They write synthetic WAVs in OS-temporary directories, removed after each case, and decode the committed 0.25-second synthetic MP3 fixture with the machine’s existing FFmpeg. The tests require FFmpeg in addition to ffprobe; production operations still need only ffprobe. No test installs, downloads or contacts a service. A killed test may leave its temporary directory.

## Success

- Each staged source matches its supplied byte count and hash; the gateway arm removes only its verified source and the local arm retains a real UUID source WAV.
- Every filed take passes full validation with exact original tokens and a measured aligned clock; failed/unfinished evidence remains resumable.
- Current changes require fresh eligible evidence and the caller's exact prior registry; other scenes and refused takes' earlier pointers stay intact.
- Legacy xAI evidence remains readable without a rewrite, install, synthesis or network request.
