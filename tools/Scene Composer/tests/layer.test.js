'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { fixture, call, ok, refused, tree, TOOL } = require('./support.js');
const { run } = require('../scripts/scene-composer.js');
const { stateAt } = require('../scripts/page.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const style = () => ({ font: 'Local', size: 18, weight: 400, color: '#fff', background: '#111e', padding: 4, radius: 3, position: 'bottom', margin: 8, max_width: 300 });
function setup(t) {
  const f = fixture(t);
  const timing = { frame: f.spec.frame, duration: 1, lead: 0, tail: 0, captions: { lines: [{ text: 'Open', at: { seconds: 0.1 } }, { text: 'Save.', at: { seconds: 0.6 } }] } };
  const out = path.join(f.dir, 'timed');
  ok(['timing', '--spec', f.save(timing, 'timing-spec.json'), '--output', out]);
  f.timingPath = path.join(out, 'timing.json');
  f.timing = JSON.parse(fs.readFileSync(f.timingPath, 'utf8'));
  f.spec = { frame: timing.frame, timing: { path: f.timingPath, sha256: sha(fs.readFileSync(f.timingPath)) }, fonts: [f.font], style: style() };
  f.retime = raw => { fs.writeFileSync(f.timingPath, raw === undefined ? JSON.stringify(f.timing) : raw); f.spec.timing.sha256 = sha(fs.readFileSync(f.timingPath)); };
  return f;
}
const args = f => ['layer', '--spec', f.save(f.spec), '--output', f.output];
function bad(name, change, pattern) {
  test(`layer refuses ${name} without writing`, t => {
    const f = setup(t); change(f); const command = args(f), before = tree(f.dir);
    refused(command, pattern); assert.deepEqual(tree(f.dir), before);
  });
}
function dom(js) {
  const root = { style: {}, children: [], appendChild(e) { this.children.push(e); } };
  let listener;
  vm.runInNewContext(js, {
    document: { getElementById(id) { assert.equal(id, 'root'); return root; }, createElement(tag) { assert.equal(tag, 'div'); return { style: {} }; } },
    window: { addEventListener(name, fn) { assert.equal(name, 'video-render:seek'); listener = fn; } }
  });
  return { root, seek(frame, fps = 30) { listener({ detail: { time: frame / fps } }); return root.children.map(e => Number(e.style.opacity)); } };
}
test('layer help, version, old runtime and package version', () => {
  for (const alias of ['help', '--help']) {
    assert.match(run([alias], '0.1.0'), /Scene Composer 0\.4\.0/);
    const r = call([alias]); assert.equal(r.status, 0); assert.equal(r.stderr, '');
    assert.match(r.stdout, /layer --spec <file.json> --output <new dir>/);
  }
  assert.equal(require('../package.json').version, '0.4.0');
  assert.throws(() => run(['layer'], '21.9.0'), /layer refuses Node 21.*requires Node >=22/);
});
for (const [flags, pattern] of [
  [[], /missing flag --spec/], [['--spec', '/unused'], /missing flag --output/], [['--output', '/unused'], /missing flag --spec/],
  [['--spec'], /missing value for --spec/], [['--output'], /missing value for --output/], [['--spec', '--output'], /missing value for --spec/],
  [['--spec', '/a', '--spec', '/b'], /repeated flag --spec/], [['--output', '/a', '--output', '/b'], /repeated flag --output/],
  ...['extra', 'help', '--help', '--list', '--install', '--env', '--unknown', '--spec=/unused', '--output=/unused'].map(flag => [[flag], new RegExp('unknown argument ' + flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))])
]) test(`layer CLI refuses ${flags.join(' ') || 'missing flags'}`, t => {
  const f = fixture(t), before = tree(f.dir); refused(['layer', ...flags], pattern); assert.deepEqual(tree(f.dir), before);
});
for (const key of ['frame', 'timing', 'fonts', 'style']) bad(`missing ${key}`, f => delete f.spec[key], new RegExp(`missing field spec.${key}`));
for (const [label, get] of [['spec', f => f.spec], ['frame', f => f.spec.frame], ['timing', f => f.spec.timing], ['font', f => f.spec.fonts[0]], ['style', f => f.spec.style]]) {
  bad(`unknown key in ${label}`, f => get(f).unexpected = true, /unknown key .*unexpected/);
}
for (const key of Object.keys(style())) bad(`missing style.${key}`, f => delete f.spec.style[key], new RegExp(`missing field style.${key}`));
for (const [key, value, pattern] of [
  ['font', 'Absent', /style.font/], ['size', 0, /style.size.*positive/], ['size', '18', /style.size.*number/],
  ['weight', 1001, /weight bounds/], ['weight', 0, /style.weight.*integer/], ['weight', 1.5, /style.weight.*integer/],
  ['color', 'red', /style.color.*hex/], ['background', 'transparent', /style.background.*hex/],
  ['padding', -1, /style.padding.*nonnegative/], ['radius', -1, /style.radius.*nonnegative/], ['position', 'center', /style.position/],
  ['margin', -1, /style.margin.*nonnegative/], ['margin', 90, /frame.*bounds/], ['max_width', 321, /frame.*bounds/], ['max_width', 0, /style.max_width.*positive/]
]) bad(`style.${key} = ${JSON.stringify(value)}`, f => f.spec.style[key] = value, pattern);
for (const key of ['frame', 'timing', 'fonts', 'style']) bad(`null ${key}`, f => f.spec[key] = null, /must be/);
for (const key of ['width', 'height', 'fps']) bad(`missing frame.${key}`, f => delete f.spec.frame[key], new RegExp(`missing field frame.${key}`));
for (const [key, value, pattern] of [['width', 321, /even/], ['height', 181, /even/], ['width', 0, /integer/], ['height', 2.5, /integer/], ['fps', 0, /fps.*integer/], ['fps', 29.97, /fps.*integer/], ['fps', true, /fps.*number/], ['fps', 9007199254740992, /fps.*integer/]]) {
  bad(`frame.${key} = ${value}`, f => f.spec.frame[key] = value, pattern);
}
for (const key of ['path', 'sha256']) bad(`missing timing.${key}`, f => delete f.spec.timing[key], new RegExp(`missing field timing.${key}`));
bad('timing hash mismatch', f => f.spec.timing.sha256 = '0'.repeat(64), /timing.*sha256.*match/);
for (const value of [null, true, '', 'bad', 'A'.repeat(64)]) bad(`timing hash ${JSON.stringify(value)}`, f => f.spec.timing.sha256 = value, /timing.sha256.*must be/);
bad('timing fps mismatch', f => { f.timing.fps = 25; f.retime(); }, /timing.fps.*frame.fps/);
for (const key of ['spec_sha256', 'fps', 'frames', 'duration', 'lead', 'tail', 'marks', 'cues', 'files']) bad(`missing timing file ${key}`, f => { delete f.timing[key]; f.retime(); }, new RegExp(`missing field timing.${key}`));
bad('unknown timing file key', f => { f.timing.unexpected = 0; f.retime(); }, /unknown key timing.unexpected/);
for (const value of [0, -1, 1.5, true, '30', 9007199254740992]) bad(`timing frames ${JSON.stringify(value)}`, f => { f.timing.frames = value; f.retime(); }, /timing.frames.*must be/);
bad('timing cues type', f => { f.timing.cues = {}; f.retime(); }, /timing.cues.*list/);
for (const key of ['text', 'start_frame', 'end_frame', 'start', 'end']) bad(`cue missing ${key}`, f => { delete f.timing.cues[0][key]; f.retime(); }, new RegExp('missing field timing.cues\\[0\\].' + key));
bad('cue unknown key', f => { f.timing.cues[0].unexpected = 1; f.retime(); }, /unknown key timing.cues\[0\].unexpected/);
for (const [label, edit, pattern] of [
  ['past frames', c => c.end_frame = 31, /end_frame/], ['no frames', c => c.end_frame = c.start_frame, /end_frame/],
  ['fractional start', c => c.start_frame = 1.5, /start_frame.*integer/], ['negative start', c => c.start_frame = -1, /start_frame.*nonnegative/],
  ['fractional end', c => c.end_frame = 10.5, /end_frame.*integer/], ['negative end', c => c.end_frame = -1, /end_frame.*nonnegative/],
  ['empty text', c => c.text = '', /text.*single-line/], ['multiline text', c => c.text = 'One\nTwo', /text.*single-line/],
  ['control text', c => c.text = 'bad\u007f', /text.*controls/], ['numeric text', c => c.text = 2, /text.*single-line/]
]) bad(`cue ${label}`, f => { edit(f.timing.cues[0]); f.retime(); }, pattern);
bad('overlapping cues', f => { f.timing.cues[0].end_frame = 19; f.retime(); }, /cues\[1\].start_frame.*overlap/);
bad('out of order cues', f => { f.timing.cues.reverse(); f.retime(); }, /cues\[1\].start_frame.*increasing/);
bad('equal cue starts', f => { f.timing.cues[1].start_frame = f.timing.cues[0].start_frame; f.retime(); }, /start_frame.*increasing/);
bad('undeclared family with no cues', f => { f.timing.cues = []; f.retime(); f.spec.style.font = 'Absent'; }, /style.font.*family in fonts/);
for (const [name, edit, pattern] of [
  ['duplicate declaration', f => f.spec.fonts.push(f.font), /duplicate font/], ['bad signature', f => fs.writeFileSync(f.font.path, 'bad'), /font must/],
  ['weight', f => f.spec.fonts[0].weight = 1001, /font weight/], ['style', f => f.spec.fonts[0].style = 'sideways', /font weight.*style/],
  ['family', f => f.spec.fonts[0].family = 'bad\nfamily', /font.family.*single-line/], ['missing family', f => delete f.spec.fonts[0].family, /missing field font.family/],
  ['missing path', f => delete f.spec.fonts[0].path, /missing field font.path/]
]) bad(`font ${name}`, edit, pattern);
for (const [name, raw, pattern] of [
  ['style duplicate', f => JSON.stringify(f.spec).replace('"size":', '"size":1,"size":'), /duplicate key size/],
  ['frame duplicate', f => JSON.stringify(f.spec).replace('"fps":', '"fps":1,"fps":'), /duplicate key fps/],
  ['timing reference duplicate', f => JSON.stringify(f.spec).replace('"sha256":', '"sha256":"x","sha256":'), /duplicate key sha256/],
  ['font duplicate', f => JSON.stringify(f.spec).replace('"family":', '"family":"x","family":'), /duplicate key family/],
  ['top duplicate', f => JSON.stringify(f.spec).replace('"fonts":', '"fonts":[],"fonts":'), /duplicate key fonts/],
  ['invalid JSON', () => '{', /JSON/], ['trailing JSON', () => '{} true', /JSON/], ['invalid UTF-8', () => Buffer.from([255]), /UTF-8/]
]) test(`layer refuses ${name} before writing`, t => {
  const f = setup(t), command = args(f); fs.writeFileSync(command[2], raw(f)); const before = tree(f.dir);
  refused(command, pattern); assert.deepEqual(tree(f.dir), before);
});
for (const [name, raw, pattern] of [
  ['duplicate key', f => JSON.stringify(f.timing).replace('"frames":', '"frames":1,"frames":'), /duplicate key frames/],
  ['nested duplicate key', f => JSON.stringify(f.timing).replace('"start_frame":', '"start_frame":0,"start_frame":'), /duplicate key start_frame/],
  ['invalid JSON', () => '{', /JSON/], ['invalid UTF-8', () => Buffer.from([255]), /UTF-8/]
]) bad(`timing file ${name}`, f => f.retime(raw(f)), pattern);
for (const field of ['--spec', '--output', 'timing.path', 'font.path']) for (const [label, value, pattern] of [
  ['relative', 'relative', /absolute/], ['protected', 'Memory/new', /protected/], ['env', '.env', /protected/],
  ['env prefix', '.ENV.local', /protected/], ['env suffix', 'settings.env', /protected/], ['credentials', 'Credentials.JSON', /protected/]
]) test(`layer screens ${field} ${label}`, t => {
  const f = setup(t), target = label === 'relative' ? value : path.join(f.dir, value);
  if (field === 'timing.path') f.spec.timing.path = target;
  if (field === 'font.path') f.spec.fonts[0].path = target;
  const command = args(f); if (field.startsWith('--')) command[field === '--spec' ? 2 : 4] = target;
  const before = tree(f.dir); refused(command, pattern); assert.deepEqual(tree(f.dir), before);
});
test('layer screens existing outputs, parents, source types and symlinks', t => {
  const f = setup(t), command = args(f); fs.mkdirSync(f.output);
  refused(command, /already exists/); assert.deepEqual(fs.readdirSync(f.output), []);
  fs.symlinkSync(TOOL, path.join(f.dir, 'tool-link'));
  fs.symlinkSync(path.join(f.dir, 'loop'), path.join(f.dir, 'loop'));
  fs.symlinkSync(path.join(f.dir, 'missing'), path.join(f.dir, 'dangling'));
  for (const dest of [path.join(f.dir, 'absent', 'out'), path.join(TOOL, 'new'), path.join(f.dir, 'tool-link', 'new'), path.join(f.dir, 'loop', 'new'), path.join(f.dir, 'dangling', 'new')]) {
    refused(['layer', '--spec', command[2], '--output', dest], /parent|inside the tool|canonicalized|symbolic link/);
  }
  for (const source of [f.dir, path.join(f.dir, 'missing')]) refused(['layer', '--spec', source, '--output', path.join(f.dir, 'new')], /not a file|not a readable file/);
  fs.symlinkSync(f.dir, path.join(f.dir, 'parent-link')); fs.symlinkSync(command[2], path.join(f.dir, 'spec-link'));
  ok(['layer', '--spec', path.join(f.dir, 'spec-link'), '--output', path.join(f.dir, 'parent-link', 'new')]);
});
test('layer writes complete deterministic payloads, sorted hashes, exact cues and stdout', t => {
  const f = setup(t), command = args(f), a = ok(command), other = path.join(f.dir, 'other');
  const b = ok(['layer', '--spec', command[2], '--output', other]); assert.deepEqual(a, b); assert.deepEqual(tree(f.output), tree(other));
  assert.deepEqual(fs.readdirSync(f.output).sort(), ['layer.json', 'project']);
  assert.deepEqual(a.files.map(f => f.path), ['project/font-001.woff2', 'project/index.html', 'project/scene.js', 'project/style.css']);
  for (const file of a.files) assert.equal(file.sha256, sha(fs.readFileSync(path.join(f.output, file.path))));
  const raw = fs.readFileSync(path.join(f.output, 'layer.json'), 'utf8'), record = JSON.parse(raw);
  assert.deepEqual(Object.keys(record).sort(), ['cues', 'duration', 'files', 'fps', 'frames', 'height', 'spec_sha256', 'timing_sha256', 'width']);
  assert.deepEqual(a, { ...record, layer_sha256: sha(raw) }); assert.deepEqual(a.cues, f.timing.cues);
  assert.equal(a.spec_sha256, sha(fs.readFileSync(command[2]))); assert.equal(a.timing_sha256, f.spec.timing.sha256);
  assert.deepEqual([a.width, a.height, a.fps, a.frames, a.duration], [320, 180, 30, 30, 1]);
  assert.equal(raw, JSON.stringify(record, null, 2) + '\n'); assert.equal(raw.includes(f.dir), false); assert.equal(raw.includes('\r'), false);
  function sorted(v) { if (v && typeof v === 'object') { if (!Array.isArray(v)) assert.deepEqual(Object.keys(v), Object.keys(v).sort()); Object.values(v).forEach(sorted); } } sorted(record);
  assert.deepEqual(fs.readFileSync(path.join(f.output, 'project/font-001.woff2')), fs.readFileSync(f.font.path));
});
test('empty timing makes an empty layer but copies its declared fonts', t => {
  const f = setup(t); f.timing.cues = []; f.retime(); const r = ok(args(f)); assert.deepEqual(r.cues, []);
  const page = dom(fs.readFileSync(path.join(f.output, 'project/scene.js'), 'utf8'));
  assert.deepEqual(page.root.children, []); assert.deepEqual(page.seek(20), []);
  assert.deepEqual(fs.readFileSync(path.join(f.output, 'project/font-001.woff2')), fs.readFileSync(f.font.path));
});
for (const position of ['top', 'bottom']) for (const background of ['none', '#1234']) test(`layer shares compose caption CSS and stateAt: ${position} ${background}`, t => {
  const f = setup(t); Object.assign(f.spec.style, { position, background }); ok(args(f));
  const composed = { frame: f.spec.frame, still: { path: path.join(f.dir, 'still.png') }, duration: 1, lead: 0, tail: 0, fonts: f.spec.fonts,
    captions: { mode: 'drawn', style: f.spec.style, lines: [{ text: 'Open', at: { seconds: 0.1 } }, { text: 'Save.', at: { seconds: 0.6 } }] } };
  const out = path.join(f.dir, 'composed'); ok(['compose', '--spec', f.save(composed, 'compose-spec.json'), '--output', out]);
  const read = (dir, file) => fs.readFileSync(path.join(dir, 'project', file), 'utf8');
  assert.equal(read(f.output, 'style.css').match(/\.caption \{[^}]*\}/)[0], read(out, 'style.css').match(/\.caption \{[^}]*\}/)[0]);
  assert.ok(read(f.output, 'scene.js').includes(stateAt.toString())); assert.ok(read(out, 'scene.js').includes(stateAt.toString()));
  const html = read(f.output, 'index.html'), css = read(f.output, 'style.css'), js = read(f.output, 'scene.js');
  assert.equal((html.match(/data-video-root/g) || []).length, 1); assert.match(css, /width: 320px; height: 180px/);
  assert.doesNotMatch(html + css, /<img|<svg|#camera|#cursor|#chip|\.callout|\.ripple|box-shadow/);
  assert.doesNotMatch(css, /(?:html|body|#root)[^{]*\{[^}]*background/);
  assert.doesNotMatch(js + css, /setTimeout|setInterval|requestAnimationFrame|will-change|\btransition\s*:|\banimation\s*:/);
  const page = dom(js); assert.deepEqual(page.root.children.map(e => [e.className, e.textContent]), [['caption', 'Open'], ['caption', 'Save.']]);
  assert.deepEqual(page.seek(2), [0, 0]); assert.deepEqual(page.seek(3), [0.25, 0]); assert.deepEqual(page.seek(4), [0.5, 0]);
  assert.deepEqual(page.seek(6), [1, 0]); assert.deepEqual(page.seek(18), [0, 0.25]); assert.deepEqual(page.seek(30), [0, 0]);
  page.seek(0); assert.deepEqual(page.seek(18), [0, 0.25]);
});
test('layer uses moved start_frame without resolving the unchanged start seconds', t => {
  const f = setup(t); f.timing.cues[0].start_frame = 7; f.retime(); const r = ok(args(f));
  assert.equal(r.cues[0].start, 0.1); assert.equal(r.cues[0].start_frame, 7);
  const page = dom(fs.readFileSync(path.join(f.output, 'project/scene.js'), 'utf8'));
  assert.deepEqual(page.seek(3), [0, 0]); assert.deepEqual(page.seek(7), [0.25, 0]);
});
test('layer rolls back handled writes and preserves competing output', t => {
  const f = setup(t), command = args(f), before = tree(f.dir), write = fs.writeFileSync, mkdir = fs.mkdirSync;
  const { layer } = require('../scripts/compose.js');
  try { let n = 0; fs.writeFileSync = function(file, ...rest) { if (String(file).startsWith(f.output) && ++n === 3) { const e = new Error('planted'); e.code = 'EIO'; throw e; } return write.call(this, file, ...rest); };
    assert.throws(() => layer(command[2], f.output), /layer could not write new output \(EIO\)/);
  } finally { fs.writeFileSync = write; } assert.deepEqual(tree(f.dir), before);
  try { fs.mkdirSync = function(dir, ...rest) { if (dir === f.output) { mkdir.call(this, dir); write(path.join(dir, 'owner.txt'), 'other process'); } return mkdir.call(this, dir, ...rest); };
    assert.throws(() => layer(command[2], f.output), /EEXIST/);
  } finally { fs.mkdirSync = mkdir; } assert.equal(fs.readFileSync(path.join(f.output, 'owner.txt'), 'utf8'), 'other process');
});
// Decode the screenshot itself, including PNG row filters. A synthesized alpha channel cannot prove transparency.
function rgba(file) {
  const bytes = fs.readFileSync(file); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), type = bytes[25];
  assert.equal(bytes[24], 8); assert.ok(type === 6 || type === 4, 'PNG must carry an alpha channel'); assert.equal(bytes[28], 0);
  const channels = type === 6 ? 4 : 2, chunks = [];
  for (let p = 8; p < bytes.length;) { const n = bytes.readUInt32BE(p); if (bytes.toString('ascii', p + 4, p + 8) === 'IDAT') chunks.push(bytes.subarray(p + 8, p + 8 + n)); p += 12 + n; }
  const packed = zlib.inflateSync(Buffer.concat(chunks)), stride = width * channels, decoded = Buffer.alloc(height * stride);
  assert.equal(packed.length, height * (stride + 1));
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < height; y++) { const filter = packed[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) { const i = y * stride + x, a = x >= channels ? decoded[i - channels] : 0, b = y ? decoded[i - stride] : 0, c = y && x >= channels ? decoded[i - stride - channels] : 0;
      decoded[i] = packed[y * (stride + 1) + 1 + x] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
    }
  }
  return { width, height, alpha: Array.from({ length: width * height }, (_, i) => decoded[i * channels + channels - 1]) };
}
test('video-render layer sequence has decoded alpha only inside the caption box', { skip: !process.env.SCENE_COMPOSER_VIDEO_RENDER ? 'SCENE_COMPOSER_VIDEO_RENDER unset; layer render not run' : false, timeout: 240000 }, t => {
  const f = setup(t); f.spec.fonts[0].path = process.env.SCENE_COMPOSER_TEST_ASSETS ? path.join(process.env.SCENE_COMPOSER_TEST_ASSETS, 'font.woff2') : f.font.path;
  const result = ok(args(f)), out = path.join(f.dir, 'sequence');
  const r = spawnSync(process.execPath, [process.env.SCENE_COMPOSER_VIDEO_RENDER, 'sequence', '--project', path.join(f.output, 'project'), '--output', out, '--width', '320', '--height', '180', '--fps', '30', '--duration', String(result.duration)], { encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).frameCount, 30);
  for (let n = 0; n < 30; n++) { const image = rgba(path.join(out, 'frames', `frame_${String(n + 1).padStart(6, '0')}.png`)); assert.equal(image.width, 320); assert.equal(image.height, 180);
    let visible = 0;
    for (const [i, alpha] of image.alpha.entries()) if (alpha) { visible++; const x = i % 320, y = Math.floor(i / 320); assert.ok(x >= 10 && x < 310 && y >= 140 && y < 172, `alpha outside caption box on frame ${n}: ${x},${y}`); }
    if (n < 3) assert.equal(visible, 0, 'before first cue every pixel must have alpha 0'); else assert.ok(visible > 0, `caption absent on frame ${n}`);
  }
});
