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
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('applyWidth is a no-op (the root IS the body — it is already 100% of the iframe)', () => {
    const s = mountStorySurface(doc, 'dom', 1280);
    expect(() => s.applyWidth(1104)).not.toThrow();
    expect(doc.body.getAttribute('width')).toBeNull();
    expect(doc.body.style.width).toBe('');
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

  // WIDTH is the same kind of explicit-sizing problem as height, in the other axis: the svg and its
  // foreignObject are pinned to whatever width they were given, and the story root then lays out at
  // THAT width regardless of how wide the iframe actually is. A fluid caller (100%-wide iframe) must
  // therefore be able to push the MEASURED width in, or every container narrower than the logical
  // canvas clips the story (silently — the fluid shim hides the overflow).
  describe('applyWidth — the fluid caller pushes the measured width in', () => {
    it('sizes BOTH the svg and the foreignObject (each clips its content, like height)', () => {
      const s = mountStorySurface(doc, 'svg', 1280);
      const fo = s.root.parentElement!;
      s.applyWidth(1104);
      expect(s.svg!.getAttribute('width')).toBe('1104');
      expect(fo.getAttribute('width')).toBe('1104');
    });

    it('rounds fractional widths DOWN (a wider-than-container surface is what clips)', () => {
      const s = mountStorySurface(doc, 'svg', 1280);
      s.applyWidth(1103.6);
      expect(s.svg!.getAttribute('width')).toBe('1103');
    });

    it('never applies a negative width', () => {
      const s = mountStorySurface(doc, 'svg', 1280);
      s.applyWidth(-5);
      expect(s.svg!.getAttribute('width')).toBe('0');
    });

    // The caller drives this from a ResizeObserver: a redundant attribute write inside the callback
    // re-triggers the observer, so re-applying the SAME width must not touch the DOM (as applyHeight).
    it('is change-guarded: re-applying the same width writes nothing', () => {
      const s = mountStorySurface(doc, 'svg', 1280);
      const fo = s.root.parentElement!;
      s.applyWidth(1104);
      const svgSpy = vi.spyOn(s.svg!, 'setAttribute');
      const foSpy = vi.spyOn(fo, 'setAttribute');
      s.applyWidth(1104);
      expect(svgSpy).not.toHaveBeenCalled();
      expect(foSpy).not.toHaveBeenCalled();
    });

    it('leaves the mounted (pinned) width alone until a caller applies one', () => {
      // Non-fluid callers never call applyWidth — the surface stays pinned to the logical canvas.
      const s = mountStorySurface(doc, 'svg', 800);
      expect(s.svg!.getAttribute('width')).toBe('800');
      expect(s.root.parentElement!.getAttribute('width')).toBe('800');
    });
  });

  it('story HTML written into root lands inside the foreignObject', () => {
    const s = mountStorySurface(doc, 'svg', 1280);
    s.root.innerHTML = '<h1 id="t">Title</h1>';
    const h1 = doc.getElementById('t');
    expect(h1).not.toBeNull();
    expect(h1!.closest('foreignObject')).not.toBeNull();
  });
});
