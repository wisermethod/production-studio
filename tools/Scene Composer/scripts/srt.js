'use strict';
const { Q, rational: q, fail } = require('./rational.js');
function milliseconds(time) {
  const t = q(time).mul(1000);
  // Round halves upward using integers, never a binary floating-point product.
  return (2n * t.n + t.d) / (2n * t.d);
}
function stamp(ms) {
  ms = BigInt(ms);
  const pad = (n, len) => String(n).padStart(len, '0');
  return `${pad(ms / 3600000n, 2)}:${pad(ms / 60000n % 60n, 2)}:${pad(ms / 1000n % 60n, 2)},${pad(ms % 1000n, 3)}`;
}
function write(cues) {
  return cues.map((c, i) => {
    if (c.end <= c.start) fail('SRT cue is empty after millisecond rounding');
    return `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n\n`;
  }).join('');
}
function compose(cues, fps) {
  return write(cues.map(c => ({ text: c.text,
    start: milliseconds(new Q(BigInt(c.start_frame), BigInt(fps))),
    end: milliseconds(new Q(BigInt(c.end_frame), BigInt(fps))) })));
}
function read(text) {
  if (text === '') return [];
  const blocks = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n\n');
  let previous = 0n;
  return blocks.map((block, i) => {
    const lines = block.split('\n'), m = /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3}) --> (\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(lines[1] || '');
    if (lines[0] !== String(i+1) || !m || lines.length < 3 || lines.slice(2).some(l => !l.trim() || /[\x00-\x08\x0b-\x1f\x7f]/.test(l))) fail('invalid SRT; use numbered cues with HH:MM:SS,mmm and text');
    const time = k => BigInt(m[k]) * 3600000n + BigInt(m[k+1]) * 60000n + BigInt(m[k+2]) * 1000n + BigInt(m[k+3]);
    const start = time(1), end = time(5);
    if (end <= start || start < previous) fail('SRT cues overlap or run out of order');
    previous = end;
    return { start, end, text: lines.slice(2).join('\n') };
  });
}
module.exports = { milliseconds, stamp, write, compose, read };
