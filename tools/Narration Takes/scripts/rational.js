'use strict';
const {fail} = require('./io.js');
// Exact decimal arithmetic for JSON timing lexemes and integer sample clocks.
function decimal(text) {
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$/i.exec(text);
  if (!m || !Number.isFinite(Number(text))) fail('timing must be a finite JSON number');
  const scale = (m[3] || '').length - Number(m[4] || 0);
  const n = BigInt(m[1] + m[2] + (m[3] || ''));
  return scale >= 0 ? [n, 10n ** BigInt(scale)] : [n * 10n ** BigInt(-scale), 1n];
}
function compare(a, b) {
  const difference = a[0] * b[1] - b[0] * a[1];
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
module.exports = {decimal, compare};
