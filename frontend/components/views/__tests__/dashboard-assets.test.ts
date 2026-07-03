/**
 * Regression: a dashboard whose content accumulated duplicate asset ids (across
 * assets + layout.items) crashed react-grid-layout in containerHeight → bottom()
 * with "Cannot read properties of undefined (reading 'y')". Duplicate grid keys
 * corrupt RGL's internal layout. getLayoutableAssets must collapse them to unique
 * keys so the grid never receives duplicates.
 */
import { describe, it, expect } from 'vitest';
import { getLayoutableAssets, getAssetLayoutKey, getLayoutSignature, computeDashboardLayouts } from '../dashboard-assets';
import type { AssetReference, DashboardLayoutItem } from '@/lib/types';

// Assets with duplicate ids (questions and a text block), interleaved.
const assets = [
  { id: 'text-a', type: 'text', content: '…' },
  { id: 101, type: 'question' },
  { id: 201, type: 'question' },
  { id: 202, type: 'question' },
  { id: 203, type: 'question' },
  { id: 'text-b', type: 'text', content: '…' },
  { id: 204, type: 'question' },
  { id: 201, type: 'question' },   // dup
  { id: 202, type: 'question' },   // dup
  { id: 205, type: 'question' },
  { id: 203, type: 'question' },   // dup
  { id: 'text-b', type: 'text', content: '…' }, // dup
  { id: 204, type: 'question' },   // dup
  { id: 201, type: 'question' },   // dup
  { id: 202, type: 'question' },   // dup
  { id: 205, type: 'question' },   // dup
  { id: 203, type: 'question' },   // dup
] as unknown as AssetReference[];

describe('getLayoutableAssets', () => {
  it('collapses duplicate asset ids to unique grid keys (no RGL-crashing duplicates)', () => {
    const result = getLayoutableAssets(assets);
    const keys = result.map(getAssetLayoutKey);
    expect(new Set(keys).size).toBe(keys.length); // every key unique
    // first occurrence wins → order preserved, one entry per distinct id
    expect(keys).toEqual(['text-a', '101', '201', '202', '203', 'text-b', '204', '205']);
  });

  it('filters out non-layoutable assets (missing/empty id)', () => {
    const dirty = [
      { id: 0, type: 'question' },            // falsy id → dropped
      { id: '', type: 'text', content: 'x' }, // empty id → dropped
      { id: 42, type: 'question' },
    ] as unknown as AssetReference[];
    expect(getLayoutableAssets(dirty).map(getAssetLayoutKey)).toEqual(['42']);
  });

  it('handles null/undefined assets safely', () => {
    expect(getLayoutableAssets(undefined as unknown as AssetReference[])).toEqual([]);
  });
});

/**
 * Perf: editing a text block's content must NOT invalidate the grid layout. The
 * layout memo keys off getLayoutSignature (id + type of layoutable assets), which
 * is invariant to text content — so typing doesn't force a whole-grid re-layout
 * or regenerate the grid background every keystroke-debounce.
 */
describe('getLayoutSignature', () => {
  const withContent = (content: string): AssetReference[] => ([
    { id: 'tb1', type: 'text', content },
    { id: 5, type: 'question' },
  ] as unknown as AssetReference[]);

  it('is identical when only a text block’s content changes', () => {
    expect(getLayoutSignature(withContent('hello'))).toBe(getLayoutSignature(withContent('a totally different, longer heading')));
  });

  it('changes when a layoutable asset is added or removed', () => {
    const base = withContent('x');
    const added = [...base, { id: 'tb2', type: 'text', content: '' }] as unknown as AssetReference[];
    expect(getLayoutSignature(base)).not.toBe(getLayoutSignature(added));
  });

  it('changes when an asset type changes for the same key', () => {
    const a = [{ id: 5, type: 'question' }] as unknown as AssetReference[];
    const b = [{ id: 5, type: 'text', content: '' }] as unknown as AssetReference[];
    expect(getLayoutSignature(a)).not.toBe(getLayoutSignature(b));
  });
});

describe('computeDashboardLayouts', () => {
  const items: DashboardLayoutItem[] = [
    { id: 'tb1', x: 0, y: 0, w: 6, h: 1 },
    { id: 5, x: 6, y: 0, w: 6, h: 4 },
  ] as unknown as DashboardLayoutItem[];
  const assets = (content: string): AssetReference[] => ([
    { id: 'tb1', type: 'text', content },
    { id: 5, type: 'question' },
  ] as unknown as AssetReference[]);

  it('is value-equal when only text content changes (stable grid layout)', () => {
    const a = computeDashboardLayouts(assets('hello'), items, {});
    const b = computeDashboardLayouts(assets('changed and much longer'), items, {});
    expect(b).toEqual(a);
  });

  it('places assets from their saved layout items', () => {
    const { lg } = computeDashboardLayouts(assets('x'), items, {});
    expect(lg.find(l => l.i === 'tb1')).toMatchObject({ x: 0, y: 0, w: 6, h: 1 });
    expect(lg.find(l => l.i === '5')).toMatchObject({ x: 6, y: 0, w: 6, h: 4 });
  });

  it('grows a text block’s height for a "Read more" expansion (never shrinks)', () => {
    const grown = computeDashboardLayouts(assets('x'), items, { tb1: 4 });
    expect(grown.lg.find(l => l.i === 'tb1')?.h).toBe(4); // max(1, 4)
    const notShrunk = computeDashboardLayouts(assets('x'), items, { 5: 2 });
    expect(notShrunk.lg.find(l => l.i === '5')?.h).toBe(4); // max(4, 2)
  });

  it('places an asset missing from layout items below the rest', () => {
    const onlyQuestion: DashboardLayoutItem[] = [{ id: 5, x: 0, y: 0, w: 6, h: 4 }] as unknown as DashboardLayoutItem[];
    const { lg } = computeDashboardLayouts(assets('x'), onlyQuestion, {});
    const tb = lg.find(l => l.i === 'tb1');
    expect(tb).toBeTruthy();
    expect(tb!.y).toBeGreaterThanOrEqual(4); // below the existing question
  });

  it('generates a default stacked layout when there are no layout items', () => {
    const { lg } = computeDashboardLayouts(assets('x'), undefined, {});
    expect(lg).toHaveLength(2);
    expect(lg.every(l => typeof l.y === 'number')).toBe(true);
  });
});
