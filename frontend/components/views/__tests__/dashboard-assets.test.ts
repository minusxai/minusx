/**
 * Regression: a dashboard whose content accumulated duplicate asset ids (across
 * assets + layout.items) crashed react-grid-layout in containerHeight → bottom()
 * with "Cannot read properties of undefined (reading 'y')". Duplicate grid keys
 * corrupt RGL's internal layout. getLayoutableAssets must collapse them to unique
 * keys so the grid never receives duplicates.
 */
import { describe, it, expect } from 'vitest';
import { getLayoutableAssets, getAssetLayoutKey } from '../dashboard-assets';
import type { AssetReference } from '@/lib/types';

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
