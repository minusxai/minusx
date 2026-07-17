import { describe, it, expect } from 'vitest';
import { getBlockHtml, replaceBlockHtml } from '@/lib/canvas-story/edit-blocks';

const HTML = '<div class="story"><h1>Title</h1><p>Same <b>text</b></p><p>Same text</p><p>Other</p></div>';

describe('canvas edit-blocks source mapping', () => {
  it('finds a block by tag + normalized text + occurrence', () => {
    expect(getBlockHtml(HTML, { tag: 'h1', text: 'Title', occurrence: 0 })).toBe('<h1>Title</h1>');
    // both <p>s normalize to "Same text" — occurrence disambiguates
    expect(getBlockHtml(HTML, { tag: 'p', text: 'Same text', occurrence: 0 })).toBe('<p>Same <b>text</b></p>');
    expect(getBlockHtml(HTML, { tag: 'p', text: 'Same text', occurrence: 1 })).toBe('<p>Same text</p>');
    expect(getBlockHtml(HTML, { tag: 'p', text: 'Missing', occurrence: 0 })).toBeNull();
  });

  it('preserves leading <style> blocks (DOMParser hoists them into <head>)', () => {
    const html = '<style>.story{color:red}</style><div class="story"><p>Body text</p></div>';
    const out = replaceBlockHtml(html, { tag: 'p', text: 'Body text', occurrence: 0 }, '<p>New</p>');
    expect(out).toBe('<style>.story{color:red}</style><div class="story"><p>New</p></div>');
  });

  it('replaces exactly the referenced block, preserving the rest', () => {
    const out = replaceBlockHtml(HTML, { tag: 'p', text: 'Same text', occurrence: 1 }, '<p>Edited!</p>');
    expect(out).toBe('<div class="story"><h1>Title</h1><p>Same <b>text</b></p><p>Edited!</p><p>Other</p></div>');
    expect(replaceBlockHtml(HTML, { tag: 'p', text: 'Nope', occurrence: 0 }, '<p>x</p>')).toBeNull();
  });
});
