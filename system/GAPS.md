# Gaps

What this plugin does not do, declared by the primitive that names it.

A gap is a capability this root does not provide that a primitive's own body names as missing (`wiser/standards/primitives.md`). This file collects every declared `gaps` entry, by hand, and is corrected whenever a primitive's gaps change. It carries capability gaps only, and names what is missing, never where it went.

Counted 2026-10-24: 3 gaps across 1 primitive. Bullet count: `grep -E '^- ' system/GAPS.md | wc -l` returns 3, and the same count derived from the primitives' own `gaps:` frontmatter returns 3.

## Tools

### Timeline

- Cutting a recording that carries audio
- Slowing a segment down or changing its speed by other than a whole number
- Cutting a segment longer than 18,000 output frames
