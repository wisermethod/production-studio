'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { screen, bytes, utf8, sha } = require('./paths.js');
const { parse, json, fail, Q } = require('./rational.js');
const { normalize, normalizeTiming, normalizeLines, normalizeLayer, object, list, number } = require('./spec.js');
const { page, layerPage } = require('./page.js');
const srt = require('./srt.js');
const fileHashes = files => files.map(f => ({ path: f.path, sha256: sha(f.bytes) })).sort((a,b) => a.path < b.path ? -1 : 1);
function compose(input, output) {
  const source = screen(input, '--spec'), dest = screen(output, '--output', true);
  const raw = bytes(source), { data, assets, events, cues } = normalize(parse(utf8(raw)));
  const files = Object.entries(page(data)).map(([file, content]) => ({ path: file, bytes: Buffer.from(content) }));
  files.push(...assets, { path: 'captions.srt', bytes: Buffer.from(srt.compose(cues, data.fps)) });
  const record = { spec_sha256: sha(raw), files: fileHashes(files),
    events, captions: cues, frames: data.frames, fps: data.fps, duration: data.duration };
  files.push({ path: 'compose.json', bytes: Buffer.from(json(record)) });
  writeDirectory(dest, files, 'compose', true);
  return { ...record, compose_sha256: sha(files.at(-1).bytes) };
}
function timing(input, output) {
  const source = screen(input, '--spec'), dest = screen(output, '--output', true);
  const raw = bytes(source), resolved = normalizeTiming(parse(utf8(raw)));
  const files = [{ path: 'captions.srt', bytes: Buffer.from(srt.compose(resolved.cues, resolved.fps)) }];
  const record = { spec_sha256: sha(raw), ...resolved, files: fileHashes(files) };
  files.push({ path: 'timing.json', bytes: Buffer.from(json(record)) });
  writeDirectory(dest, files, 'timing');
  return { ...record, timing_sha256: sha(files.at(-1).bytes) };
}
function layer(input, output) {
  const source = screen(input, '--spec'), dest = screen(output, '--output', true);
  const raw = bytes(source), { data, assets, timing_sha256 } = normalizeLayer(parse(utf8(raw)));
  const files = Object.entries(layerPage(data)).map(([file, content]) => ({ path: file, bytes: Buffer.from(content) }));
  files.push(...assets);
  const record = { spec_sha256: sha(raw), timing_sha256, width: data.width, height: data.height,
    fps: data.fps, frames: data.frames, duration: data.duration, cues: data.captions.cues, files: fileHashes(files) };
  files.push({ path: 'layer.json', bytes: Buffer.from(json(record)) });
  writeDirectory(dest, files, 'layer', true);
  return { ...record, layer_sha256: sha(files.at(-1).bytes) };
}
function lines(input, output) {
  const source = screen(input, '--spec'), dest = screen(output, '--output', true);
  const raw = bytes(source);
  const record = { lines: normalizeLines(parse(utf8(raw))), spec_sha256: sha(raw) };
  const content = Buffer.from(json(record));
  writeFile(dest, content, 'lines');
  return { ...record, lines_sha256: sha(content) };
}
function writeDirectory(dest, files, command, project = false) {
  // No validation or source reads occur after this point. Own only the directory
  // successfully created here; never remove another process's existing output.
  let created = false;
  try {
    fs.mkdirSync(dest); created = true;
    if (project) fs.mkdirSync(path.join(dest, 'project'));
    for (const file of files) fs.writeFileSync(path.join(dest, file.path), file.bytes, { flag: 'wx' });
  } catch (error) {
    if (created) fs.rmSync(dest, { recursive: true, force: true });
    fail(`${command} could not write new output (${error.code || 'write failure'}); check permissions and disk space`);
  }
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
  writeFile(dest, content, 'captions');
  return { cues: cues.length, sha256: sha(content) };
}
function writeFile(dest, content, command) {
  let fd;
  try {
    fd = fs.openSync(dest, 'wx'); fs.writeFileSync(fd, content); fs.closeSync(fd); fd = undefined;
  } catch (error) {
    if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(dest); }
    fail(`${command} could not write new output (${error.code || 'write failure'}); check permissions and disk space`);
  }
}
module.exports = { compose, timing, lines, captions, layer };
