'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fixture, call, ok, refused, tree, TOOL } = require('./support.js');
const { run } = require('../scripts/scene-composer.js');
const seconds = seconds => ({ seconds });
const word = (word, occurrence = 1) => ({ word, occurrence });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function setup(t) {
  const f = fixture(t);
  delete f.spec.still;
  return f;
}
function args(f) { return ['timing', '--spec', f.save(), '--output', f.output]; }
function bad(name, change, pattern) {
  test(`timing refusal: ${name}`, t => {
    const f = setup(t); change(f.spec, f);
    const command = args(f), before = tree(f.dir);
    refused(command, pattern);
    assert.deepEqual(tree(f.dir), before);
  });
}

test('timing is in help before runtime checks, with the closed command flags', t => {
  assert.match(run(['help'], '0.1.0'), /Scene Composer 0\.3\.0/);
  assert.match(run(['--help'], '0.1.0'), /timing --spec <file.json> --output <new dir>/);
  assert.throws(() => run(['timing'], '21.9.0'), /timing refuses Node 21.*requires Node >=22/);
  for (const alias of ['help', '--help']) {
    const r = call([alias]); assert.equal(r.status, 0); assert.equal(r.stderr, ''); assert.match(r.stdout, /timing --spec/);
  }
  refused(['captions', '--spec', '/unused'], /unknown argument --spec/);
  refused(['compose', '--list', '/unused'], /unknown argument --list/);
});
for (const [flags, pattern] of [
  [[], /missing flag --spec/], [['--spec', '/unused'], /missing flag --output/],
  [['--output', '/unused'], /missing flag --spec/], [['--spec'], /missing value for --spec/],
  [['--output'], /missing value for --output/], [['--spec', '--output'], /missing value for --spec/],
  [['--spec', '/a', '--spec', '/b'], /repeated flag --spec/],
  [['--output', '/a', '--output', '/b'], /repeated flag --output/],
  [['extra'], /unknown argument extra/], [['help'], /unknown argument help/],
  [['--help'], /unknown argument --help/], [['--list', '/unused'], /unknown argument --list/],
  [['--install'], /unknown argument --install/], [['--env', '/unused'], /unknown argument --env/],
  [['--spec=/unused'], /unknown argument --spec=/], [['--output=/unused'], /unknown argument --output=/]
]) test(`timing CLI refuses ${flags.join(' ') || 'missing flags'}`, () => {
  refused(['timing', ...flags], pattern);
});

for (const variant of ['take', 'duration', 'word on frame']) {
  test(`timing and compose share captions, length and event frames: ${variant}`, t => {
    const f = fixture(t);
    if (variant === 'duration') {
      delete f.spec.take; f.spec.duration = 4.1; delete f.spec.lead; delete f.spec.tail;
      f.spec.captions = { lines: [{ text: '  Literal <text>.  ', at: seconds(0.1) }, { text: 'Last', at: seconds(4.1) }] };
    } else {
      f.spec.lead = variant === 'word on frame' ? 0.1 : 0.25;
      f.spec.tail = 0.2; f.record.aligned_file.sample_count = 240001; f.save(f.record, 'take.json');
      f.spec.captions = { lines: [{ text: 'Open the folder', at: word('Open') }, { text: 'Save twice', at: word('Save.', 2) }] };
    }
    f.spec.camera = f.spec.captions.lines.map(line => ({ rect: 'full', at: line.at }));
    const composed = ok(['compose', '--spec', f.save(f.spec, 'compose-spec.json'), '--output', f.output]);
    const spec = Object.fromEntries(['frame', 'take', 'duration', 'lead', 'tail', 'captions'].filter(k => k in f.spec).map(k => [k, f.spec[k]]));
    spec.marks = [...spec.captions.lines].reverse().map((line, i) => ({ name: `beat ${i}`, at: line.at }));
    spec.marks.push({ name: 'shared time', at: spec.marks[0].at });
    const output = path.join(f.dir, 'timing');
    const result = ok(['timing', '--spec', f.save(spec, 'timing-spec.json'), '--output', output]);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'timing.json'), 'utf8'));
    const composeManifest = JSON.parse(fs.readFileSync(path.join(f.output, 'compose.json'), 'utf8'));
    assert.deepEqual(fs.readFileSync(path.join(output, 'captions.srt')), fs.readFileSync(path.join(f.output, 'captions.srt')));
    for (const key of ['frames', 'fps', 'duration']) assert.equal(manifest[key], composeManifest[key]);
    assert.deepEqual(manifest.cues, composeManifest.captions);
    assert.deepEqual(result.cues, composed.captions);
    assert.deepEqual(result.marks.map(m => m.name), spec.marks.map(m => m.name));
    for (const [i, m] of result.marks.entries()) {
      const index = i === 1 ? 0 : 1;
      assert.equal(m.frame, composed.events.filter(e => e.kind === 'camera')[index].frame);
    }
    assert.equal(result.marks[0].frame_after, result.marks[2].frame_after);
    if (variant === 'word on frame') {
      assert.equal(result.marks[0].seconds, 4.2); assert.equal(result.marks[0].frame, 126); assert.equal(result.marks[0].frame_after, 127);
    } else if (variant === 'take') {
      assert.equal(result.marks[0].seconds, 4.35); assert.equal(result.marks[0].frame, 131); assert.equal(result.marks[0].frame_after, 131);
    }
  });
}

