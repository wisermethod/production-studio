---
root: production-studio
layout: 1
---

# Production Studio

A WISER domain plugin. This file is this root's constitution. The chain starts here: load it before the first read or write under this root.

A WISER plugin for producing and editing video, training videos first: scripts written for ear and eye, narration in your own cloned voice, screen walkthroughs, animation, editing and publishing. No skills or experts have been built yet.

## What this root is

An authoring tree, not a working folder. Nothing here is anyone's work product; everything here is the capability that such work uses. Output belongs in the working folder a session attaches, never in this root.

This plugin carries no user-root `type:`, no Provides block, and no Onboarding keys.

## Composition

This plugin loads alongside `wiser` and may assume it is present. It references `wiser` primitives and standards rather than duplicating them, per `wiser/AGENTS.md` Precedence and routing. Copying a `wiser` primitive into this tree to remove the dependency is the defect; referencing one is the pattern. Nothing in `wiser` references this plugin.

## Write mode

In use this root is read-only. Nothing is written under this root during a session that uses it, and output lands in the working folder the session attached, in the directories that folder's own `AGENTS.md` declares. Authoring this root is separate work, entered by the operator's authorization for a named phase and a named target, per `wiser/AGENTS.md` Workspace Model. A Playbook, a ledger row or the operator's own instruction may record that authorization; none of them is the grant.

A session that has loaded this constitution and the base plugin's refuses ordinary writes to both.

What may be written here is governed by this heading and by `wiser/AGENTS.md` Writes, Irreversibles, Workspace Model, and Working under this root.

## Families

| Directory | Holds |
|-----------|-------|
| `skills/` | This plugin's skills |
| `experts/` | This plugin's experts |

Family placement follows `wiser/standards/primitives.md`. This plugin ships no `gateway/`; the base plugin alone ships one. Where this plugin ships `connectors/`, those connectors load through that gateway's repeated `--connectors` flag, per `wiser/gateway/SETUP.md`.

Each family directory carries its own `AGENTS.md` index. An empty index is still an index.

## Standing constraint

Whatever this plugin becomes, it asks for consent once. Before any sample of a real person's voice or likeness is taken for cloning, it asks once whether that person has approved the use, and the member's yes is the answer: it asks no proof, and it does not ask again for the same voice or likeness. Music and footage the member supplies are treated as cleared and are never asked about. The ask sits in the body of the skill that sets up a cloned voice or likeness, because a host that loads skills alone never reads this file. That constraint is decided; it binds any later design and is not open for a build session to relax or to tighten.

## Layout

This root's layout is governed by `wiser/standards/plugin-root.md`. That standard's C1 owns the `layout:` stamp: the current tree version, a bare nonnegative integer. `wiser/skills/Onboard Plugin Root/` writes it last, only once every applicable obligation other than the stamp itself scores present or N/A. A stamp written before that would advertise a conformance nothing had earned, which is why an unstamped tree reads as not current rather than as clean.

## Handover

Stood up 2026-10-19 by `wiser/skills/Onboard Plugin Root/`. Each line is owed to a person and names what closes it. Strike a line when its boundary closes; when the last line goes, delete this section.

- Repository: owed (the operator; waits on creating `wisermethod/production-studio`, setting its remote and choosing its visibility)
- First commit and push: owed (the operator; waits on the repository)
- A row in the operator's repository roster: owed (the operator; waits on the repository)
- Descriptions of this root: owed (the operator; waits on the build records that describe this plugin as planned and not yet stood up being updated)
