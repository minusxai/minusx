/**
 * Pure geometry for the story grid: the single defaulting/clamping rule shared by the
 * view-mode CSS component and the edit-mode RGL adapter, and the drag-commit diff whose
 * empty result is the no-echo guard (opening edit mode must never write to the file).
 */
import { describe, it, expect } from 'vitest';

import {
  GRID_DEFAULT_COLS, GRID_DEFAULT_ROW_HEIGHT,
  gridCols, gridRowHeight, gridItemRect, gridRows, diffLayouts,
  type GridItemRect,
} from '@/lib/story-ui/grid-layout';

describe('gridCols / gridRowHeight', () => {
  it('defaults and sanitizes', () => {
    expect(GRID_DEFAULT_COLS).toBe(12);
    expect(GRID_DEFAULT_ROW_HEIGHT).toBe(86);
    expect(gridCols(undefined)).toBe(12);
    expect(gridCols(6)).toBe(6);
    expect(gridCols(6.7)).toBe(7);
    expect(gridCols(0)).toBe(1);
    expect(gridCols(100)).toBe(24);
    expect(gridCols('nope')).toBe(12);
    expect(gridRowHeight(undefined)).toBe(86);
    expect(gridRowHeight(120)).toBe(120);
    expect(gridRowHeight(5)).toBe(20);
    expect(gridRowHeight(9999)).toBe(400);
    expect(gridRowHeight(null)).toBe(86);
  });
});

describe('gridItemRect', () => {
  it('defaults a bare item to x=0 y=0 w=6 h=4', () => {
    expect(gridItemRect({}, 12)).toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });

  it('passes a valid rect through, rounding non-integers', () => {
    expect(gridItemRect({ x: 3, y: 2, w: 4, h: 5 }, 12)).toEqual({ x: 3, y: 2, w: 4, h: 5 });
    expect(gridItemRect({ x: 2.6, y: 1.2, w: 3.5, h: 4.4 }, 12)).toEqual({ x: 3, y: 1, w: 4, h: 4 });
  });

  it('clamps: 1 ≤ w ≤ cols, h ≥ 1, y ≥ 0, 0 ≤ x ≤ cols−w', () => {
    expect(gridItemRect({ w: 0, h: 0 }, 12)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(gridItemRect({ w: 20 }, 12).w).toBe(12);
    expect(gridItemRect({ x: -3, y: -2 }, 12)).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    // x pushed back so the item stays inside the grid.
    expect(gridItemRect({ x: 10, w: 6 }, 12)).toEqual({ x: 6, y: 0, w: 6, h: 4 });
  });

  it('ignores non-numeric junk (defaults win)', () => {
    expect(gridItemRect({ x: 'a', y: null, w: {}, h: [] } as Record<string, unknown>, 12))
      .toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });
});

describe('gridRows', () => {
  it('is max(y+h), minimum 1', () => {
    expect(gridRows([])).toBe(1);
    expect(gridRows([{ x: 0, y: 0, w: 6, h: 4 }])).toBe(4);
    expect(gridRows([
      { x: 0, y: 0, w: 6, h: 4 },
      { x: 6, y: 3, w: 6, h: 5 },
    ])).toBe(8);
  });
});

describe('diffLayouts', () => {
  const current = new Map<string, GridItemRect>([
    ['0.0', { x: 0, y: 0, w: 8, h: 5 }],
    ['0.1', { x: 8, y: 0, w: 4, h: 5 }],
  ]);

  it('returns [] when nothing moved — the RGL mount-echo guard', () => {
    expect(diffLayouts([
      { i: '0.0', x: 0, y: 0, w: 8, h: 5 },
      { i: '0.1', x: 8, y: 0, w: 4, h: 5 },
    ], current)).toEqual([]);
  });

  it('returns an edit per changed item only', () => {
    expect(diffLayouts([
      { i: '0.0', x: 0, y: 0, w: 8, h: 5 },
      { i: '0.1', x: 0, y: 5, w: 12, h: 4 },
    ], current)).toEqual([{ astPath: '0.1', x: 0, y: 5, w: 12, h: 4 }]);
  });

  it('skips unknown keys (an RGL artifact must never invent an item)', () => {
    expect(diffLayouts([{ i: 'ghost', x: 1, y: 1, w: 1, h: 1 }], current)).toEqual([]);
  });

  it('normalizes RGL floats to integers before comparing', () => {
    // Same position expressed as floats — still no edit.
    expect(diffLayouts([{ i: '0.0', x: 0.2, y: -0.4, w: 8.3, h: 4.6 }], current)).toEqual([]);
  });
});
