import { describe, it, expect } from 'vitest';
import { extractStoryStyles, getBlockContext, getBlockHtml, replaceBlockHtml } from '@/lib/canvas-story/edit-blocks';

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

  it('matches case-insensitively (rendered text-transform: uppercase vs lowercase source)', () => {
    const html = '<div class="story"><h3 class="fp-title">Jun-26 fs bu Performance</h3></div>';
    // the raster reports the RENDERED (uppercased) text
    expect(getBlockHtml(html, { tag: 'h3', text: 'JUN-26 FS BU PERFORMANCE', occurrence: 0 }))
      .toBe('<h3 class="fp-title">Jun-26 fs bu Performance</h3>');
  });

  it('returns the ancestor chain (outermost first) and the story styles', () => {
    const html = '<style>.hl li{color:red}</style><div class="story-mx"><div class="band" style="--navy:#123"><ul class="hl"><li>Point one</li></ul></div></div>';
    const ctx = getBlockContext(html, { tag: 'li', text: 'Point one', occurrence: 0 });
    expect(ctx!.html).toBe('<li>Point one</li>');
    expect(ctx!.ancestors.map(a => a.tag)).toEqual(['div', 'div', 'ul']);
    expect(ctx!.ancestors[0].className).toBe('story-mx');
    expect(ctx!.ancestors[1].style).toBe('--navy:#123');
    expect(extractStoryStyles(html)).toBe('.hl li{color:red}');
  });

  it('replaces exactly the referenced block, preserving the rest', () => {
    const out = replaceBlockHtml(HTML, { tag: 'p', text: 'Same text', occurrence: 1 }, '<p>Edited!</p>');
    expect(out).toBe('<div class="story"><h1>Title</h1><p>Same <b>text</b></p><p>Edited!</p><p>Other</p></div>');
    expect(replaceBlockHtml(HTML, { tag: 'p', text: 'Nope', occurrence: 0 }, '<p>x</p>')).toBeNull();
  });
});