test('timing writes exactly two deterministic files, complete hashes and sorted JSON', t => {
  const f = setup(t); delete f.spec.lead; delete f.spec.tail;
  f.spec.captions = { lines: [{ text: 'Caf\u00e9 literal <tag>.', at: word('Open') }] };
  f.spec.marks = [{ name: 'origin', at: seconds(0) }, { name: 'Open', at: word('Open') }];
  const command = args(f), result = ok(command), other = path.join(f.dir, 'other');
  const second = ok(['timing', '--spec', command[2], '--output', other]);
  assert.deepEqual(tree(f.output), tree(other)); assert.deepEqual(result, second);
  assert.deepEqual(fs.readdirSync(f.output).sort(), ['captions.srt', 'timing.json']);
  const raw = fs.readFileSync(path.join(f.output, 'timing.json'), 'utf8'), record = JSON.parse(raw);
  assert.deepEqual(Object.keys(record).sort(), ['cues', 'duration', 'files', 'fps', 'frames', 'lead', 'marks', 'spec_sha256', 'tail']);
  assert.equal(record.lead, 0.25); assert.equal(record.tail, 0.5); assert.equal(record.frames, 173);
  assert.equal(record.spec_sha256, sha(fs.readFileSync(command[2])));
  assert.deepEqual(record.files, [{ path: 'captions.srt', sha256: sha(fs.readFileSync(path.join(f.output, 'captions.srt'))) }]);
  assert.deepEqual(result, { ...record, timing_sha256: sha(raw) });
  assert.equal(raw.endsWith('\n'), true); assert.equal(raw.includes(f.dir), false);
  assert.equal(raw, JSON.stringify(record, null, 2) + '\n');
  function sorted(v) {
    if (v && typeof v === 'object') {
      if (!Array.isArray(v)) assert.deepEqual(Object.keys(v), Object.keys(v).sort());
      Object.values(v).forEach(sorted);
    }
  }
  sorted(record);
});
test('timing needs no still, font or take, and permits empty captions and marks', t => {
  const f = setup(t); delete f.spec.take; f.spec.duration = 0.41;
  fs.unlinkSync(path.join(f.dir, 'still.png')); fs.unlinkSync(path.join(f.dir, 'font.woff2')); fs.unlinkSync(path.join(f.dir, 'take.json'));
  const result = ok(args(f)); assert.equal(result.frames, 13); assert.equal(result.duration, 13 / 30);
  assert.deepEqual(result.cues, []); assert.deepEqual(result.marks, []);
  assert.equal(fs.readFileSync(path.join(f.output, 'captions.srt'), 'utf8'), '');
  f.spec.captions = { lines: [] }; f.spec.marks = []; f.output = path.join(f.dir, 'explicit-empty');
  assert.deepEqual(ok(args(f)).cues, []);
});
test('timing preserves decimal lexemes on either side of a frame and for frame_after', t => {
  const f = setup(t); delete f.spec.take; f.spec.duration = 5;
  f.spec.marks = ['exact', 'below', 'above'].map(name => ({ name, at: seconds(4.1) }));
  const input = f.save();
  // Replace separately so each numeric token keeps its own decimal lexeme.
  let i = 0; const values = ['4.1', '4.09999999999999999', '4.10000000000000001'];
  fs.writeFileSync(input, JSON.stringify(f.spec).replace(/4\.1/g, () => values[i++]));
  const r = ok(['timing', '--spec', input, '--output', f.output]);
  assert.deepEqual(r.marks.map(m => [m.frame, m.frame_after]), [[123, 124], [123, 123], [124, 124]]);
});

