'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const TOOL = fs.realpathSync(path.join(__dirname, '..'));
function fail(message) { throw new Error(message); }
function inside(file, dir) {
  const rel = path.relative(dir, file);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
function protectedPath(file) {
  if (file.split(path.sep).some(p => /^memory$|^\.env(?:\..*)?$|^auth-provider\.env$|^credentials\.json$/i.test(p)))
    fail('protected memory or credential path; choose an ordinary work path');
}
function canonical(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value))
    fail('path must be absolute and contain no controls');
  if (value.split(path.sep).includes('..')) fail('path must have no .. component');
  protectedPath(value);
  let head = value; const tail = [];
  for (;;) {
    try {
      const result = path.join(fs.realpathSync(head), ...tail);
      protectedPath(result); return result;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      try { if (fs.lstatSync(head).isSymbolicLink()) fail('dangling path link; repair it first'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const parent = path.dirname(head);
      if (parent === head) fail('path cannot be canonicalized; repair its ancestors');
      tail.unshift(path.basename(head)); head = parent;
    }
  }
}
function stat(file) { try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function regular(value) {
  const file = canonical(value), s = stat(file);
  if (!s || !s.isFile() || s.nlink !== 1) fail('input must be an existing regular file with one link');
  return file;
}
function destination(value, fresh = true) {
  const file = canonical(value);
  if (stat(value)?.isSymbolicLink()) fail('destination must not be a symbolic link');
  if (inside(file, TOOL)) fail('destination resolves inside this tool; choose a work path');
  const s = stat(file);
  if (fresh && s) fail('destination already exists; retain it and choose a new destination');
  if (s && (!s.isFile() || s.nlink !== 1)) fail('destination must be a regular file with one link');
  return file;
}
function read(file) { return fs.readFileSync(regular(file)); }
function utf8(buffer) { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function identity(file) { const b = read(file); return { bytes: b.length, sha256: hash(b) }; }
function equal(a, b) { return stable(a) === stable(b); }
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
// A recursive parser detects duplicate *decoded* keys, including escaped aliases.
// JSON.parse alone silently accepts them. It also accepts 1e999 as Infinity.
function parse(text) {
  let at = 0;
  function space() { while (/[\x20\t\r\n]/.test(text[at] || '\0')) at++; }
  function string() {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '\\') at++;
      else if (c === '"') return JSON.parse(text.slice(start, at));
    }
    fail('unterminated JSON string; supply strict JSON');
  }
  function value(depth = 0) {
    if (depth > 100) fail('JSON nesting exceeds 100');
    space(); const c = text[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; const out = Object.create(null), seen = new Set(); space();
      if (text[at] === '}') { at++; return out; }
      for (;;) {
        space(); if (text[at] !== '"') fail('JSON object needs a quoted key');
        const k = string(); if (seen.has(k)) fail('duplicate JSON key; remove the duplicate'); seen.add(k);
        space(); if (text[at++] !== ':') fail('invalid JSON colon');
        out[k] = value(depth + 1); space(); const end = text[at++];
        if (end === '}') return out;
        if (end !== ',') fail('invalid JSON object');
      }
    }
    if (c === '[') {
      at++; const out = []; space(); if (text[at] === ']') { at++; return out; }
      for (;;) {
        out.push(value(depth + 1)); space(); const end = text[at++];
        if (end === ']') return out;
        if (end !== ',') fail('invalid JSON array');
      }
    }
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at));
    if (!m) fail('invalid JSON value; supply strict JSON');
    at += m[0].length; const v = JSON.parse(m[0]);
    if (typeof v === 'number' && !Number.isFinite(v)) fail('non-finite JSON number');
    return v;
  }
  const out = value(); space(); if (at !== text.length) fail('trailing JSON data'); return out;
}
function json(file) { return parse(utf8(read(file))); }
function encode(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function writeNew(file, bytes) {
  file = destination(file); const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
module.exports = { fs, path, crypto, TOOL, fail, inside, canonical, stat, regular, destination, read,
  utf8, hash, identity, equal, parse, json, encode, writeNew };
