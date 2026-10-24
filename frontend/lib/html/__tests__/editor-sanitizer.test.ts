import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const createDOMPurify = require(require.resolve('dompurify', {
  paths: [require.resolve('monaco-editor/package.json')],
}));

describe('editor markdown sanitization', () => {
  it('keeps formatted text and removes executable markup and URL handlers', () => {
    const window = new JSDOM('').window;
    try {
      const clean = createDOMPurify(window).sanitize('<strong>safe</strong><img src=x onerror="alert(1)"><a href="javascript:alert(1)">link</a><script>alert(1)</script>');
      expect(clean).toContain('<strong>safe</strong>');
      expect(clean).not.toContain('onerror');
      expect(clean).not.toContain('javascript:');
      expect(clean).not.toContain('<script');
    } finally {
      window.close();
    }
  });
});
