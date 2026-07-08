/**
 * useStoryPreviewCss — persisted CSS is used as-is for clean saved stories (no network);
 * drafts (dirty, or missing persisted CSS) fetch the preview compile; legacy stories never
 * fetch and never style.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useStoryPreviewCss } from '@/lib/hooks/use-story-preview-css';

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
  it('returns persisted CSS without fetching for a clean saved story', () => {
    const fetchFn = mockFetchCss('.never{}');
    const { result } = renderHook(() =>
      useStoryPreviewCss({ story: TW('grid'), compiledCss: '.persisted{}' }, false),
    );
    expect(result.current).toBe('.persisted{}');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns null and never fetches for legacy stories', () => {
    const fetchFn = mockFetchCss('.never{}');
    const { result } = renderHook(() =>
      useStoryPreviewCss({ story: '<div class="story-sc">x</div>', compiledCss: null }, true),
    );
    expect(result.current).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches the preview compile for a marked draft with no persisted CSS', async () => {
    const fetchFn = mockFetchCss('.preview-a{}');
    const { result } = renderHook(() =>
      useStoryPreviewCss({ story: TW('bg-lime-50 unique-a'), compiledCss: null }, true),
    );
    await waitFor(() => expect(result.current).toBe('.preview-a{}'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('serves stale persisted CSS while a dirty-story refresh is in flight, then updates', async () => {
    mockFetchCss('.fresh-b{}');
    const { result } = renderHook(() =>
      useStoryPreviewCss({ story: TW('bg-teal-50 unique-b'), compiledCss: '.stale{}' }, true),
    );
    expect(result.current).toBe('.stale{}'); // no unstyled flash
    await waitFor(() => expect(result.current).toBe('.fresh-b{}'));
  });
});
