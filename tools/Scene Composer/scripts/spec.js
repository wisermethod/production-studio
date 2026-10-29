'use strict';
const { Q, rational: q, frame, fail } = require('./rational.js');
const { screen, bytes, utf8, sha } = require('./paths.js');
const { parse } = require('./rational.js');
const fallback = (value, other) => value === undefined ? other : value;
const COLORS = {
  background: '#0b1220', highlight: '#ffd23f', label_background: '#111827', label_text: '#ffffff',
  chip_background: '#080c14ee', chip_text: '#ffffff', cursor_fill: '#111111', cursor_stroke: '#ffffff', click_ripple: '#ffd23f'
};
function object(v, name, keys, required = keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v instanceof Q) fail(`${name} must be an object`);
  for (const key of Object.keys(v)) if (!keys.includes(key)) fail(`unknown key ${name}.${key}`);
  for (const key of required) if (!Object.hasOwn(v, key)) fail(`missing field ${name}.${key}`);
  return v;
}
function list(v, name) { if (!Array.isArray(v)) fail(`${name} must be a list`); return v; }
function number(v, name, positive = false) {
  if (!(v instanceof Q) && typeof v !== 'number') fail(`${name} must be a number`);
  const value = q(v);
  if (!Number.isFinite(Number(value)) || value.cmp(0) < 0 || (positive && value.cmp(0) === 0)) fail(`${name} must be ${positive ? 'positive' : 'nonnegative'} and finite`);
  return value;
}
function integer(v, name, min = 0) {
  const value = number(v, name);
  if (value.d !== 1n || value.n > BigInt(Number.MAX_SAFE_INTEGER) || Number(value) < min) fail(`${name} must be a safe integer >= ${min}`);
  return Number(value);
}
function text(v, name) {
  if (typeof v !== 'string' || !v.trim() || /[\x00-\x1f\x7f]/.test(v)) fail(`${name} must be a nonempty single-line string without controls`);
  return v;
}
function normalizeLines(spec) {
  object(spec, 'spec', ['narration']);
  if (typeof spec.narration !== 'string' || !spec.narration.length) fail('narration must be a nonempty string');
  // The controls a narration take's script refuses anywhere, tags included; tab, line feed and carriage return
  // remain word separators. A take's script cannot hold U+000B, U+000C or U+0085, so none of them separates words here.
  const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0085]/u;
  if (control.test(spec.narration)) {
    const word = spec.narration.split(/[\t\n\r\p{Zs}\u2028\u2029\uFEFF]+/u).find(w => control.test(w));
    fail(`narration word ${JSON.stringify(word)} holds an unsupported control character`);
  }
  const words = spec.narration.replace(/\[[^\]]*\]|<[^>]*>/gu, '').split(/[\s\p{White_Space}]+/u).filter(Boolean);
  if (!words.length) fail('narration has no words after removing tags');
  const occurrences = new Map();
  const tokens = words.map(word => {
    const occurrence = (occurrences.get(word) || 0) + 1;
    occurrences.set(word, occurrence);
    return { word, occurrence };
  });
  const lines = [];
  let sentence = [];
  function splitSentence() {
    let part = [], length = 0;
    const emit = () => lines.push({ text: part.map(t => t.word).join(' '), at: part[0] });
    for (const token of sentence) {
      const size = Array.from(token.word).length;
      if (size > 84) fail(`narration word ${JSON.stringify(token.word)} is longer than 84 code points and cannot split`);
      // Packing whole words chooses the last space at or before index 84.
      if (part.length && length + 1 + size > 84) { emit(); part = []; length = 0; }
      length += (part.length ? 1 : 0) + size; part.push(token);
    }
    if (part.length) emit();
    sentence = [];
  }
  for (const token of tokens) {
    sentence.push(token);
    if (/[.?!]$/u.test(token.word.replace(/["'\p{Pe}\p{Pf}]+$/u, ''))) splitSentence();
  }
  splitSentence();
  return lines;
}
function color(v, name) {
  if (typeof v !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(v)) fail(`${name} must be a hex color`);
  return v;
}
function image(buffer) {
  let width, height, extension;
  if (buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.readUInt32BE(8) === 13) {
    width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20); extension = 'png';
  } else if (buffer.length > 4 && buffer[0] === 255 && buffer[1] === 216) {
    let i = 2;
    while (i < buffer.length) {
      if (buffer[i++] !== 255) break;
      while (buffer[i] === 255) i++;
      const marker = buffer[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (i + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(i);
      if (length < 2 || i + length > buffer.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 8) break;
        height = buffer.readUInt16BE(i + 3); width = buffer.readUInt16BE(i + 5); extension = 'jpg'; break;
      }
      i += length;
    }
  }
  if (!width || !height) fail('still needs a readable PNG or JPEG pixel-size header');
  return { width, height, extension };
}
function fontFile(buffer) {
  const sig = buffer.subarray(0, 4).toString('hex');
  const ext = { '774f4632': 'woff2', '774f4646': 'woff', '00010000': 'ttf', '4f54544f': 'otf' }[sig];
  if (!ext || buffer.length < 12) fail('font must be a WOFF2, WOFF, TrueType or OpenType file');
  return ext;
}
function sceneFonts(value) {
  const assets = [], fonts = [];
  for (const [i, f] of list(fallback(value, []), 'fonts').entries()) {
    object(f, 'font', ['family','path','weight','style'], ['family','path']);
    const family = text(f.family, 'font.family'), weight = integer(fallback(f.weight, q(400)), 'font.weight', 1), style = fallback(f.style, 'normal');
    if (weight > 1000 || !['normal','italic','oblique'].includes(style)) fail('font weight must be 1 to 1000 and style normal, italic or oblique');
    if (fonts.some(x => x.family === family && x.weight === weight && x.style === style)) fail('duplicate font family, weight and style');
    const content = bytes(screen(f.path, 'font.path')), extension = fontFile(content), file = `font-${String(i + 1).padStart(3, '0')}.${extension}`;
    assets.push({ path: `project/${file}`, bytes: content }); fonts.push({ family, weight, style, file });
  }
  return { assets, fonts };
}
function captionStyle(value, fonts, fw, fh, name = 'captions.style') {
  const s = object(value, name, ['font','size','weight','color','background','padding','radius','position','margin','max_width']);
  if (!fonts.some(f => f.family === s.font)) fail(`${name}.font must name a family in fonts`);
  const style = { font: s.font, color: color(s.color, `${name}.color`), background: s.background === 'none' ? 'none' : color(s.background, `${name}.background`), position: s.position };
  if (!['top','bottom'].includes(s.position)) fail(`${name}.position must be top or bottom`);
  for (const k of ['size','padding','radius','margin','max_width']) style[k] = Number(number(s[k], `${name}.${k}`, ['size','max_width'].includes(k)));
  style.weight = integer(s.weight, `${name}.weight`, 1);
  if (style.weight > 1000 || style.max_width > fw || style.margin * 2 >= fh) fail(`${name === 'captions.style' ? 'captions style' : name} exceeds frame or weight bounds`);
  return style;
}
function sceneFrame(value) {
  object(value, 'frame', ['width','height','fps']);
  const fw = integer(value.width, 'frame.width', 2), fh = integer(value.height, 'frame.height', 2), fps = integer(value.fps, 'frame.fps', 1);
  if (fw % 2 || fh % 2) fail('frame width and height must be even');
  return { fw, fh, fps };
}
function sceneTiming(spec, fps) {
  const lead = number(fallback(spec.lead, q('0.25')), 'lead'), tail = number(fallback(spec.tail, q('0.5')), 'tail');
  let timings = [], length;
  if (spec.take !== undefined) {
    if (spec.duration !== undefined) fail('take and duration are mutually exclusive');
    object(spec.take, 'take', ['record']);
    const record = parse(utf8(bytes(screen(spec.take.record, 'take.record'))));
    if (!record || !Array.isArray(record.timings) || !record.aligned_file || !record.delay) fail('take record requires timings, aligned_file.sample_count and delay.sample_rate');
    const count = integer(record.aligned_file.sample_count, 'aligned_file.sample_count', 1);
    const rate = integer(record.delay.sample_rate, 'delay.sample_rate', 1);
    length = new Q(BigInt(count), BigInt(rate));
    timings = record.timings.map((word, i) => {
      if (!word || typeof word !== 'object') fail('timings entry must hold text, start and end');
      const token = text(word.text, 'timings.text');
      if (/\s/.test(token)) fail('timings.text must be one exact word token');
      const start = number(word.start, 'timings.start'), end = number(word.end, 'timings.end');
      if (end.cmp(start) < 0 || end.cmp(length) > 0) fail('timings interval is reversed or outside the aligned take');
      return { text: token, start, end, index: i };
    });
    for (let i = 1; i < timings.length; i++) if (timings[i].start.cmp(timings[i-1].start) < 0) fail('timings are out of time order');
  } else {
    if (spec.duration === undefined) fail('duration is required without take');
    length = number(spec.duration, 'duration', true);
  }
  const frames = frame(lead.add(length).add(tail), fps), end = new Q(BigInt(frames), BigInt(fps));
  function at(v, name) {
    object(v, name, ['word','occurrence','seconds'], []);
    let time, index = null;
    if (Object.hasOwn(v, 'seconds') && Object.keys(v).length === 1) time = number(v.seconds, `${name}.seconds`);
    else if (Object.hasOwn(v, 'word') && Object.hasOwn(v, 'occurrence') && Object.keys(v).length === 2) {
      const word = text(v.word, `${name}.word`), occurrence = integer(v.occurrence, `${name}.occurrence`, 1);
      if (spec.take === undefined) fail(`${name} cannot name a word without take`);
      const match = timings.filter(w => w.text === word)[occurrence - 1];
      if (!match) fail(`${name} word ${JSON.stringify(word)} occurrence ${occurrence} is absent from take`);
      time = lead.add(match.start); index = match.index;
    } else fail(`${name} needs seconds or word and occurrence`);
    if (time.cmp(end) > 0) fail(`${name} is past the scene end`);
    return { time, frame: frame(time, fps), index };
  }
  function ordered(items, name, strictFrames = false) {
    for (let i = 1; i < items.length; i++) {
      if (items[i].time.cmp(items[i-1].time) < 0) fail(`${name} events are out of time order`);
      if (strictFrames && items[i].frame <= items[i-1].frame) fail(`${name} arrivals need distinct increasing frames`);
    }
  }
  return { lead, tail, timings, fps, frames, end, at, ordered };
}
function captionCues(captions, clock, resolve = clock.at) {
  const { lead, timings, fps, frames, end, ordered } = clock;
  const lines = list(fallback(captions.lines, []), 'captions.lines').map(v => {
    object(v, 'caption', ['text','at']);
    const t = text(v.text, 'caption.text'), a = resolve(v.at, 'caption.at');
    return { ...a, text: t };
  }); ordered(lines, 'captions', true);
  // Caption text is not matched to the take: a line may show a written form, such as an address, that the narration
  // says aloud differently. The last line holds until the take's last word ends, plus 0.6 seconds.
  let lastEnd = null;
  for (const w of timings) { const e = lead.add(w.end).add(q('0.6')); if (lastEnd === null || e.cmp(lastEnd) > 0) lastEnd = e; }
  if (lastEnd === null) lastEnd = end;
  const cues = lines.map((line, i) => {
    const endFrame = i + 1 < lines.length ? lines[i+1].frame : Math.min(frames, frame(lastEnd, fps));
    if (endFrame <= line.frame) fail('caption has no frames before its end');
    return { text: line.text, start_frame: line.frame, end_frame: endFrame, start: line.frame / fps, end: endFrame / fps };
  });
  return cues;
}
function normalizeTiming(spec) {
  object(spec, 'spec', ['frame','take','duration','lead','tail','captions','marks'], ['frame']);
  const { fps } = sceneFrame(spec.frame), clock = sceneTiming(spec, fps);
  const captions = fallback(spec.captions, {});
  object(captions, 'captions', ['lines'], []);
  const cues = captionCues(captions, clock), names = new Set();
  const marks = list(fallback(spec.marks, []), 'marks').map(v => {
    object(v, 'mark', ['name','at']);
    const name = text(v.name, 'mark.name');
    if (names.has(name)) fail(`duplicate mark name ${JSON.stringify(name)}`);
    names.add(name);
    const label = `mark ${JSON.stringify(name)}`, resolved = clock.at(v.at, `${label}.at`);
    const product = resolved.time.mul(fps), after = product.n / product.d + 1n;
    if (after >= BigInt(clock.frames)) fail(`${label} has no frame past its time inside the scene`);
    return { name, seconds: Number(resolved.time), frame: resolved.frame, frame_after: Number(after) };
  });
  return { fps, frames: clock.frames, duration: clock.frames / fps, lead: Number(clock.lead), tail: Number(clock.tail), marks, cues };
}
function normalizeLayer(spec) {
  object(spec, 'spec', ['frame','timing','fonts','style']);
  const { fw, fh, fps } = sceneFrame(spec.frame);
  object(spec.timing, 'timing', ['path','sha256']);
  if (typeof spec.timing.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(spec.timing.sha256)) fail('timing.sha256 must be a lowercase SHA-256');
  const raw = bytes(screen(spec.timing.path, 'timing.path')), timing_sha256 = sha(raw);
  if (timing_sha256 !== spec.timing.sha256) fail('timing file sha256 must match timing.sha256');
  const timing = object(parse(utf8(raw)), 'timing', ['spec_sha256','fps','frames','duration','lead','tail','marks','cues','files']);
  if (integer(timing.fps, 'timing.fps', 1) !== fps) fail('timing.fps must equal frame.fps');
  const frames = integer(timing.frames, 'timing.frames', 1);
  const cues = list(timing.cues, 'timing.cues').map((cue, i) => {
    const name = `timing.cues[${i}]`;
    object(cue, name, ['text','start_frame','end_frame','start','end']);
    const content = text(cue.text, `${name}.text`), start = integer(cue.start_frame, `${name}.start_frame`), end = integer(cue.end_frame, `${name}.end_frame`);
    if (end <= start || end > frames) fail(`${name}.end_frame must be after start_frame and at most timing.frames`);
    // Seconds are retained as recorded. Only the integer frames determine visibility.
    return { text: content, start_frame: start, end_frame: end, start: cue.start, end: cue.end };
  });
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start_frame <= cues[i-1].start_frame) fail(`timing.cues[${i}].start_frame must be strictly increasing`);
    if (cues[i].start_frame < cues[i-1].end_frame) fail(`timing.cues[${i}].start_frame must not overlap the preceding end_frame`);
  }
  const { fonts, assets } = sceneFonts(spec.fonts), style = captionStyle(spec.style, fonts, fw, fh, 'style');
  // Supply stateAt's full data contract without mounting any of its scene elements.
  const data = { width: fw, height: fh, fps, frames, duration: frames / fps, fonts,
    still: { width: fw, height: fh }, camera: [], cursor: null, chip: null, callouts: [], clicks: [],
    fades: { caption: frame('0.12', fps) }, captions: { mode: 'drawn', style, cues } };
  return { data, assets, timing_sha256 };
}
function normalize(spec) {
  object(spec, 'spec', ['frame','still','take','duration','lead','tail','fonts','colors','chip','cursor','clicks','camera','callouts','captions'], ['frame','still']);
  const { fw, fh, fps } = sceneFrame(spec.frame);
  object(spec.still, 'still', ['path']);
  const still = bytes(screen(spec.still.path, 'still.path')), size = image(still);
  const clock = sceneTiming(spec, fps), { frames, at, ordered } = clock;
  const events = [];
  function event(v, name, kind) {
    const e = at(v, name); events.push({ kind, seconds: Number(e.time), frame: e.frame }); return e;
  }
  function point(v, name, keys = ['x','y']) {
    object(v, name, keys);
    const x = number(v.x, `${name}.x`), y = number(v.y, `${name}.y`);
    if (x.cmp(size.width) > 0 || y.cmp(size.height) > 0) fail(`${name} point is outside the still`);
    return { x: Number(x), y: Number(y) };
  }
  function rect(v, name) {
    object(v, name, ['x','y','w','h']);
    const p = point({ x: v.x, y: v.y }, name), w = number(v.w, `${name}.w`, true), h = number(v.h, `${name}.h`, true);
    if (number(v.x, name).add(w).cmp(size.width) > 0 || number(v.y, name).add(h).cmp(size.height) > 0) fail(`${name} rect is outside the still`);
    return { ...p, w: Number(w), h: Number(h) };
  }
  function interval(v, name, kind) {
    const a = event(v.at, `${name}.at`, kind), b = event(v.until, `${name}.until`, `${kind}_until`);
    if (b.time.cmp(a.time) <= 0) fail(`${name}.until must be after at`);
    return { ...a, until: b.frame };
  }
  const colors = { ...COLORS };
  if (spec.colors !== undefined) {
    object(spec.colors, 'colors', Object.keys(COLORS), []);
    for (const k of Object.keys(spec.colors)) colors[k] = color(spec.colors[k], `colors.${k}`);
  }
  const assets = [{ path: `project/still.${size.extension}`, bytes: still }], fonts = [];
  const declared = sceneFonts(spec.fonts); assets.push(...declared.assets); fonts.push(...declared.fonts);
  let cursor = null;
  if (spec.cursor !== undefined) {
    object(spec.cursor, 'cursor', ['start','moves']);
    cursor = { start: point(spec.cursor.start, 'cursor.start'), moves: list(spec.cursor.moves, 'cursor.moves').map((v, i) => {
      const p = point(v, `cursor.moves[${i}]`, ['x','y','at']); return { ...event(v.at, 'cursor.move.at', 'cursor'), ...p };
    }) };
    ordered(cursor.moves, 'cursor', true);
  }
  const clicks = list(fallback(spec.clicks, []), 'clicks').map(v => { object(v, 'click', ['at']); return event(v.at, 'click.at', 'click'); });
  ordered(clicks, 'click'); if (clicks.length && !cursor) fail('clicks require cursor');
  const camera = list(fallback(spec.camera, []), 'camera').map(v => {
    object(v, 'camera', ['rect','at']);
    return { ...event(v.at, 'camera.at', 'camera'), rect: v.rect === 'full' ? 'full' : rect(v.rect, 'camera.rect') };
  }); ordered(camera, 'camera', true);
  function starts(moves, travel) {
    let previous = 0;
    for (const m of moves) {
      m.start_frame = Math.max(previous, m.frame - frame(travel, fps), 0);
      events.find(e => e.kind === (moves === camera ? 'camera' : 'cursor') && e.frame === m.frame).start_frame = m.start_frame;
      previous = m.frame;
    }
  }
  if (cursor) starts(cursor.moves, '0.9'); starts(camera, '1');
  let chip = null;
  if (spec.chip !== undefined) {
    object(spec.chip, 'chip', ['text','at','until']);
    chip = { ...interval(spec.chip, 'chip', 'chip'), text: text(spec.chip.text, 'chip.text') };
  }
  const callouts = list(fallback(spec.callouts, []), 'callouts').map(v => {
    object(v, 'callout', ['rect','label','at','until']);
    return { ...interval(v, 'callout', 'callout'), rect: rect(v.rect, 'callout.rect'), label: text(v.label, 'callout.label') };
  }); ordered(callouts, 'callouts');
  const captions = fallback(spec.captions, {});
  object(captions, 'captions', ['mode','lines','style'], []);
  const mode = fallback(captions.mode, 'none');
  if (!['none','drawn'].includes(mode)) fail('captions.mode must be none or drawn');
  if (mode === 'none' && captions.style !== undefined) fail('captions.style is refused for none');
  let style = null;
  if (mode === 'drawn') {
    style = captionStyle(captions.style, fonts, fw, fh);
  }
  const cues = captionCues(captions, clock, (v, name) => event(v, name, 'caption'));
  if ((chip || callouts.length || (mode === 'drawn' && cues.length)) && !fonts.length) fail('drawn text requires at least one font');
  // The browser receives only normalized scene data, never input paths or take metadata.
  function cleanMove(m) { const { time, index, lastEnd, ...rest } = m; return rest; }
  const data = {
    width: fw, height: fh, fps, frames, duration: frames / fps,
    fades: Object.fromEntries(Object.entries({ chip: '0.4', callout: '0.35', caption: '0.12', ripple: '0.08', out: '0.3' }).map(([k, v]) => [k, frame(v, fps)])), still: { ...size, file: `still.${size.extension}` }, colors, fonts,
    cursor: cursor && { start: cursor.start, moves: cursor.moves.map(cleanMove) }, clicks: clicks.map(cleanMove),
    camera: camera.map(cleanMove), chip: chip && cleanMove(chip), callouts: callouts.map(cleanMove), captions: { mode, style, cues }
  };
  return { data, assets, events, cues };
}
module.exports = { normalize, normalizeTiming, normalizeLines, normalizeLayer, object, list, number, image, COLORS };
