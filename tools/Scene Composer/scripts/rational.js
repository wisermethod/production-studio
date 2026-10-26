'use strict';
const fail = message => { throw new Error(`${message}. Correct the input using TOOL.md.`); };
class Q {
  constructor(n, d = 1n) {
    if (d === 0n) fail('zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    let a = n < 0n ? -n : n, b = d;
    while (b) [a, b] = [b, a % b];
    this.n = n / a; this.d = d / a;
  }
  add(b) { b = rational(b); return new Q(this.n * b.d + b.n * this.d, this.d * b.d); }
  sub(b) { b = rational(b); return new Q(this.n * b.d - b.n * this.d, this.d * b.d); }
  mul(b) { b = rational(b); return new Q(this.n * b.n, this.d * b.d); }
  cmp(b) { b = rational(b); const n = this.n * b.d - b.n * this.d; return n < 0n ? -1 : n > 0n ? 1 : 0; }
  ceil() { return this.n >= 0n ? (this.n + this.d - 1n) / this.d : this.n / this.d; }
  valueOf() { return Number(this.n) / Number(this.d); }
}
function rational(value) {
  if (value instanceof Q) return value;
  const text = String(value), m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m || !Number.isFinite(Number(text))) fail('number must be finite');
  const scale = (m[3] || '').length - Number(m[4] || 0);
  const n = BigInt((m[1] || '') + m[2] + (m[3] || ''));
  return scale >= 0 ? new Q(n, 10n ** BigInt(scale)) : new Q(n * 10n ** BigInt(-scale));
}
function frame(time, fps) {
  const n = rational(time).mul(fps).ceil();
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < 0n) fail('frame count is outside safe integers');
  return Number(n);
}
// Preserve JSON's decimal number lexemes, including scientific notation. No eval.
function parse(text, duplicates = true) {
  let i = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(text[i] || '\0')) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    fail('unclosed JSON string');
  }
  function value() {
    ws(); const ch = text[i];
    if (ch === '"') return string();
    if (ch === '{' || ch === '[') {
      i++; const array = ch === '[', result = array ? [] : Object.create(null), seen = new Set();
      ws(); const end = array ? ']' : '}';
      if (text[i] === end) { i++; return result; }
      for (;;) {
        ws(); let key;
        if (!array) {
          if (text[i] !== '"') fail('JSON object needs a quoted key');
          key = string(); ws();
          if (text[i++] !== ':') fail('JSON key needs a colon');
          if (duplicates && seen.has(key)) fail(`duplicate key ${key}`);
          seen.add(key);
        }
        const v = value(); if (array) result.push(v); else result[key] = v;
        ws(); const separator = text[i++];
        if (separator === end) return result;
        if (separator !== ',') fail('invalid JSON separator');
      }
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, i)) { i += token.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) fail('invalid JSON value');
    i += match[0].length; return rational(match[0]);
  }
  try {
    const result = value(); ws(); if (i !== text.length) fail('extra JSON content');
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) fail('invalid JSON string');
    throw error;
  }
}
function sorted(value) {
  if (value instanceof Q) return Number(value);
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])]));
  return value;
}
const json = value => JSON.stringify(sorted(value), null, 2) + '\n';
module.exports = { Q, rational, frame, parse, sorted, json, fail };