for (const key of ['still', 'fonts', 'colors', 'chip', 'cursor', 'clicks', 'camera', 'callouts']) bad(`drawing key ${key}`, s => s[key] = null, new RegExp(`unknown key spec\\.${key}`));
for (const key of ['mode', 'style']) bad(`captions.${key}`, s => s.captions = { [key]: key === 'mode' ? 'none' : {} }, new RegExp(`unknown key captions\\.${key}`));
for (const [name, get] of [
  ['spec', s => s], ['frame', s => s.frame], ['take', s => s.take],
  ['captions', s => s.captions = {}], ['caption', s => (s.captions = { lines: [{ text: 'Line', at: seconds(0) }] }).lines[0]],
  ['caption.at', s => (s.captions = { lines: [{ text: 'Line', at: seconds(0) }] }).lines[0].at],
  ['mark', s => (s.marks = [{ name: 'beat', at: seconds(0) }])[0]], ['mark.at', s => (s.marks = [{ name: 'beat', at: seconds(0) }])[0].at]
]) bad(`unknown key in ${name}`, s => get(s).unexpected = true, /unknown key .*unexpected/);

for (const [name, change, pattern] of [
  ['missing frame', s => delete s.frame, /missing field spec.frame/],
  ['missing duration', s => delete s.take, /duration is required without take/],
  ['take and duration', s => s.duration = 5, /mutually exclusive/],
  ['missing width', s => delete s.frame.width, /missing field frame.width/],
  ['missing height', s => delete s.frame.height, /missing field frame.height/],
  ['missing fps', s => delete s.frame.fps, /missing field frame.fps/],
  ['odd width', s => s.frame.width = 321, /must be even/], ['odd height', s => s.frame.height = 181, /must be even/],
  ['small frame', s => s.frame.height = 0, /safe integer/], ['zero fps', s => s.frame.fps = 0, /safe integer/],
  ['fractional fps', s => s.frame.fps = 29.97, /safe integer/], ['boolean fps', s => s.frame.fps = true, /must be a number/],
  ['unsafe integer', s => s.frame.fps = 9007199254740992, /safe integer/],
  ['unsafe frame count', s => { delete s.take; s.duration = 9007199254740991; }, /frame count is outside safe integers/],
  ['zero duration', s => { delete s.take; s.duration = 0; }, /duration must be positive/],
  ['negative duration', s => { delete s.take; s.duration = -1; }, /duration must be positive/],
  ['string duration', s => { delete s.take; s.duration = '5'; }, /duration must be a number/],
  ['negative lead', s => s.lead = -1, /lead must be nonnegative/], ['negative tail', s => s.tail = -1, /tail must be nonnegative/],
  ['missing take path', s => s.take = {}, /missing field take.record/],
  ['captions not a list', s => s.captions = { lines: {} }, /captions.lines must be a list/],
  ['mark list type', s => s.marks = {}, /marks must be a list/],
  ['caption missing text', s => s.captions = { lines: [{ at: seconds(0) }] }, /missing field caption.text/],
  ['caption missing at', s => s.captions = { lines: [{ text: 'Line' }] }, /missing field caption.at/],
  ['caption empty text', s => s.captions = { lines: [{ text: '', at: seconds(0) }] }, /nonempty single-line/],
  ['caption multiline', s => s.captions = { lines: [{ text: 'One\nTwo', at: seconds(0) }] }, /nonempty single-line/],
  ['caption order', s => s.captions = { lines: [2, 1].map(n => ({ text: 'Line', at: seconds(n) })) }, /out of time order/],
  ['caption same frame', s => s.captions = { lines: [0.001, 0.002].map(n => ({ text: 'Line', at: seconds(n) })) }, /distinct increasing frames/],
  ['caption same time', s => s.captions = { lines: [0, 0].map(n => ({ text: 'Line', at: seconds(n) })) }, /distinct increasing frames/],
  ['caption at end', s => s.captions = { lines: [{ text: 'Line', at: seconds(5) }] }, /caption has no frames/],
  ['caption past end', s => s.captions = { lines: [{ text: 'Line', at: seconds(5.001) }] }, /past the scene end/],
  ['caption after last word hold', s => s.captions = { lines: [{ text: 'Line', at: seconds(4.95) }] }, /caption has no frames/],
  ['caption milliseconds collapse', s => { delete s.take; s.duration = 0.0002; s.frame.fps = 10000; s.captions = { lines: [{ text: 'Line', at: seconds(0) }] }; }, /empty after millisecond rounding/]
]) bad(name, change, pattern);
for (const key of ['frame', 'take', 'lead', 'tail', 'captions', 'marks']) bad(`null ${key}`, s => s[key] = null, /must be/);
for (const [label, mark, pattern] of [
  ['missing name', { at: seconds(0) }, /missing field mark.name/], ['missing at', { name: 'beat' }, /missing field mark.at/],
  ['empty name', { name: '', at: seconds(0) }, /nonempty single-line/], ['blank name', { name: '  ', at: seconds(0) }, /nonempty single-line/],
  ['multiline name', { name: 'one\ntwo', at: seconds(0) }, /nonempty single-line/], ['control name', { name: 'one\u007f', at: seconds(0) }, /without controls/],
  ['numeric name', { name: 1, at: seconds(0) }, /must be a nonempty/], ['past end', { name: 'late', at: seconds(5.001) }, /mark "late".*past the scene end/],
  ['last frame time', { name: 'last', at: seconds(4.966666666666667) }, /mark "last".*no frame past/],
  ['scene end', { name: 'end', at: seconds(5) }, /mark "end".*no frame past/],
  ['duplicate name', { name: 'same', at: seconds(0) }, /duplicate mark name "same"/]
]) bad(`mark ${label}`, s => s.marks = label === 'duplicate name' ? [mark, { name: 'same', at: seconds(1) }] : [mark], pattern);
for (const kind of ['mark', 'caption']) {
  for (const [label, at, pattern] of [
    ['absent word', word('save.'), /word "save\." occurrence 1 is absent/], ['absent occurrence', word('Save.', 3), /occurrence 3 is absent/],
    ['zero occurrence', word('Open', 0), /safe integer/], ['fractional occurrence', word('Open', 1.5), /safe integer/],
    ['missing occurrence', { word: 'Open' }, /needs seconds or word and occurrence/], ['missing word', { occurrence: 1 }, /needs seconds or word and occurrence/],
    ['mixed time', { ...word('Open'), seconds: 0 }, /needs seconds or word and occurrence/], ['empty time', {}, /needs seconds or word and occurrence/],
    ['negative seconds', seconds(-1), /must be nonnegative/], ['string seconds', seconds('1'), /must be a number/],
    ['null time', null, /must be an object/]
  ]) bad(`${kind} ${label}`, s => {
    if (kind === 'mark') s.marks = [{ name: 'beat', at }]; else s.captions = { lines: [{ text: 'Line', at }] };
  }, pattern);
  bad(`${kind} word without take`, s => {
    delete s.take; s.duration = 5;
    if (kind === 'mark') s.marks = [{ name: 'beat', at: word('Open') }]; else s.captions = { lines: [{ text: 'Line', at: word('Open') }] };
  }, /without take/);
}
for (const [name, change, pattern] of [
  ...['timings', 'aligned_file', 'delay'].map(key => [`missing ${key}`, r => delete r[key], /take record requires/]),
  ['missing sample count', r => delete r.aligned_file.sample_count, /must be a number/],
  ['missing sample rate', r => delete r.delay.sample_rate, /must be a number/],
  ['zero sample count', r => r.aligned_file.sample_count = 0, /safe integer/], ['zero sample rate', r => r.delay.sample_rate = 0, /safe integer/],
  ['fractional sample count', r => r.aligned_file.sample_count = 0.5, /safe integer/], ['unsafe sample rate', r => r.delay.sample_rate = 9007199254740992, /safe integer/],
  ['word token', r => r.timings[0].text = 'two words', /one exact word token/],
  ['empty word', r => r.timings[0].text = '', /nonempty single-line/], ['missing start', r => delete r.timings[0].start, /must be a number/],
  ['negative start', r => r.timings[0].start = -1, /nonnegative/], ['reversed interval', r => r.timings[0].end = 0, /reversed/],
  ['word beyond take', r => r.timings[0].end = 6, /outside the aligned take/], ['word order', r => r.timings.reverse(), /out of time order/]
]) bad(`take ${name}`, (s, f) => { change(f.record); f.save(f.record, 'take.json'); }, pattern);

