---
root: production-studio
layout: 1
---

# Production Studio

A WISER domain plugin. This file is this root's constitution. The chain starts here: load it before the first read or write under this root.

A WISER plugin for producing and editing video, training videos first: scripts written for ear and eye, narration in your own voice clone, screen walkthroughs, animation, editing and publishing. Its first slice, for training videos, is built; each family's `AGENTS.md` index lists what it holds.

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
| `tools/` | This plugin's tools |

Family placement follows `wiser/standards/primitives.md`. This plugin ships no `gateway/`; the base plugin alone ships one. Where this plugin ships `connectors/`, those connectors load through that gateway's repeated `--connectors` flag, per `wiser/gateway/SETUP.md`.

Each family directory carries its own `AGENTS.md` index. An empty index is still an index.

## Standing constraint

Whatever this plugin becomes, it asks for consent once. Before it takes any sample to clone a real person's voice or likeness, it asks once whether that person has approved being cloned, and the member's yes is the answer: it asks no proof. The yes is kept where a later production finds it, so no production asks again for the same voice or likeness. Music and footage the member supplies are treated as cleared for use in a production and are never asked about; the one ask is about cloning a person, not about a recording. Every skill that clones a voice or likeness carries this rule in its own body, because a host that loads skills alone never reads this file. That constraint is decided; it binds any later design and is not open for a build session to relax or to tighten.

## Layout

This root's layout is governed by `wiser/standards/plugin-root.md`. That standard's C1 owns the `layout:` stamp: the current tree version, a bare nonnegative integer. `wiser/skills/Onboard Plugin Root/` writes it last, only once every applicable obligation other than the stamp itself scores present or N/A. A stamp written before that would advertise a conformance nothing had earned, which is why an unstamped tree reads as not current rather than as clean.
