import { describe, it, expect } from 'vitest';
import {
  MARKER_CADENCE_PX,
  markerCount,
  markerY,
  pageMarkers,
  markerDrawPositions,
  visibleMarkers,
  formatViewportPointer,
} from '@/lib/screenshot/page-markers';

const C = 600; // explicit cadence for readable expectations

describe('markerCount', () => {
  it('is ceil(docHeight / cadence), floored at 1', () => {
    expect(markerCount(600, C)).toBe(1);
    expect(markerCount(601, C)).toBe(2);
    expect(markerCount(1200, C)).toBe(2);
    expect(markerCount(1201, C)).toBe(3);
    expect(markerCount(3000, C)).toBe(5);
  });
  it('never returns 0 for empty/degenerate heights', () => {
    expect(markerCount(0, C)).toBe(1);
    expect(markerCount(-50, C)).toBe(1);
  });
});

describe('markerY', () => {
  it('places label n at the TOP of its band: (n-1)*cadence', () => {
    expect(markerY(1, C)).toBe(0);
    expect(markerY(2, C)).toBe(600);
    expect(markerY(3, C)).toBe(1200);
  });
});

describe('pageMarkers', () => {
  it('lists every label with its document-space y', () => {
    expect(pageMarkers(1300, C)).toEqual([
      { label: 1, y: 0 },
      { label: 2, y: 600 },
      { label: 3, y: 1200 },
    ]);
  });
  it('defaults to MARKER_CADENCE_PX', () => {
    expect(pageMarkers(MARKER_CADENCE_PX * 2)).toHaveLength(2);
  });
});

describe('markerDrawPositions', () => {
  it('scales each band-top y into output-image pixels', () => {
    // 3000px page (5 bands) captured at 0.4× → bands at doc-y 0,600,…,2400 land at 0,240,…,960
    expect(markerDrawPositions(3000, 0.4, C)).toEqual([
      { label: 1, y: 0 },
      { label: 2, y: 240 },
      { label: 3, y: 480 },
      { label: 4, y: 720 },
      { label: 5, y: 960 },
    ]);
  });
});

describe('visibleMarkers', () => {
  it('reports the band range the viewport spans and the centered band', () => {
    // viewport [0, 800) of a 3000px page (5 bands): tops band 1, bottom 800→band 2, center 400→band 1
    expect(visibleMarkers(0, 800, 3000, C)).toEqual({ first: 1, last: 2, centered: 1 });
    // viewport [1000, 1800): top 1000→band 2, bottom 1800→band 4, center 1400→band 3
    expect(visibleMarkers(1000, 800, 3000, C)).toEqual({ first: 2, last: 4, centered: 3 });
  });
  it('clamps a negative scrollTop (scrolled above content) to the first band', () => {
    expect(visibleMarkers(-100, 800, 3000, C)).toEqual({ first: 1, last: 2, centered: 1 });
  });
  it('clamps past-the-end scroll to the last band', () => {
    expect(visibleMarkers(5000, 800, 3000, C)).toEqual({ first: 5, last: 5, centered: 5 });
  });
});

describe('formatViewportPointer', () => {
  it('names a single section when the viewport fits one band', () => {
    expect(formatViewportPointer({ first: 3, last: 3, centered: 3 }, 5)).toBe(
      'The user is viewing section 3 of 5.',
    );
  });
  it('names the range and the centered band when the viewport spans several', () => {
    expect(formatViewportPointer({ first: 2, last: 4, centered: 3 }, 5)).toBe(
      'The user is viewing sections 2–4 of 5 (centered on 3).',
    );
  });
});