for (const field of ['frame', 'fps', 'record', 'captions', 'lines', 'text', 'seconds', 'marks', 'name', 'at']) {
  test(`timing refuses duplicate JSON key ${field}`, t => {
    const f = setup(t); f.spec.captions = { lines: [{ text: 'Line', at: seconds(0) }] }; f.spec.marks = [{ name: 'beat', at: seconds(0) }];
    const raw = JSON.stringify(f.spec).replace(`"${field}":`, `"${field}":null,"${field}":`), input = f.save();
    fs.writeFileSync(input, raw); const before = tree(f.dir);
    refused(['timing', '--spec', input, '--output', f.output], new RegExp(`duplicate key ${field}`)); assert.deepEqual(tree(f.dir), before);
  });
}
test('timing refuses duplicate take keys, invalid JSON and non-UTF-8 before writing', t => {
  const f = setup(t), input = f.save();
  fs.writeFileSync(f.spec.take.record, JSON.stringify(f.record).replace('"start":', '"start":0,"start":'));
  refused(['timing', '--spec', input, '--output', f.output], /duplicate key start/);
  for (const raw of ['{', '{} true', '{"a":"\\q"}', Buffer.from([255])]) {
    fs.writeFileSync(input, raw); const before = tree(f.dir);
    refused(['timing', '--spec', input, '--output', f.output], /JSON|UTF-8/); assert.deepEqual(tree(f.dir), before);
  }
});
for (const which of ['--spec', '--output', 'take.record']) {
  for (const [label, value, pattern] of [
    ['relative', 'relative', /must be absolute/], ['memory', 'Memory/new', /protected/],
    ['env', '.env', /protected/], ['env suffix', 'settings.env', /protected/],
    ['env prefix', '.ENV.local', /protected/], ['credentials', 'Credentials.JSON', /protected/]
  ]) test(`timing screens ${which}: ${label}`, t => {
    const f = setup(t), target = label === 'relative' ? value : path.join(f.dir, value);
    if (which === 'take.record') f.spec.take.record = target;
    const command = args(f); if (which !== 'take.record') command[which === '--spec' ? 2 : 4] = target;
    const before = tree(f.dir); refused(command, pattern); assert.deepEqual(tree(f.dir), before);
  });
}
test('timing refuses existing destinations, absent parents, source directories and missing files', t => {
  const f = setup(t), command = args(f); fs.mkdirSync(f.output);
  refused(command, /already exists/);
  for (const dest of [path.join(f.dir, 'absent', 'out'), path.join(f.dir, 'take.json', 'out')]) {
    refused(['timing', '--spec', command[2], '--output', dest], /parent|canonicalized/);
  }
  for (const source of [f.dir, path.join(f.dir, 'missing')]) {
    refused(['timing', '--spec', source, '--output', path.join(f.dir, 'new')], /not a file|not a readable file/);
  }
  assert.deepEqual(fs.readdirSync(f.output), []);
});
test('timing screens source and output symlinks, loops and dangling ancestors', t => {
  const f = setup(t), input = f.save();
  fs.symlinkSync(TOOL, path.join(f.dir, 'tool-alias'));
  fs.symlinkSync(path.join(f.dir, 'loop'), path.join(f.dir, 'loop'));
  fs.symlinkSync(path.join(f.dir, 'missing'), path.join(f.dir, 'dangling'));
  fs.symlinkSync(input, path.join(f.dir, 'spec-link'));
  fs.symlinkSync(f.dir, path.join(f.dir, 'parent-link'));
  for (const destination of [path.join(TOOL, 'new'), path.join(f.dir, 'tool-alias', 'new'), path.join(f.dir, 'loop', 'new'), path.join(f.dir, 'dangling', 'new')]) {
    refused(['timing', '--spec', input, '--output', destination], /inside the tool|canonicalized|symbolic link/);
  }
  fs.symlinkSync(path.join(f.dir, 'Memory'), path.join(f.dir, 'protected'));
  refused(['timing', '--spec', path.join(f.dir, 'protected'), '--output', f.output], /symbolic link|protected/);
  ok(['timing', '--spec', path.join(f.dir, 'spec-link'), '--output', path.join(f.dir, 'parent-link', 'new')]);
  assert.equal(fs.existsSync(path.join(f.dir, 'new', 'timing.json')), true);
});
test('timing rolls back handled write failures and preserves a competing output', t => {
  const f = setup(t), input = f.save(), before = tree(f.dir);
  const { timing } = require('../scripts/compose.js'), write = fs.writeFileSync, mkdir = fs.mkdirSync;
  try {
    let n = 0;
    fs.writeFileSync = function(file, ...rest) {
      if (String(file).startsWith(f.output) && ++n === 2) { const error = new Error('planted'); error.code = 'EIO'; throw error; }
      return write.call(this, file, ...rest);
    };
    assert.throws(() => timing(input, f.output), /timing could not write new output \(EIO\)/);
  } finally { fs.writeFileSync = write; }
  assert.deepEqual(tree(f.dir), before);
  try {
    fs.mkdirSync = function(dir, ...rest) {
      if (dir === f.output) { mkdir.call(this, dir); write(path.join(dir, 'owner.txt'), 'other process'); }
      return mkdir.call(this, dir, ...rest);
    };
    assert.throws(() => timing(input, f.output), /EEXIST/);
  } finally { fs.mkdirSync = mkdir; }
  assert.equal(fs.readFileSync(path.join(f.output, 'owner.txt'), 'utf8'), 'other process');
});
