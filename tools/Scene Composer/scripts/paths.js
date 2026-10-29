'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fail } = require('./rational.js');
const TOOL = fs.realpathSync(path.join(__dirname, '..'));
function canonical(value) {
  let head = value; const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(head), ...tail); }
    catch (error) {
      if (error.code !== 'ENOENT') fail('path cannot be canonicalized; repair its ancestors or symbolic links');
      // A dangling symlink is not a missing path component.
      try { if (fs.lstatSync(head).isSymbolicLink()) fail('path has a dangling symbolic link'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      const parent = path.dirname(head);
      if (parent === head) fail('path cannot be canonicalized');
      tail.unshift(path.basename(head)); head = parent;
    }
  }
}
function inside(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function screen(value, name, output = false) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) fail(`${name} must be a nonempty path without controls`);
  if (!path.isAbsolute(value)) fail(`${name} must be absolute`);
  const resolved = canonical(value), parts = resolved.split(path.sep);
  if (parts.some(p => p.toLowerCase() === 'memory' || /^\.env(?:\..*)?$|\.env$|^credentials\.json$/i.test(p))) {
    fail(`${name} is a protected memory, .env or credential path`);
  }
  if (output && inside(resolved, TOOL)) fail(`${name} resolves inside the tool`);
  if (output) {
    try { fs.lstatSync(resolved); fail(`${name} already exists`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    let parent; try { parent = fs.statSync(path.dirname(resolved)); } catch { fail(`${name} parent is absent or unreadable`); }
    if (!parent.isDirectory()) fail(`${name} parent is not a directory`);
  } else {
    let stat; try { stat = fs.statSync(resolved); } catch { fail(`${name} is not a readable file`); }
    if (!stat.isFile()) fail(`${name} is not a file`);
    // No --env is bound, so the contract's credential identity set is empty.
    // Resolve the identity nevertheless; a source symlink is opened at resolved.
    if (!Number.isFinite(stat.dev) || !Number.isFinite(stat.ino)) fail(`${name} cannot screen file identity`);
  }
  return resolved;
}
function bytes(file) { try { return fs.readFileSync(file); } catch { fail('input cannot be read; check file permissions'); } }
function utf8(buffer) { try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { fail('input must be UTF-8'); } }
const sha = value => createHash('sha256').update(value).digest('hex');
module.exports = { screen, bytes, utf8, sha, TOOL };
