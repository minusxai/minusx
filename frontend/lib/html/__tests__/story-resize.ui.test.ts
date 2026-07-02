/**
 * Story embed resize — pure logic (size math + serialize round-trip).
 *
 * The interaction (pointer-drag on 8 handles) is browser-verified; the deterministic core is tested
 * here: (1) `resizeDelta` maps a handle direction + pointer delta to a new width/height with the box
 * top-left anchored (stories are a flow document, so the anchor is fixed); (2) `applyEmbedResize`
 * commits a size such that it survives `serializeEditedStory` — which restores the authored snapshot
 * from `data-mx-osz` and discards the live inline style, so the new size MUST be written into that
 * snapshot too or it silently reverts on Save.
 *
 * jsdom env (needs `document`) → `.ui.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { applyEmbedResize, previewEmbedSize, ensurePositioned, resizeDelta, MIN_EMBED_W, MIN_EMBED_H } from '../story-resize';
import { serializeEditedStory } from '../serialize-story';

/** A saved-chart placeholder as AgentHtml leaves it in edit mode: inline size + `data-mx-osz` snapshot + portaled chart DOM. */
function makeEmbedHost(style: string): HTMLElement {
  const host = document.createElement('div');
  const el = document.createElement('div');
  el.setAttribute('data-question-id', '1');
  el.setAttribute('style', style);
  el.setAttribute('data-mx-osz', style);
  el.innerHTML = '<div class="portal-chart">live chart card</div>';
  host.appendChild(el);
  return host;
}

describe('resizeDelta — top-left-anchored flow resize', () => {
  it('east/south grow with a positive drag', () => {
    expect(resizeDelta('se', 600, 400, 40, 30)).toEqual({ width: 640, height: 430 });
    expect(resizeDelta('e', 600, 400, 40, 999)).toEqual({ width: 640, height: 400 });
    expect(resizeDelta('s', 600, 400, 999, 30)).toEqual({ width: 600, height: 430 });
  });

  it('west/north grow when dragged outward (negative delta) — anchor stays top-left', () => {
    expect(resizeDelta('w', 600, 400, -40, 0)).toEqual({ width: 640, height: 400 });
    expect(resizeDelta('n', 600, 400, 0, -30)).toEqual({ width: 600, height: 430 });
    expect(resizeDelta('nw', 600, 400, -40, -30)).toEqual({ width: 640, height: 430 });
  });
});

describe('previewEmbedSize — live drag feedback (does NOT persist)', () => {
  it('updates the live inline size but leaves the data-mx-osz snapshot untouched', () => {
    const host = makeEmbedHost('width:600px;height:400px');
    const el = host.querySelector<HTMLElement>('[data-question-id]')!;
    previewEmbedSize(el, 820, 520);
    expect(el.style.width).toBe('820px');
    expect(el.style.height).toBe('520px');
    // Snapshot is unchanged → a preview that isn't committed reverts on serialize.
    expect(el.getAttribute('data-mx-osz')).toBe('width:600px;height:400px');
    expect(serializeEditedStory(host, [])).toMatch(/width:\s*600px/);
  });

  it('clamps to the render floor', () => {
    const host = makeEmbedHost('width:600px;height:400px');
    const el = host.querySelector<HTMLElement>('[data-question-id]')!;
    previewEmbedSize(el, 5, 5);
    expect(el.style.width).toBe(`${MIN_EMBED_W}px`);
    expect(el.style.height).toBe(`${MIN_EMBED_H}px`);
  });
});

describe('ensurePositioned — positioning context for absolute handles', () => {
  it('sets position:relative when unset and restores on cleanup', () => {
    const el = document.createElement('div');
    const restore = ensurePositioned(el);
    expect(el.style.position).toBe('relative');
    restore();
    expect(el.style.position).toBe('');
  });

  it('does not override an existing position and restores it', () => {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    const restore = ensurePositioned(el);
    expect(el.style.position).toBe('absolute');
    restore();
    expect(el.style.position).toBe('absolute');
  });
});

describe('applyEmbedResize + serialize round-trip', () => {
  it('persists the new size through serialize (writes data-mx-osz, not just live style)', () => {
    const host = makeEmbedHost('width:600px;height:400px');
    const el = host.querySelector<HTMLElement>('[data-question-id]')!;
    applyEmbedResize(el, 820, 520);
    const out = serializeEditedStory(host, []);
    expect(out).toMatch(/width:\s*820px/);
    expect(out).toMatch(/height:\s*520px/);
    expect(out).not.toMatch(/600px|400px/);
    expect(out).not.toContain('portal-chart'); // portal DOM dropped → empty placeholder
  });

  it('clamps below-minimum sizes to the render floor', () => {
    const host = makeEmbedHost('width:600px;height:400px');
    const el = host.querySelector<HTMLElement>('[data-question-id]')!;
    const applied = applyEmbedResize(el, 10, 10);
    expect(applied).toEqual({ width: MIN_EMBED_W, height: MIN_EMBED_H });
    const out = serializeEditedStory(host, []);
    expect(out).toMatch(new RegExp(`width:\\s*${MIN_EMBED_W}px`));
    expect(out).toMatch(new RegExp(`height:\\s*${MIN_EMBED_H}px`));
  });

  it('preserves other authored style props when resizing', () => {
    const host = makeEmbedHost('width:600px;height:400px;border-radius:12px;float:right');
    const el = host.querySelector<HTMLElement>('[data-question-id]')!;
    applyEmbedResize(el, 700, 500);
    const out = serializeEditedStory(host, []);
    expect(out).toMatch(/border-radius:\s*12px/);
    expect(out).toMatch(/float:\s*right/);
    expect(out).toMatch(/width:\s*700px/);
    expect(out).toMatch(/height:\s*500px/);
  });
});
