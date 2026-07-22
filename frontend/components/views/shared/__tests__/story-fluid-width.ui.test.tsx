/**
 * FLUID story width plumbing (Story_Design_V2 §4).
 *
 * The svg surface pins its <svg>/<foreignObject> to an explicit width, and the story root lays out
 * at THAT width — not at the width of the iframe it sits in. A fluid caller renders a 100%-wide
 * iframe while passing the LOGICAL canvas width (StoryView: 1280), so on any container narrower
 * than the canvas the story lays out wider than the reader can see and the overflow is clipped
 * silently (the fluid shim pins `overflow-x:hidden`, so there isn't even a scrollbar). The same
 * split also forks capture fidelity: capture sites size their output from the live svg's ELEMENT
 * box (the visible width) while the serialized SVG's intrinsic size is its width ATTRIBUTE (the
 * logical width), so the agent's screenshot would show content the reader cannot.
 *
 * So: when (and only when) `fluid`, AgentHtml must push the MEASURED container width into the
 * surface — at mount AND on every later resize (side-chat toggle, window resize).
 *
 * jsdom has no layout engine, so these tests pin the PLUMBING contract (which width reaches the
 * surface, in which order), never "the story is not clipped" — that is a real-browser property and
 * is guarded there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Record surface calls IN ORDER while keeping the real surface behaviour (the attribute writes are
// the thing under test) — importActual, wrap, delegate.
const surfaceCalls: string[] = [];
vi.mock('@/lib/story-surface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/story-surface')>();
  return {
    ...actual,
    mountStorySurface: (doc: Document, kind: 'dom' | 'svg', width: number) => {
      const s = actual.mountStorySurface(doc, kind, width);
      return {
        get root() { return s.root; },
        get svg() { return s.svg; },
        measureHeight: () => { surfaceCalls.push('measureHeight'); return s.measureHeight(); },
        applyHeight: (h: number) => { surfaceCalls.push(`applyHeight:${h}`); s.applyHeight(h); },
        applyWidth: (w: number) => { surfaceCalls.push(`applyWidth:${w}`); s.applyWidth(w); },
      };
    },
  };
});

import AgentHtml from '../AgentHtml';
import { STORY_SVG_ATTR } from '@/lib/story-surface';

const STORY = '<h1>Headline</h1><p>Body copy that would reflow at a narrower width.</p>';

const iframeEl = () => screen.getByLabelText('Story document') as HTMLIFrameElement;
const storySvg = () => iframeEl().contentDocument!.querySelector(`svg[${STORY_SVG_ATTR}]`)!;
const foreignObject = () => storySvg().querySelector('foreignObject')!;

/**
 * Stub the MEASURED container width. jsdom reports 0 for every box, and the iframe's own
 * `body.clientWidth` (AgentHtml's primary source) lives in the iframe realm — unreachable before
 * mount — so this stubs the same-realm fallback the component reads when the inner document has
 * not laid out: the iframe element's clientWidth.
 */
