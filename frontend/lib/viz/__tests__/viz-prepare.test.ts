import { describe, it, expect } from 'vitest';
import { prepareVegaLiteSpec } from '@/lib/viz/prepare';
import { VIZ_DATASET_MAIN } from '@/lib/viz/types';

describe('prepareVegaLiteSpec', () => {
  it('injects data: {name: "main"} when data is absent', () => {
    const spec = { mark: 'bar', encoding: {} };
    const prepared = prepareVegaLiteSpec(spec);
    expect(prepared.data).toEqual({ name: VIZ_DATASET_MAIN });
  });

  it('leaves an existing data declaration untouched', () => {
    const spec = { mark: 'bar', data: { name: VIZ_DATASET_MAIN } };
    const prepared = prepareVegaLiteSpec(spec);
    expect(prepared.data).toEqual({ name: VIZ_DATASET_MAIN });
  });

  it('does not mutate the input spec', () => {
    const spec = { mark: 'bar' } as Record<string, unknown>;
    prepareVegaLiteSpec(spec);
    expect('data' in spec).toBe(false);
  });
});
