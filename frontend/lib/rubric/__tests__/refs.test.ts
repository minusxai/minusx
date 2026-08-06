import { describe, expect, it } from 'vitest';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { questionVizType } from '../refs';

describe('questionVizType', () => {
  it('prefers the V2 Vega envelope over stale legacy settings', () => {
    const viz = {
      version: 2,
      source: {
        kind: 'vega-lite',
        grammar: 'vega-lite@6',
        spec: {
          mark: 'bar',
          encoding: {
            x: { field: 'region', type: 'nominal' },
            y: { field: 'revenue', type: 'quantitative' },
          },
        },
      },
    } as VizEnvelope;
    expect(questionVizType({ viz, vizSettings: { type: 'table' } })).toBe('bar');
  });

  it('falls back to legacy only when V2 is absent', () => {
    expect(questionVizType({ vizSettings: { type: 'line' } })).toBe('line');
  });
});