let measured = 0;
beforeEach(() => {
  surfaceCalls.length = 0;
  measured = 0;
  Object.defineProperty(window.HTMLIFrameElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => measured,
  });
  (global.ResizeObserver as unknown as ReturnType<typeof vi.fn>).mockClear();
});
afterEach(() => {
  delete (window.HTMLIFrameElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

/** Fire every ResizeObserver AgentHtml installed (jsdom's observer never delivers on its own). */
const fireResize = () => {
  const calls = (global.ResizeObserver as unknown as ReturnType<typeof vi.fn>).mock.calls;
  calls.forEach(([cb]) => (cb as ResizeObserverCallback)([], {} as ResizeObserver));
};

describe('fluid: the surface tracks the MEASURED container width, not the logical canvas', () => {
  it('applies the measured width at mount (svg + foreignObject), overriding the width prop', async () => {
    measured = 1104;
    render(<AgentHtml html={STORY} fluid width={1280} colorMode="light" />);
    await waitFor(() => expect(storySvg()).toBeTruthy());
    expect(storySvg().getAttribute('width')).toBe('1104');
    expect(foreignObject().getAttribute('width')).toBe('1104');
  });

  it('re-applies on resize AFTER load (side-chat toggle / window resize)', async () => {
    measured = 1104;
    render(<AgentHtml html={STORY} fluid width={1280} colorMode="light" />);
    await waitFor(() => expect(storySvg().getAttribute('width')).toBe('1104'));
    // The build effect's width is a constant — only the ResizeObserver fires on a pane-width change.
    measured = 524;
    fireResize();
    expect(storySvg().getAttribute('width')).toBe('524');
    expect(foreignObject().getAttribute('width')).toBe('524');
  });

  // ORDER IS LOAD-BEARING: a narrower surface reflows text TALLER, so measuring height before the
  // width lands trades a horizontal clip for a vertical one.
  it('applies width BEFORE measuring height, and height after (width → reflow → measure → apply)', async () => {
    measured = 1104;
    render(<AgentHtml html={STORY} fluid width={1280} colorMode="light" />);
    await waitFor(() => expect(storySvg()).toBeTruthy());
    surfaceCalls.length = 0;
    measured = 524;
    fireResize();
    const kinds = surfaceCalls.map(c => c.split(':')[0]);
    expect(kinds).toEqual(['applyWidth', 'measureHeight', 'applyHeight']);
  });

  // A detached/hidden container measures 0; applying it would collapse the surface to min-content
  // (and blow up the height measure) instead of leaving it at the authored canvas.
  it('never applies a zero/unmeasurable width', async () => {
    measured = 0;
    render(<AgentHtml html={STORY} fluid width={1280} colorMode="light" />);
    await waitFor(() => expect(storySvg()).toBeTruthy());
    fireResize();
    expect(surfaceCalls.filter(c => c.startsWith('applyWidth'))).toEqual([]);
    expect(storySvg().getAttribute('width')).toBe('1280');
  });
});

describe('non-fluid: the surface stays pinned to the width prop (fixed logical canvas)', () => {
  it('ignores the measured container width at mount and on resize', async () => {
    measured = 1104;
    render(<AgentHtml html={STORY} width={800} colorMode="light" />);
    await waitFor(() => expect(storySvg()).toBeTruthy());
    expect(storySvg().getAttribute('width')).toBe('800');
    measured = 524;
    fireResize();
    expect(storySvg().getAttribute('width')).toBe('800');
    expect(foreignObject().getAttribute('width')).toBe('800');
    expect(surfaceCalls.filter(c => c.startsWith('applyWidth'))).toEqual([]);
  });
});

// ── Post-fix review findings (Story_Design_V2 §4 width contract) ────────────────────────────────
describe('width tracking is independent of the HEIGHT mode', () => {
  it('keeps re-applying width on resize for a FLUID + fixed-height caller', async () => {
    // The ResizeObserver used to be gated on `fixedHeight === undefined`, conflating "height is
    // fixed" with "nothing needs re-measuring". A fluid fixed-canvas caller then stayed pinned to
    // its mount width forever — the clipping bug, reintroduced in the one branch nobody exercises.
    measured = 1200;
    render(<AgentHtml html={STORY} width={1280} height={720} fluid colorMode="light" />);
    await waitFor(() => expect(surfaceCalls).toContain('applyWidth:1200'));
    measured = 760;
    fireResize();
    await waitFor(() => expect(surfaceCalls).toContain('applyWidth:760'));
    // A fixed height stays the caller's knob — never pushed from measured content.
    expect(surfaceCalls.some(c => c.startsWith('applyHeight:'))).toBe(false);
  });
});

describe('the measured width is the CONTENT box, not the padding box', () => {
  it('subtracts authored body padding (legacy stories may style body{padding})', async () => {
    // clientWidth includes padding. A legacy story whose own <style> sets body{padding:48px} gives
    // the surface a containing block 96px narrower; applying the padding box overhangs it and
    // body{overflow-x:hidden} eats the right edge with no scrollbar.
    measured = 1000;
    render(<AgentHtml html={STORY} width={1280} fluid colorMode="light" />);
    await waitFor(() => expect(surfaceCalls).toContain('applyWidth:1000'));
    const body = iframeEl().contentDocument!.body;
    body.style.paddingLeft = '48px';
    body.style.paddingRight = '48px';
    surfaceCalls.length = 0;
    fireResize();
    await waitFor(() => expect(surfaceCalls).toContain('applyWidth:904'));
    expect(surfaceCalls).not.toContain('applyWidth:1000');
  });
});
