/**
 * The story surface is the ONLY place the DOM-vs-SVG renderer difference lives, so its contract is
 * pinned here: both surfaces expose the same `root`/`measureHeight`/`applyHeight` interface, and the
 * SVG surface additionally sizes its <svg>+<foreignObject> explicitly.
 *
 * That explicit sizing is not incidental — an <svg> does NOT auto-size to its foreignObject content
 * (it sits at the 150px default), so without applyHeight a story would render clipped/padded. jsdom
 * doesn't lay out, so the sizing tests assert the ATTRIBUTES we set (the real-browser behaviour is
 * covered by the story-render parity check).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountStorySurface, STORY_ROOT_ATTR, STORY_SVG_ATTR } from '@/lib/story-surface';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';

let doc: Document;
beforeEach(() => {
  doc = document.implementation.createHTMLDocument('t');
});

describe('dom surface', () => {
  it('uses document.body as the story root and has no svg', () => {
    const s = mountStorySurface(doc, 'dom', 1280);
    expect(s.root).toBe(doc.body);
    expect(s.svg).toBeNull();
    expect(s.root.hasAttribute(STORY_ROOT_ATTR)).toBe(true);
  });

  it('applyHeight is a no-op (the iframe height is the only knob)', () => {
    const s = mountStorySurface(doc, 'dom', 1280);
    expect(() => s.applyHeight(500)).not.toThrow();
    expect(doc.body.getAttribute('height')).toBeNull();
  });
});

describe('svg surface', () => {
  it('mounts <svg><foreignObject><div> and roots the story in the div (not body)', () => {
    const s = mountStorySurface(doc, 'svg', 1280);
    expect(s.svg).not.toBeNull();
    expect(s.svg!.namespaceURI).toBe(SVG_NS);
    expect(s.svg!.hasAttribute(STORY_SVG_ATTR)).toBe(true);
    expect(s.root).not.toBe(doc.body);
    expect(s.root.hasAttribute(STORY_ROOT_ATTR)).toBe(true);
    // The root must be XHTML-namespaced or the browser treats it as an unknown SVG element and
    // renders nothing.
    expect(s.root.namespaceURI).toBe(XHTML_NS);
    expect(s.root.parentElement?.tagName.toLowerCase()).toBe('foreignobject');
    expect(doc.body.querySelector(`[${STORY_SVG_ATTR}]`)).toBe(s.svg);
  });

  it('starts at height 0 — never the 150px svg default that would pad the story', () => {
    const s = mountStorySurface(doc, 'svg', 1280);
    expect(s.svg!.getAttribute('height')).toBe('0');
    expect(s.svg!.getAttribute('width')).toBe('1280');
  });

  it('applyHeight sizes BOTH the svg and the foreignObject (each clips its content)', () => {
    const s = mountStorySurface(doc, 'svg', 1280);
    const fo = s.root.parentElement!;
    s.applyHeight(742);
    expect(s.svg!.getAttribute('height')).toBe('742');
    expect(fo.getAttribute('height')).toBe('742');
  });

  it('rounds fractional heights UP (a short svg clips the last text line)', () => {
    const s = mountStorySurface(doc, 'svg', 1280);
    s.applyHeight(300.2);
    expect(s.svg!.getAttribute('height')).toBe('301');
  });

  it('never applies a negative height', () => {
    const s = mountStorySurface(doc, 'svg', 1280);
    s.applyHeight(-5);
    expect(s.svg!.getAttribute('height')).toBe('0');
  });

  it('story HTML written into root lands inside the foreignObject', () => {
    const s = mountStorySurface(doc, 'svg', 1280);
    s.root.innerHTML = '<h1 id="t">Title</h1>';
    const h1 = doc.getElementById('t');
    expect(h1).not.toBeNull();
    expect(h1!.closest('foreignObject')).not.toBeNull();
  });
});
