/**
 * Slide navigation math — the parent-document side of the SlideDeck contract.
 * jsdom has no layout, so every geometry input is stubbed; what these tests pin is the
 * arithmetic and the discovery/fallback rules, which is all the module owns.
 */
import { describe, it, expect } from 'vitest';
import {
  findSlides,
  findScrollContainer,
  slideTop,
  activeSlideIndex,
} from '../slide-nav';

function rect(top: number): DOMRect {
  return { top, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

describe('findSlides', () => {
  it('returns [data-mx-slide] elements in document order with title resolution', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <section data-mx-slide data-mx-slide-title="Cover"><h1>Ignored — attr wins</h1></section>
      <section data-mx-slide><h2>  Heading fallback  </h2></section>
      <section data-mx-slide><p>no heading at all</p></section>
    `;
    const slides = findSlides(root);
    expect(slides.map((s) => s.title)).toEqual(['Cover', 'Heading fallback', 'Slide 3']);
    expect(slides.map((s) => s.el.tagName)).toEqual(['SECTION', 'SECTION', 'SECTION']);
  });

  it('returns empty for a root with no slides', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div><p>prose story</p></div>';
    expect(findSlides(root)).toEqual([]);
  });
});

describe('findScrollContainer', () => {
  it('picks the nearest ancestor with overflow-y auto/scroll', () => {
    const outer = document.createElement('div');
    outer.style.overflowY = 'auto';
    const inner = document.createElement('div');
    inner.style.overflowY = 'scroll';
    const leaf = document.createElement('div');
    outer.appendChild(inner);
    inner.appendChild(leaf);
    document.body.appendChild(outer);
    try {
      expect(findScrollContainer(leaf)).toBe(inner);
      expect(findScrollContainer(inner)).toBe(outer);
    } finally {
      outer.remove();
    }
  });

  it('falls back to the document scrolling element when no ancestor scrolls', () => {
    const leaf = document.createElement('div');
    document.body.appendChild(leaf);
    try {
      // jsdom leaves scrollingElement unset; the contract is "scrollingElement, else null".
      expect(findScrollContainer(leaf)).toBe(document.scrollingElement ?? null);
    } finally {
      leaf.remove();
    }
  });
});

describe('slideTop', () => {
  it('maps an in-iframe slide rect through the frame offset into scroller coordinates', () => {
    const slide = document.createElement('section');
    const frame = document.createElement('iframe');
    const scroller = document.createElement('div');
    slide.getBoundingClientRect = () => rect(300); // iframe-viewport coords
    frame.getBoundingClientRect = () => rect(120); // parent-viewport coords
    scroller.getBoundingClientRect = () => rect(60);
    Object.defineProperty(scroller, 'scrollTop', { value: 500, configurable: true });
    expect(slideTop(slide, frame, scroller)).toBe(500 + 300 + 120 - 60);
  });

  it('works without a frame (slide living in the scroller document)', () => {
    const slide = document.createElement('section');
    const scroller = document.createElement('div');
    slide.getBoundingClientRect = () => rect(300);
    scroller.getBoundingClientRect = () => rect(60);
    Object.defineProperty(scroller, 'scrollTop', { value: 500, configurable: true });
    expect(slideTop(slide, null, scroller)).toBe(500 + 300 - 60);
  });
});

describe('activeSlideIndex', () => {
  const tops = [0, 800, 1600];
  it('is the last slide whose top has entered the upper part of the viewport', () => {
    expect(activeSlideIndex(tops, 0, 800)).toBe(0);
    expect(activeSlideIndex(tops, 10, 800)).toBe(0);
    // threshold = scrollTop + 40% viewport: 700 + 320 >= 800 → slide 2 active
    expect(activeSlideIndex(tops, 700, 800)).toBe(1);
    expect(activeSlideIndex(tops, 800, 800)).toBe(1);
    expect(activeSlideIndex(tops, 5000, 800)).toBe(2);
  });
  it('defaults to the first slide when scrolled above the deck, -1 when empty', () => {
    expect(activeSlideIndex([500, 1300], 0, 800)).toBe(0);
    expect(activeSlideIndex([], 100, 800)).toBe(-1);
  });
});
