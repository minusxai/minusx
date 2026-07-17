import { describe, it, expect } from 'vitest';
import { locatePoint, wordAt, selectionBands, selectionText } from '@/lib/canvas-story/selection';
import type { StoryTextRun } from '@/lib/canvas-story/types';

// Two-line paragraph (block 1) followed by a heading line (block 2).
const runs: StoryTextRun[] = [
  { text: 'Growth was broad', x: 10, y: 10, w: 160, h: 20, block: 1 },
  { text: 'across the board', x: 10, y: 40, w: 160, h: 20, block: 1 },
  { text: 'Revenue', x: 10, y: 100, w: 70, h: 30, block: 2 },
];

describe('locatePoint', () => {
  it('hits the run under the pointer with a proportional offset', () => {
    const p = locatePoint(runs, 90, 20);
    expect(p).toEqual({ run: 0, offset: 8 }); // midpoint of 16 chars
  });

  it('snaps to the nearest run when the pointer is in dead space', () => {
    expect(locatePoint(runs, 300, 12)?.run).toBe(0); // right of line 1
    expect(locatePoint(runs, 12, 75)?.run).toBe(1);  // between blocks, nearer line 2
  });

  it('clamps offsets to the run bounds', () => {
    expect(locatePoint(runs, 0, 12)?.offset).toBe(0);
    expect(locatePoint(runs, 500, 12)?.offset).toBe(16);
  });

  it('returns null when there are no runs', () => {
    expect(locatePoint([], 10, 10)).toBeNull();
  });
});

describe('wordAt', () => {
  it('expands to word boundaries around the offset', () => {
    // 'Growth was broad' — offset 8 sits inside 'was'
    const sel = wordAt(runs, { run: 0, offset: 8 });
    expect(sel).toEqual({ a: { run: 0, offset: 7 }, b: { run: 0, offset: 10 } });
  });

  it('returns null on non-word characters', () => {
    expect(wordAt(runs, { run: 0, offset: 6 })).toBeNull(); // the space
  });
});

describe('selectionBands', () => {
  it('covers full middle runs and partial endpoint runs', () => {
    const bands = selectionBands(runs, { a: { run: 0, offset: 8 }, b: { run: 2, offset: 7 } });
    expect(bands).toHaveLength(3);
    expect(bands[0].x).toBeCloseTo(10 + (8 / 16) * 160); // starts mid-run
    expect(bands[1].x).toBe(10);                          // full run
    expect(bands[1].w).toBe(160);
    expect(bands[2].w).toBeCloseTo(70);                   // whole heading
  });

  it('extends a band to the next line top within the same block (fills leading)', () => {
    const bands = selectionBands(runs, { a: { run: 0, offset: 0 }, b: { run: 1, offset: 16 } });
    expect(bands[0].h).toBe(30);  // 40 - 10: reaches line 2's top
    expect(bands[1].h).toBe(20);  // last line keeps its own height
  });

  it('normalizes a backwards (b before a) selection', () => {
    const fwd = selectionBands(runs, { a: { run: 0, offset: 2 }, b: { run: 1, offset: 5 } });
    const bwd = selectionBands(runs, { a: { run: 1, offset: 5 }, b: { run: 0, offset: 2 } });
    expect(bwd).toEqual(fwd);
  });

  it('returns no band for a collapsed selection', () => {
    expect(selectionBands(runs, { a: { run: 0, offset: 5 }, b: { run: 0, offset: 5 } })).toEqual([]);
  });
});

describe('selectionText', () => {
  it('joins same-block lines with a space and blocks with a newline', () => {
    const text = selectionText(runs, { a: { run: 0, offset: 0 }, b: { run: 2, offset: 7 } });
    expect(text).toBe('Growth was broad across the board\nRevenue');
  });

  it('slices the endpoint runs by offset', () => {
    const text = selectionText(runs, { a: { run: 0, offset: 7 }, b: { run: 0, offset: 10 } });
    expect(text).toBe('was');
  });
});
