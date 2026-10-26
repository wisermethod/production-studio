# Gaps

What this plugin does not do, declared by the primitive that names it.

A gap is a capability this root does not provide that a primitive's own body names as missing (`wiser/standards/primitives.md`). This file collects every declared `gaps` entry, by hand, and is corrected whenever a primitive's gaps change. It carries capability gaps only, and names what is missing, never where it went.

Counted 2026-10-26: 10 gaps across 6 primitives. Bullet count: `grep -E '^- ' system/GAPS.md | wc -l` returns 10, and the same count derived from the primitives' own `gaps:` frontmatter returns 10.

## Skills

### Animate Scenes

- Captions in a written form different from the words narrated
- Drawn captions over an explainer scene

### Narrate

- Checking a take narrated in a language other than English

### Publish Video

- Publishing to a video host other than YouTube

### Set Up Voice Clone

- Cloning a person's likeness
- A voice clone for a member where xAI does not offer voice clones

## Tools

### Scene Composer

- Composing a scene from more than one still

### Timeline

- Cutting a recording that carries audio
- Slowing a segment down or changing its speed by other than a whole number
- Cutting a segment longer than 18,000 output frames
