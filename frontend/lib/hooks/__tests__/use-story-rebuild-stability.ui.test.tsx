/**
 * useStoryRebuildStability — keeps the page steady across StoryView's INTENTIONAL iframe
 * remount (renderKey change on an agent edit): pins the story box's min-height until the
 * rebuilt content regrows to the pinned height (or a max-pin timeout expires), and restores
 * the scroll container's scrollTop once the rebuilt content is tall enough to hold it.
 *
 * The old inline hook released the pin on ANY ≥150ms gap in the resize stream (embeds
 * awaiting query results), letting the scroller collapse and clamp scroll to the top —
 * these tests lock the corrected contract.
 */
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import {
  shouldReleasePin,
  findScrollableAncestor,
  useStoryRebuildStability,
  REBUILD_SETTLE_MS,
  MAX_PIN_MS,
} from '@/lib/hooks/use-story-rebuild-stability';

// ---- fakes -------------------------------------------------------------------------------

type ROCallback = () => void;
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  cb: ROCallback;
  constructor(cb: ROCallback) {
    this.cb = cb;
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}
const fireResize = () => act(() => { FakeResizeObserver.instances.at(-1)?.cb(); });

function setupDom() {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 5000 });
  const box = document.createElement('div');
  const iframe = document.createElement('iframe');
  box.appendChild(iframe);
  scroller.appendChild(box);
  document.body.appendChild(scroller);
  const setHeight = (h: number) =>
    Object.defineProperty(iframe, 'offsetHeight', { configurable: true, value: h });
  return { scroller, box, iframe, setHeight, boxRef: { current: box } };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ---- pure decision -----------------------------------------------------------------------

describe('shouldReleasePin', () => {
  it('holds the pin while the rebuilt content is still shorter than the pinned height', () => {
    // The Bug A regression: a ≥150ms resize gap at 120px (embeds awaiting queries) must NOT release.
    expect(shouldReleasePin(120, 800, 1_000)).toBe(false);
  });

  it('releases once the content has regrown to at least the pinned height', () => {
    expect(shouldReleasePin(800, 800, 1_000)).toBe(true);
    expect(shouldReleasePin(900, 800, 1_000)).toBe(true);
  });

  it('releases after the max-pin timeout even if the content stayed short (legitimately shorter story)', () => {
    expect(shouldReleasePin(120, 800, MAX_PIN_MS)).toBe(true);
  });
});

// ---- scrollable-ancestor discovery -------------------------------------------------------

describe('findScrollableAncestor', () => {
  it('walks ancestors to the nearest overflow auto/scroll element', () => {
    const { scroller, box } = setupDom();
    expect(findScrollableAncestor(box)).toBe(scroller);
  });

  it('returns null when no ancestor scrolls', () => {
    const plain = document.createElement('div');
    const child = document.createElement('div');
    plain.appendChild(child);
    document.body.appendChild(plain);
    expect(findScrollableAncestor(child)).toBeNull();
  });
});

// ---- the hook ----------------------------------------------------------------------------

describe('useStoryRebuildStability', () => {
  function renderStability(boxRef: React.RefObject<HTMLDivElement | null>) {
    return renderHook(
      ({ renderKey }: { renderKey: string }) => useStoryRebuildStability(boxRef, renderKey),
      { initialProps: { renderKey: 'a' } },
    );
  }

  it('pins to the last stable height on a key change and holds through short intermediate settles', () => {
    const { boxRef, setHeight } = setupDom();
    setHeight(800);
    const { result, rerender } = renderStability(boxRef);
    // Settle at 800 → recorded as the stable height, no pin while stable.
    fireResize();
    act(() => { vi.advanceTimersByTime(REBUILD_SETTLE_MS); });
    expect(result.current).toBeNull();

    // Rebuild: pin the old height for the same commit as the remount.
    rerender({ renderKey: 'b' });
    expect(result.current).toBe(800);

    // Fresh iframe measures short, then a >settle gap while embeds await queries:
    // the pin must HOLD (the old implementation released here → scroll clamped to top).
    setHeight(120);
    fireResize();
    act(() => { vi.advanceTimersByTime(REBUILD_SETTLE_MS + 200); });
    expect(result.current).toBe(800);

    // Content regrows to the pinned height → release.
    setHeight(800);
    fireResize();
    act(() => { vi.advanceTimersByTime(REBUILD_SETTLE_MS); });
    expect(result.current).toBeNull();
  });

  it('releases the pin after the max-pin timeout when the story legitimately got shorter', () => {
    const { boxRef, setHeight } = setupDom();
    setHeight(800);
    const { result, rerender } = renderStability(boxRef);
    fireResize();
    act(() => { vi.advanceTimersByTime(REBUILD_SETTLE_MS); });

    rerender({ renderKey: 'b' });
    expect(result.current).toBe(800);
    setHeight(120);
    fireResize();
    act(() => { vi.advanceTimersByTime(MAX_PIN_MS + REBUILD_SETTLE_MS); });
    expect(result.current).toBeNull();
  });

  it('restores the scroll container position once the rebuilt content is tall enough to hold it', () => {
    const { boxRef, scroller, setHeight } = setupDom();
    setHeight(2000);
    const { rerender } = renderStability(boxRef);
    fireResize();
    act(() => { vi.advanceTimersByTime(REBUILD_SETTLE_MS); });

    scroller.scrollTop = 500;
    rerender({ renderKey: 'b' }); // insertion effect snapshots scrollTop before this commit's DOM mutations

    // Browser clamped scroll while the fresh iframe was short.
    scroller.scrollTop = 0;
    setHeight(120);
    fireResize();
    expect(scroller.scrollTop).toBe(0); // too short to hold 500 + viewport — not yet

    setHeight(2000);
    fireResize();
    expect(scroller.scrollTop).toBe(500); // tall enough → restored
  });

  it('does not touch scroll when the container was already at the top', () => {
    const { boxRef, scroller, setHeight } = setupDom();
    setHeight(2000);
    const { rerender } = renderStability(boxRef);
    fireResize();
    act(() => { vi.advanceTimersByTime(REBUILD_SETTLE_MS); });

    scroller.scrollTop = 0;
    rerender({ renderKey: 'b' });
    scroller.scrollTop = 10; // user scrolls a bit during rebuild — must not be overwritten to 0
    setHeight(2000);
    fireResize();
    expect(scroller.scrollTop).toBe(10);
  });
});
