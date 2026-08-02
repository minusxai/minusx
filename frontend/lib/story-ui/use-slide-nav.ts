'use client';

/**
 * useSlideNav — everything the story's slide chrome needs, behind one hook: slide
 * discovery from the mounted surface, the active-slide index tracked from scroll, and
 * imperative navigation. Consumed by `components/views/story/` (the birds-eye rail and
 * the present-mode controls); the math lives in ./slide-nav.
 *
 * Discovery POLLS the host for the story iframe's slides: AgentHtml builds the iframe
 * document asynchronously and the interpreter commits after that, so there is no single
 * event to await. The poll is bounded (a story with no `<Slide>`s settles to empty) and
 * re-arms whenever `renderKey` changes — the same key that remounts AgentHtml, so every
 * content rebuild re-discovers.
 *
 * Navigation always scrolls a PARENT-document container (the iframe is content-sized and
 * never scrolls itself). The scroll container is re-resolved on every use rather than
 * cached: entering presentation mode turns the fullscreen wrapper into the scroller, and
 * leaving hands scrolling back to the page container.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';

import {
  activeSlideIndex,
  findScrollContainer,
  findSlides,
  slideTop,
  type SlideInfo,
} from './slide-nav';

const POLL_MS = 250;
const POLL_ATTEMPTS = 40; // 10s — covers slow iframe builds; embeds hydrate later but slides exist at interpreter commit

export interface SlideNav {
  slides: SlideInfo[];
  frame: HTMLIFrameElement | null;
  /** The slide the reader is on (scroll-tracked); -1 while there are no slides. */
  activeIndex: number;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
}

function resolveScroller(frame: HTMLIFrameElement): HTMLElement | null {
  return findScrollContainer(frame);
}

/**
 * `scrollerKey` re-attaches the scroll listener when the scroll container itself changes
 * identity without a content rebuild — the one case today is entering/leaving presentation
 * mode, where the fullscreen wrapper becomes (then stops being) the scroller.
 */
export function useSlideNav(
  hostRef: RefObject<HTMLElement | null>,
  renderKey: string,
  scrollerKey?: unknown,
): SlideNav {
  const [found, setFound] = useState<{ slides: SlideInfo[]; frame: HTMLIFrameElement | null }>({
    slides: [],
    frame: null,
  });
  const [activeIndex, setActiveIndex] = useState(-1);

  // ── Discovery: bounded poll, re-armed per content rebuild ────────────────────────────
  useEffect(() => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const scan = () => {
      if (cancelled) return;
      const frame = hostRef.current?.querySelector('iframe') ?? null;
      const root = frame?.contentDocument?.querySelector('[data-mx-story-root]');
      const slides = root ? findSlides(root) : [];
      if (slides.length > 0) {
        setFound({ slides, frame });
        setActiveIndex((i) => (i === -1 ? 0 : Math.min(i, slides.length - 1)));
        return;
      }
      if (++attempts < POLL_ATTEMPTS) {
        timer = setTimeout(scan, POLL_MS);
      } else {
        setFound({ slides: [], frame: null });
        setActiveIndex(-1);
      }
    };
    timer = setTimeout(scan, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hostRef, renderKey]);

  // ── Active slide from scroll (rAF-throttled; listener follows the current scroller) ──
  const { slides, frame } = found;
  useEffect(() => {
    if (slides.length === 0 || !frame) return;
    const scroller = resolveScroller(frame);
    if (!scroller) return;
    // Scroll events don't bubble across elements, but do reach the document for the
    // root scroller — attach where they actually fire.
    const doc = scroller.ownerDocument;
    const target: EventTarget = scroller === doc.scrollingElement ? doc : scroller;
    let raf: number | null = null;
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const tops = slides.map((s) => slideTop(s.el, frame, scroller));
        setActiveIndex(activeSlideIndex(tops, scroller.scrollTop, scroller.clientHeight));
      });
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [slides, frame, scrollerKey]);

  const goTo = useCallback(
    (index: number) => {
      if (slides.length === 0 || !frame) return;
      const clamped = Math.max(0, Math.min(index, slides.length - 1));
      const scroller = resolveScroller(frame);
      if (!scroller) return;
      // Instant, not smooth: Chromium silently cancels a smooth programmatic scroll when
      // layout is still churning (embed hydration, the rebuild height pin resizing the
      // container), which left goTo a no-op in the real app. An instant jump is also the
      // conventional paging behavior for a deck.
      scroller.scrollTo({ top: slideTop(slides[clamped].el, frame, scroller), behavior: 'auto' });
      // Optimistic: the smooth scroll confirms via the scroll listener, but keyboard
      // paging must not depend on scroll events having settled between key presses.
      setActiveIndex(clamped);
    },
    [slides, frame],
  );
  const next = useCallback(() => goTo(activeIndex + 1), [goTo, activeIndex]);
  const prev = useCallback(() => goTo(activeIndex - 1), [goTo, activeIndex]);

  return { slides, frame, activeIndex, goTo, next, prev };
}
