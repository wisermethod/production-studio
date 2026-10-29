'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { fixture, call, ok, refused, tree, TOOL, ENTRY } = require('./support.js');
const { run } = require('../scripts/scene-composer.js');
const line = (text, word = text.split(' ')[0], occurrence = 1) => ({ text, at: { word, occurrence } });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function setup(t, narration = 'Open the board.') {
  const f = fixture(t); f.spec = { narration }; return f;
}
function args(f) { return ['lines', '--spec', f.save(f.spec), '--output', f.output]; }
function expectLines(t, narration, expected) {
  const f = setup(t, narration), result = ok(args(f));
  assert.deepEqual(result.lines, expected);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.output, 'utf8')).lines, expected);
  return { f, result };
}
function bad(name, value, pattern) {
  test(`lines refuses ${name} without writing`, t => {
    const f = setup(t); f.spec = value;
    const command = args(f), before = tree(f.dir);
    refused(command, pattern); assert.deepEqual(tree(f.dir), before);
  });
}

test('lines help precedes runtime checks and declares only its two flags', t => {
  for (const alias of ['help', '--help']) {
    assert.match(run([alias], '0.1.0'), /Scene Composer 0\.4\.0/);
    const r = call([alias]); assert.equal(r.status, 0); assert.equal(r.stderr, '');
    assert.match(r.stdout, /lines --spec <file.json> --output <new file.json>/);
    refused([alias, 'lines'], /unknown argument lines/);
  }
  const f = setup(t), command = args(f), before = tree(f.dir);
  const r = spawnSync(process.execPath, ['-e',
    'try { require(process.argv[1]).run(process.argv.slice(2), "21.9.0"); } catch (e) { process.stderr.write(e.message); process.exitCode = 1; }',
    ENTRY, ...command], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.equal(r.stdout, '');
  assert.match(r.stderr, /lines refuses Node 21.*requires Node >=22/);
  assert.deepEqual(tree(f.dir), before);
  for (const c of ['compose', 'timing']) refused([c, '--list', '/unused'], /unknown argument --list/);
  refused(['captions', '--spec', '/unused'], /unknown argument --spec/);
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
  [['--unknown'], /unknown argument --unknown/], [['--spec=/unused'], /unknown argument --spec=/],
  [['--output=/unused'], /unknown argument --output=/]
]) test(`lines CLI refuses ${flags.join(' ') || 'missing flags'} without writing`, t => {
  const f = setup(t), before = tree(f.dir);
  refused(['lines', ...flags], pattern); assert.deepEqual(tree(f.dir), before);
});

test('lines removes complete tags, including tags within words, before tokenizing', t => {
  expectLines(t, '[pause] New<emphasis>board</emphasis> [anything\nelse] is <tag>ready</tag>.<>[]', [line('Newboard is ready.')]);
});
test('lines takes tag matches left to right without overlap or a second removal pass', t => {
  expectLines(t, '<outer[inside>tail] [outer<inside]tail> A<one>[two]B.', [line('tail] tail> AB.')]);
});
test('lines keeps incomplete square and angle brackets as text', t => {
  expectLines(t, '[unfinished and <unfinished tail', [line('[unfinished and <unfinished tail')]);
});
test('lines separates on the full narration timing whitespace set, keeping no empty words', t => {
  const separators = [9, 10, 13, 32, 160, 5760, ...Array.from({ length: 11 }, (_, i) => 8192 + i), 8232, 8233, 8239, 8287, 12288, 65279];
  const narration = '\t\r\n' + separators.map(c => `W${String.fromCodePoint(c).repeat(2)}`).join('') + 'W\u00a0\u2003';
  expectLines(t, narration, [line(Array(separators.length + 1).fill('W').join(' '))]);
});
test('lines ends sentences only at terminal stops and retains an unstopped final sentence', t => {
  expectLines(t, 'One. Two? Three! Really?! Wait... v1.2 stays put; no final stop',
    ['One.', 'Two?', 'Three!', 'Really?!', 'Wait...', 'v1.2 stays put; no final stop'].map(s => line(s)));
});
test('lines recognizes every closing quotation mark and Unicode Pe or Pf after each stop', t => {
  const closers = ['"', "'"];
  for (let c = 0; c <= 0x10ffff; c++) if (/[\p{Pe}\p{Pf}]/u.test(String.fromCodePoint(c))) closers.push(String.fromCodePoint(c));
  const sentences = closers.flatMap(c => ['.', '?', '!'].map(stop => `End${stop}${c}`));
  sentences.push('Last');
  expectLines(t, sentences.join(' '), sentences.map(s => line(s)));
});
test('lines removes a run of mixed closing marks only for detecting a stop', t => {
  expectLines(t, 'End.\"\')]}\u00bb Next?\u3011\u2019 Tail', ['End.\"\')]}\u00bb', 'Next?\u3011\u2019', 'Tail'].map(s => line(s)));
});
test('lines does not treat opening marks or other trailing punctuation as closing marks', t => {
  expectLines(t, 'One.( Two.\u201c Three., tail!', [line('One.( Two.\u201c Three., tail!')]);
});
test('lines keeps a sentence of exactly 84 code points intact', t => {
  const text = 'A'.repeat(41) + ' ' + 'B'.repeat(41) + '.';
  assert.equal(Array.from(text).length, 84); expectLines(t, text, [line(text)]);
});
test('lines splits at its last space at index 84, retaining all 84 preceding code points', t => {
  const first = 'a'.repeat(40) + ' ' + 'b'.repeat(43);
  expectLines(t, first + ' next end.', [line(first), line('next end.')]);
});
test('lines chooses the last eligible space, not an earlier one or the next space', t => {
  const first = 'a'.repeat(30) + ' ' + 'b'.repeat(40), next = 'c'.repeat(20) + ' end.';
  expectLines(t, first + ' ' + next, [line(first), line(next)]);
});
test('lines repeats splitting three times and counts tokens inside earlier lines', t => {
  const first = 'a'.repeat(40), chunk = first + ' ' + 'b'.repeat(43);
  expectLines(t, Array(4).fill(chunk).join(' '), [1, 2, 3, 4].map(n => line(chunk, first, n)));
});
test('lines counts 84 non-BMP code points as one fitting token', t => {
  const text = '\u{10400}'.repeat(84); expectLines(t, text, [line(text)]);
});
test('lines splits an 85-code-point non-BMP sentence at a word boundary', t => {
  const first = '\u{10400}'.repeat(83);
  expectLines(t, first + ' X', [line(first), line('X')]);
});
test('lines counts exact case and punctuation occurrences across the whole narration', t => {
  expectLines(t, 'Go Go stop. go Go stop. Go end! Go. Go.', [line('Go Go stop.'), line('go Go stop.'), line('Go end!', 'Go', 4), line('Go.'), line('Go.', 'Go.', 2)]);
});
test('lines preserves words as said, case, numbers, spelling and Unicode normalization', t => {
  expectLines(t, 'Visit example dot com for twenty two. Caf\u00e9 cafe\u0301 22 Ctrl+S.', [line('Visit example dot com for twenty two.'), line('Caf\u00e9 cafe\u0301 22 Ctrl+S.')]);
});
test('lines refuses a refused control even inside a tag, as a take script does', t => {
  const f = setup(t);
  f.spec.narration = '[\u0000]<\u007f>Clean.';
  const command = args(f), before = tree(f.dir);
  refused(command, /narration word .*unsupported control character/);
  assert.deepEqual(tree(f.dir), before);
});

for (const [name, value, pattern] of [
  ['non-object null', null, /spec must be an object/], ['array', [], /spec must be an object/],
  ['string spec', 'text', /spec must be an object/], ['number spec', 1, /spec must be an object/],
  ['missing narration', {}, /missing field spec.narration/],
  ['unknown key', { narration: 'Open.', extra: true }, /unknown key spec.extra/],
  ...[null, 1, true, [], {}].map(v => [`narration type ${JSON.stringify(v)}`, { narration: v }, /narration must be a nonempty string/]),
  ['empty narration', { narration: '' }, /narration must be a nonempty string/],
  ['whitespace narration', { narration: ' \t\r\n\u00a0\u2003' }, /narration.*no words/],
  ['tag-only narration', { narration: '[pause]<emphasis></emphasis>[]<>' }, /narration.*no words/],
  ['85-code-point word', { narration: 'x'.repeat(85) }, /word "x{85}".*longer than 84 code points/],
  ['85 non-BMP code points', { narration: '\u{10400}'.repeat(85) }, /word.*longer than 84 code points/],
  ['long word after a fitting prefix', { narration: 'Short prefix ' + 'x'.repeat(85) }, /word "x{85}".*longer than 84 code points/],
  ['long word after a sentence', { narration: 'Fine. ' + 'x'.repeat(85) }, /word "x{85}".*longer than 84 code points/]
]) bad(name, value, pattern);
test('lines refuses exactly the controls a take script refuses, naming the word, without writing', t => {
  const f = setup(t);
  const refusedSet = [...Array.from({ length: 9 }, (_, i) => i), 11, 12, ...Array.from({ length: 18 }, (_, i) => 14 + i), 127, 133];
  for (const c of refusedSet) {
    f.spec.narration = `Say bad${String.fromCodePoint(c)}word now.`;
    const command = args(f), before = tree(f.dir);
    const r = refused(command, /narration word .*unsupported control character/);
    assert.ok(r.stderr.includes(JSON.stringify(`bad${String.fromCodePoint(c)}word`)), `U+${c.toString(16)}`);
    assert.deepEqual(tree(f.dir), before);
  }
});
test('lines keeps the other C1 controls inside their word, as a take script does', t => {
  for (let c = 128; c <= 159; c++) {
    if (c === 133) continue;
    const word = `beep${String.fromCodePoint(c)}`;
    expectLines(t, `Say ${word} now.`, [line(`Say ${word} now.`)]);
  }
});
for (const [name, raw, pattern] of [
  ['duplicate narration', '{"narration":"One.","narration":"Two."}', /duplicate key narration/],
  ['escaped duplicate key', '{"narration":"One.","narrat\\u0069on":"Two."}', /duplicate key narration/],
  ['nested duplicate', '{"narration":{"key":1,"key":2}}', /duplicate key key/],
  ['malformed JSON', '{', /JSON/], ['extra JSON', '{"narration":"One."} true', /JSON/],
  ['invalid escape', '{"narration":"\\q"}', /JSON/], ['invalid UTF-8', Buffer.from([255]), /UTF-8/]
]) test(`lines refuses ${name} without writing`, t => {
  const f = setup(t), command = args(f); fs.writeFileSync(command[2], raw);
  const before = tree(f.dir); refused(command, pattern); assert.deepEqual(tree(f.dir), before);
});
for (const flag of ['--spec', '--output']) {
  for (const [name, value, pattern] of [
    ['relative', 'relative', /must be absolute/], ['controls', 'bad\u001fpath', /path without controls/],
    ['memory', 'Memory/new', /protected/], ['env', '.env', /protected/],
    ['env prefix', '.ENV.local', /protected/], ['env suffix', 'settings.env', /protected/],
    ['credentials', 'Credentials.JSON', /protected/]
  ]) test(`lines screens ${flag} ${name} without writing`, t => {
    const f = setup(t), command = args(f);
    command[flag === '--spec' ? 2 : 4] = name === 'relative' ? value : path.join(f.dir, value);
    const before = tree(f.dir); refused(command, pattern); assert.deepEqual(tree(f.dir), before);
  });
}
test('lines refuses existing files or directories, absent parents and invalid sources without writing', t => {
  const f = setup(t), command = args(f); fs.writeFileSync(f.output, 'existing');
  const before = tree(f.dir); refused(command, /already exists/); assert.deepEqual(tree(f.dir), before);
  for (const dest of [f.dir, path.join(f.dir, 'absent', 'out'), path.join(f.output, 'out')]) {
    refused(['lines', '--spec', command[2], '--output', dest], /already exists|parent|canonicalized/);
    assert.deepEqual(tree(f.dir), before);
  }
  for (const source of [f.dir, path.join(f.dir, 'missing')]) {
    refused(['lines', '--spec', source, '--output', path.join(f.dir, 'new')], /not a file|not a readable file/);
    assert.deepEqual(tree(f.dir), before);
  }
});
test('lines screens symlinks and opens canonical sources and output parents', t => {
  const f = setup(t), command = args(f);
  fs.symlinkSync(TOOL, path.join(f.dir, 'tool-alias'));
  fs.symlinkSync(path.join(f.dir, 'loop'), path.join(f.dir, 'loop'));
  fs.symlinkSync(path.join(f.dir, 'missing'), path.join(f.dir, 'dangling'));
  fs.symlinkSync(path.join(f.dir, 'Memory'), path.join(f.dir, 'protected'));
  const before = fs.readdirSync(f.dir).sort();
  for (const dest of [path.join(TOOL, 'new'), path.join(f.dir, 'tool-alias', 'new'), path.join(f.dir, 'loop', 'new'), path.join(f.dir, 'dangling', 'new'), path.join(f.dir, 'protected', 'new')]) {
    refused(['lines', '--spec', command[2], '--output', dest], /inside the tool|canonicalized|symbolic link|protected/);
    assert.deepEqual(fs.readdirSync(f.dir).sort(), before);
  }
  for (const source of ['loop', 'dangling', 'protected']) {
    refused(['lines', '--spec', path.join(f.dir, source), '--output', f.output], /canonicalized|symbolic link|protected/);
    assert.deepEqual(fs.readdirSync(f.dir).sort(), before);
  }
  fs.symlinkSync(command[2], path.join(f.dir, 'spec-link'));
  fs.symlinkSync(f.dir, path.join(f.dir, 'parent-link'));
  ok(['lines', '--spec', path.join(f.dir, 'spec-link'), '--output', path.join(f.dir, 'parent-link', 'new.json')]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'new.json'), 'utf8')).lines, [line('Open the board.')]);
});
test('lines writes deterministic sorted UTF-8 JSON and exact specification and file hashes', t => {
  const f = setup(t, 'Caf\u00e9 \u{10400}. Again.'), command = args(f);
  fs.writeFileSync(command[2], '{\n  "narration": "Caf\u00e9 \u{10400}. Again."\n}\n');
  const result = ok(command), other = path.join(f.dir, 'other.json');
  const second = ok(['lines', '--spec', command[2], '--output', other]);
  const bytes = fs.readFileSync(f.output), raw = bytes.toString('utf8'), record = JSON.parse(raw);
  assert.deepEqual(bytes, fs.readFileSync(other)); assert.deepEqual(result, second);
  assert.deepEqual(record, { lines: [line('Caf\u00e9 \u{10400}.'), line('Again.')], spec_sha256: sha(fs.readFileSync(command[2])) });
  assert.deepEqual(result, { ...record, lines_sha256: sha(bytes) });
  assert.equal(raw, JSON.stringify(record, null, 2) + '\n');
  assert.match(raw, /Caf\u00e9 \u{10400}\./u); assert.equal(raw.includes('\\u'), false);
  assert.equal(raw.includes('\r'), false); assert.equal(raw.includes(f.dir), false);
  function sorted(value) {
    if (value && typeof value === 'object') {
      if (!Array.isArray(value)) assert.deepEqual(Object.keys(value), Object.keys(value).sort());
      Object.values(value).forEach(sorted);
    }
  }
  sorted(record);
});
test('lines output can pass directly to timing and compose with exact take tokens', t => {
  const f = setup(t, 'New<emphasis>board</emphasis> ready. [pause] Again Newboard ready.');
  const result = ok(args(f));
  const words = ['Newboard', 'ready.', 'Again', 'Newboard', 'ready.'];
  f.record.timings = words.map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));
  const record = f.save(f.record, 'take.json');
  const spec = { frame: { width: 320, height: 180, fps: 30 }, take: { record }, captions: { lines: result.lines } };
  const timed = ok(['timing', '--spec', f.save(spec, 'timing-spec.json'), '--output', path.join(f.dir, 'timing')]);
  spec.still = { path: path.join(f.dir, 'still.png') };
  const composed = ok(['compose', '--spec', f.save(spec, 'compose-spec.json'), '--output', path.join(f.dir, 'compose')]);
  assert.deepEqual(timed.cues, composed.captions); assert.deepEqual(timed.cues.map(c => c.text), result.lines.map(l => l.text));
});
test('lines removes only its new file after a handled write failure', t => {
  const f = setup(t), command = args(f), before = tree(f.dir), write = fs.writeFileSync;
  const { lines } = require('../scripts/compose.js');
  try {
    fs.writeFileSync = function(file, ...rest) {
      if (typeof file === 'number') { const error = new Error('planted'); error.code = 'EIO'; throw error; }
      return write.call(this, file, ...rest);
    };
    assert.throws(() => lines(command[2], f.output), /lines could not write new output \(EIO\)/);
  } finally { fs.writeFileSync = write; }
  assert.deepEqual(tree(f.dir), before);
});
test('lines preserves a competing output created after screening', t => {
  const f = setup(t), command = args(f), open = fs.openSync;
  const { lines } = require('../scripts/compose.js');
  try {
    fs.openSync = function(file, ...rest) {
      if (file === f.output) {
        const fd = open.call(this, file, 'wx');
        fs.writeFileSync(fd, 'other process'); fs.closeSync(fd);
      }
      return open.call(this, file, ...rest);
    };
    assert.throws(() => lines(command[2], f.output), /lines could not write new output \(EEXIST\)/);
  } finally { fs.openSync = open; }
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'other process');
});
