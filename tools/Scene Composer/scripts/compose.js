'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { screen, bytes, utf8 } = require('./paths.js');
const { parse, json, fail, Q } = require('./rational.js');
const { normalize, object, list, number } = require('./spec.js');
const { page } = require('./page.js');
const srt = require('./srt.js');
const sha = value => createHash('sha256').update(value).digest('hex');
function compose(input, output) {
  const source = screen(input, '--spec'), dest = screen(output, '--output', true);
  const raw = bytes(source), { data, assets, events, cues } = normalize(parse(utf8(raw)));
  const files = Object.entries(page(data)).map(([file, content]) => ({ path: file, bytes: Buffer.from(content) }));
  files.push(...assets, { path: 'captions.srt', bytes: Buffer.from(srt.compose(cues, data.fps)) });
  const record = { spec_sha256: sha(raw), files: files.map(f => ({ path: f.path, sha256: sha(f.bytes) })).sort((a,b) => a.path < b.path ? -1 : 1),
    events, captions: cues, frames: data.frames, fps: data.fps, duration: data.duration };
  files.push({ path: 'compose.json', bytes: Buffer.from(json(record)) });
  // No validation or source reads occur after this point. Own only the directory
  // successfully created here; never remove another process's existing output.
  let created = false;
  try {
    fs.mkdirSync(dest); created = true; fs.mkdirSync(path.join(dest, 'project'));
    for (const file of files) fs.writeFileSync(path.join(dest, file.path), file.bytes, { flag: 'wx' });
  } catch (error) {
    if (created) fs.rmSync(dest, { recursive: true, force: true });
    fail(`compose could not write new output (${error.code || 'write failure'}); check permissions and disk space`);
  }
  return { ...record, compose_sha256: sha(files.at(-1).bytes) };
}
function captions(input, output) {
  const source = screen(input, '--list'), dest = screen(output, '--output', true);
  const entries = list(parse(utf8(bytes(source))), 'list'), cues = [];
  let previousStart = null, previousEnd = null;
  for (const v of entries) {
    object(v, 'list item', ['srt','start']);
    const start = number(v.start, 'list.start');
    if (previousStart !== null && start.cmp(previousStart) < 0) fail('caption list starts run out of order');
    previousStart = start;
    const scene = srt.read(utf8(bytes(screen(v.srt, 'list.srt'))));
    for (const c of scene) {
      const a = new Q(c.start, 1000n).add(start), b = new Q(c.end, 1000n).add(start);
      if (previousEnd !== null && a.cmp(previousEnd) < 0) fail('caption cues overlap or run out of order');
      previousEnd = b;
      cues.push({ start: srt.milliseconds(a), end: srt.milliseconds(b), text: c.text });
    }
  }
  const content = Buffer.from(srt.write(cues));
  let fd;
  try {
    fd = fs.openSync(dest, 'wx'); fs.writeFileSync(fd, content); fs.closeSync(fd); fd = undefined;
  } catch (error) {
    if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(dest); }
    fail(`captions could not write new output (${error.code || 'write failure'}); check permissions and disk space`);
  }
  return { cues: cues.length, sha256: sha(content) };
}
module.exports = { compose, captions };
