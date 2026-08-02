/**
 * Slide navigation — the parent-document side of the `<SlideDeck>` contract.
 *
 * `components/kit/slides.tsx` stamps each rendered slide `data-mx-slide` (+ optional
 * `data-mx-slide-title`); this module is everything the surrounding chrome (the birds-eye
 * rail and the present-mode controls in `components/views/story/`) needs to navigate them:
 * discovery + title resolution, the iframe→parent coordinate mapping, and the
 * active-slide rule. Pure DOM math, no React and no state — the story iframe is
 * same-origin and content-sized (it never scrolls itself), so navigation always means
 * scrolling a PARENT-document container by an offset computed through the frame's rect.
 */

export interface SlideInfo {
  el: HTMLElement;
  /** Authored `data-mx-slide-title`, else the slide's first h1–h3 text, else "Slide N". */
  title: string;
}

/** All stamped slides under `root` (typically the surface root's document), in document order. */
export function findSlides(root: ParentNode): SlideInfo[] {
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-mx-slide]'));
  return els.map((el, i) => {
    const authored = el.getAttribute('data-mx-slide-title');
    const heading = authored ?? el.querySelector('h1, h2, h3')?.textContent?.trim();
    return { el, title: heading || `Slide ${i + 1}` };
  });
}

/**
 * Nearest ancestor of `start` (in start's own document) styled to scroll vertically.
 * Detection is by computed overflow-y only — deliberately not scrollHeight>clientHeight,
 * which would skip a scroll container that merely doesn't overflow *yet* (and reads 0 in
 * jsdom). Falls back to the document's scrolling element.
 */
export function findScrollContainer(start: HTMLElement): HTMLElement | null {
  const doc = start.ownerDocument;
  const win = doc.defaultView;
  for (let el = start.parentElement; el; el = el.parentElement) {
    const overflowY = win?.getComputedStyle(el).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return el;
  }
  return (doc.scrollingElement as HTMLElement | null) ?? null;
}

/**
 * The scroller scrollTop that puts `slide`'s top at the top of `scroller`.
 * `frame` is the story iframe element (in the scroller's document) when the slide lives
 * inside it: the slide's rect is in iframe-viewport coordinates and the iframe never
 * scrolls, so parent-viewport position = slide rect + frame rect.
 */
export function slideTop(slide: HTMLElement, frame: HTMLElement | null, scroller: HTMLElement): number {
  const inParentViewport = slide.getBoundingClientRect().top + (frame ? frame.getBoundingClientRect().top : 0);
  return scroller.scrollTop + inParentViewport - scroller.getBoundingClientRect().top;
}

/**
 * The slide the reader is "on": the last one whose top has entered the upper 40% of the
 * viewport, so a slide becomes active as it takes over the screen rather than only once
 * fully aligned. First slide while above the deck; -1 only when there are no slides.
 */
export function activeSlideIndex(slideTops: number[], scrollTop: number, viewportH: number): number {
  if (slideTops.length === 0) return -1;
  const threshold = scrollTop + viewportH * 0.4;
  let active = 0;
  for (let i = 0; i < slideTops.length; i++) {
    if (slideTops[i] <= threshold) active = i;
  }
  return active;
}
