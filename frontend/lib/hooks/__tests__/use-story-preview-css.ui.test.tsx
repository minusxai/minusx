/**
 * useStoryPreviewCss — persisted CSS is used as-is for clean saved stories (no network);
 * drafts (dirty, or missing persisted CSS) fetch the preview compile; legacy stories never
 * fetch and never style.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useStoryPreviewCss, useHeldStoryRender } from '@/lib/hooks/use-story-preview-css';

const TW = (cls: string) => `<div data-design="tw" class="${cls}">x</div>`;

function mockFetchCss(css: string) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { css } }),
  } as unknown as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useStoryPreviewCss', () => {
  it('returns persisted CSS (ready) without fetching for a clean saved story', () => {
    const fetchFn = mockFetchCss('.never{}');
    const { result } = renderHook(() =>
      useStoryPreviewCss({ story: TW('grid'), compiledCss: '.persisted{}' }, false),
    );
    expect(result.current).toEqual({ css: '.persisted{}', ready: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns null (ready) and never fetches for legacy stories', () => {
    const fetchFn = mockFetchCss('.never{}');
    const { result } = renderHook(() =>
      useStoryPreviewCss({ story: '<div class="story-sc">x</div>', compiledCss: null }, true),
    );
    expect(result.current).toEqual({ css: null, ready: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches the preview compile for a marked draft with no persisted CSS', async () => {
    const fetchFn = mockFetchCss('.preview-a{}');
    const { result } = renderHook(() =>
      useStoryPreviewCss({ story: TW('bg-lime-50 unique-a'), compiledCss: null }, true),
    );
    await waitFor(() => expect(result.current).toEqual({ css: '.preview-a{}', ready: true }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('serves stale persisted CSS as NOT ready while a dirty-story refresh is in flight, then becomes ready', async () => {
    mockFetchCss('.fresh-b{}');
    const { result } = renderHook(() =>
      useStoryPreviewCss({ story: TW('bg-teal-50 unique-b'), compiledCss: '.stale{}' }, true),
    );
    // Serving stale so there's no unstyled flash, but flagged not-ready so the caller can hold the frame.
    expect(result.current).toEqual({ css: '.stale{}', ready: false });
    await waitFor(() => expect(result.current).toEqual({ css: '.fresh-b{}', ready: true }));
  });
});

describe('useHeldStoryRender', () => {
  it('view mode: advances immediately for a clean saved story (css ready)', () => {
    mockFetchCss('.never{}');
    const { result } = renderHook(() =>
      useHeldStoryRender({ story: TW('grid'), compiledCss: '.persisted{}' }, false, false),
    );
    expect(result.current).toEqual({ story: TW('grid'), css: '.persisted{}' });
  });

  it('view mode: HOLDS the previous frame until the new story\'s CSS is ready (no unstyled flash)', async () => {
    mockFetchCss('.fresh{}');
    const first = { story: TW('hold-1'), compiledCss: '.css1{}' };
    const { result, rerender } = renderHook(
      ({ content, dirty }: { content: typeof first; dirty: boolean }) => useHeldStoryRender(content, dirty, false),
      { initialProps: { content: first, dirty: false } },
    );
    expect(result.current).toEqual({ story: first.story, css: '.css1{}' });

    // Agent edit: new story, now dirty → its recompiled CSS is in flight (not ready).
    const edited = { story: TW('hold-2 bg-lime-50'), compiledCss: '.css1{}' };
    rerender({ content: edited, dirty: true });
    // Held: still the PREVIOUS pair — the new story does not render unstyled.
    expect(result.current).toEqual({ story: first.story, css: '.css1{}' });
    // Once the preview compile resolves, both swap together.
    await waitFor(() => expect(result.current).toEqual({ story: edited.story, css: '.fresh{}' }));
  });

  it('edit mode: story flows live even before CSS is ready (no data-loss on inline edits)', () => {
    mockFetchCss('.fresh{}');
    const { result, rerender } = renderHook(
      ({ content }: { content: { story: string; compiledCss: string } }) => useHeldStoryRender(content, true, true),
      { initialProps: { content: { story: TW('e1'), compiledCss: '.c{}' } } },
    );
    rerender({ content: { story: TW('e2 bg-teal-50'), compiledCss: '.c{}' } });
    expect(result.current.story).toBe(TW('e2 bg-teal-50'));
  });
});
