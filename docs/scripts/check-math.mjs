import assert from 'node:assert/strict';
import katex from 'katex';
const output = katex.renderToString(String.raw`\frac{x^2}{y}`, { displayMode: true });
assert.match(output, /katex-display/);
assert.match(output, /annotation/);
assert.match(output, /mfrac/);
console.log('Display math rendering passed');
