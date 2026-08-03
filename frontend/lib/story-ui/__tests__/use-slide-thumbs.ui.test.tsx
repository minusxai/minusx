/**
 * useSlideThumbnails — debounced one-capture-per-rebuild thumbnails for the rail.
 * The capture pipeline is mocked; what these tests pin is the orchestration:
 * capture only when enabled, debounced, re-armed per renderKey, cancelled on unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  capture: vi.fn(),
}));
vi.mock('../slide-thumbs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../slide-thumbs')>();
  return { ...mod, captureSlideThumbnails: h.capture };
});

import { useSlideThumbnails } from '../use-slide-thumbs';
import type { SlideNav } from '../use-slide-nav';

function stubNav(count: number): SlideNav {
  // A real attached iframe: the hook watches [data-mx-story-root] inside it for edit mutations.
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const root = frame.contentDocument!.createElement('div');
  root.setAttribute('data-mx-story-root', '');
  frame.contentDocument!.body.appendChild(root);
  return {
    slides: Array.from({ length: count }, (_, i) => ({ el: document.createElement('section'), title: `S${i}` })),
    frame,
    activeIndex: 0,
    goTo: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
  };
}

describe('useSlideThumbnails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.capture.mockReset();
    h.capture.mockResolvedValue(['data:image/jpeg;a', 'data:image/jpeg;b']);
  });
  afterEach(() => vi.useRealTimers());

  it('captures after the debounce and exposes the data URLs', async () => {
    const nav = stubNav(2);
    const { result } = renderHook(() => useSlideThumbnails(nav, 'k1', true));
    expect(result.current).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(h.capture).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual(['data:image/jpeg;a', 'data:image/jpeg;b']);
  });

  it('does nothing while disabled or with no slides', async () => {
    renderHook(() => useSlideThumbnails(stubNav(2), 'k1', false));
    renderHook(() => useSlideThumbnails(stubNav(0), 'k1', true));
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('re-captures when renderKey changes', async () => {
    const nav = stubNav(2);
    const { rerender } = renderHook(({ k }) => useSlideThumbnails(nav, k, true), { initialProps: { k: 'k1' } });
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    rerender({ k: 'k2' });
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(h.capture).toHaveBeenCalledTimes(2);
  });

  it('re-captures after an edit mutation inside the story root', async () => {
    const nav = stubNav(2);
    renderHook(() => useSlideThumbnails(nav, 'k1', true));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(h.capture).toHaveBeenCalledTimes(1);
    const root = nav.frame!.contentDocument!.querySelector('[data-mx-story-root]')!;
    root.appendChild(nav.frame!.contentDocument!.createElement('p'));
    await act(async () => {
      await Promise.resolve(); // MutationObserver microtask delivery
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });
    expect(h.capture).toHaveBeenCalledTimes(2);
  });

  it('ignores data-mx-* marker churn (hover/selection render artifacts)', async () => {
    const nav = stubNav(2);
    renderHook(() => useSlideThumbnails(nav, 'k1', true));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    const root = nav.frame!.contentDocument!.querySelector('[data-mx-story-root]')!;
    root.setAttribute('data-mx-hover', '');
    root.setAttribute('data-mx-selected', '');
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(h.capture).toHaveBeenCalledTimes(1);
  });

  it('drops a stale result after unmount', async () => {
    const nav = stubNav(2);
    let resolve!: (v: string[]) => void;
    h.capture.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = renderHook(() => useSlideThumbnails(nav, 'k1', true));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    unmount();
    resolve(['late']);
    await act(async () => { await Promise.resolve(); });
    // No assertion target after unmount — this is a no-crash / no-setState-warning test.
    expect(h.capture).toHaveBeenCalledTimes(1);
  });
});
