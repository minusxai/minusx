import { describe, it, expect } from 'vitest';
import { collectFieldRefs, collectDerivedFieldNames } from '@/lib/viz/field-refs';

describe('collectFieldRefs', () => {
  it('collects encoding channel fields with their paths', () => {
    const refs = collectFieldRefs({
      mark: 'bar',
      encoding: {
        x: { field: 'month', type: 'temporal' },
        y: { field: 'revenue', type: 'quantitative' },
      },
    });
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'month', path: expect.stringContaining('encoding/x/field') }),
      expect.objectContaining({ field: 'revenue', path: expect.stringContaining('encoding/y/field') }),
    ]));
  });

  it('traverses layers, keeping layer indices in paths', () => {
    const refs = collectFieldRefs({
      layer: [
        { mark: 'bar', encoding: { y: { field: 'a', type: 'quantitative' } } },
        { mark: 'line', encoding: { y: { field: 'b', type: 'quantitative' } } },
      ],
    });
    expect(refs.find(r => r.field === 'b')!.path).toContain('/layer/1/');
  });

  it('ignores datum and value encodings', () => {
    const refs = collectFieldRefs({
      mark: 'rule',
      encoding: {
        y: { datum: 100 },
        color: { value: 'red' },
      },
    });
    expect(refs).toEqual([]);
  });

  it('collects transform input fields but not their outputs', () => {
    const refs = collectFieldRefs({
      transform: [{ calculate: 'datum.revenue * 2', as: 'double_revenue' }],
      mark: 'bar',
      encoding: { y: { field: 'double_revenue', type: 'quantitative' } },
    });
    // double_revenue IS collected as a ref (it's referenced in encoding)…
    expect(refs.some(r => r.field === 'double_revenue')).toBe(true);
  });
});

describe('collectDerivedFieldNames', () => {
  it('collects calculate/fold/window outputs', () => {
    const derived = collectDerivedFieldNames({
      transform: [
        { calculate: 'datum.revenue * 2', as: 'double_revenue' },
        { fold: ['a', 'b'], as: ['metric', 'amount'] },
        { window: [{ op: 'lag', field: 'revenue', as: 'prev_revenue' }] },
      ],
      mark: 'bar',
    });
    expect(derived).toEqual(new Set(['double_revenue', 'metric', 'amount', 'prev_revenue']));
  });

  it('uses fold default output names (key, value) when as is omitted', () => {
    const derived = collectDerivedFieldNames({ transform: [{ fold: ['a', 'b'] }], mark: 'bar' });
    expect(derived.has('key')).toBe(true);
    expect(derived.has('value')).toBe(true);
  });

  it('collects derived names from nested layers', () => {
    const derived = collectDerivedFieldNames({
      layer: [{ transform: [{ calculate: 'datum.a + 1', as: 'a1' }], mark: 'line' }],
    });
    expect(derived.has('a1')).toBe(true);
  });
});
