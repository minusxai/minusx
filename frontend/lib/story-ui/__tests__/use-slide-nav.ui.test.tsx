/**
 * useSlideNav — the deep hook behind the story's slide chrome (birds-eye rail +
 * present controls). Discovery polls the story iframe (it builds asynchronously),
 * navigation scrolls the nearest parent-document scroll container.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useSlideNav } from '../use-slide-nav';

function buildHost() {
  // scroller > host > iframe(doc with two slides)
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  const host = document.createElement('div');
  scroller.appendChild(host);
  document.body.appendChild(scroller);
  const iframe = document.createElement('iframe');
  host.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  idoc.body.innerHTML = `
    <div data-mx-story-root>
      <section data-mx-slide data-mx-slide-title="One"></section>
      <section data-mx-slide data-mx-slide-title="Two"></section>
    </div>`;
  return { scroller, host, iframe, idoc };
}

function useTestNav(host: HTMLElement, renderKey: string) {
  const ref = useRef<HTMLElement | null>(host);
  return useSlideNav(ref, renderKey);
}

describe('useSlideNav', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('discovers slides in the iframe after a poll tick', () => {
    const { host } = buildHost();
    const { result } = renderHook(() => useTestNav(host, 'k1'));
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current.slides.map((s) => s.title)).toEqual(['One', 'Two']);
    expect(result.current.frame).not.toBeNull();
  });

  it('goTo scrolls the nearest scroll container to the slide top', () => {
    const { host, scroller, iframe, idoc } = buildHost();
    const { result } = renderHook(() => useTestNav(host, 'k1'));
    act(() => void vi.advanceTimersByTime(300));
    const slides = idoc.querySelectorAll<HTMLElement>('[data-mx-slide]');
    slides[1].getBoundingClientRect = () => ({ top: 900 }) as DOMRect;
    iframe.getBoundingClientRect = () => ({ top: 50 }) as DOMRect;
    scroller.getBoundingClientRect = () => ({ top: 10 }) as DOMRect;
    Object.defineProperty(scroller, 'scrollTop', { value: 100, configurable: true });
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as never;
    act(() => result.current.goTo(1));
    // Instant on purpose: Chromium cancels smooth programmatic scrolls under layout churn.
    expect(scrollTo).toHaveBeenCalledWith({ top: 100 + 900 + 50 - 10, behavior: 'auto' });
  });

  it('gives up polling after the timeout for a story with no slides', () => {
    const { host, idoc } = buildHost();
    idoc.body.innerHTML = '<div data-mx-story-root><p>prose</p></div>';
    const { result } = renderHook(() => useTestNav(host, 'k1'));
    act(() => void vi.advanceTimersByTime(20_000));
    expect(result.current.slides).toEqual([]);
  });

  it('next/prev clamp at the deck edges', () => {
    const { host, scroller } = buildHost();
    scroller.scrollTo = vi.fn() as never;
    const { result } = renderHook(() => useTestNav(host, 'k1'));
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.prev()); // already at 0 — no throw, stays clamped
    act(() => result.current.next());
    expect(scroller.scrollTo).toHaveBeenCalled();
  });
});
