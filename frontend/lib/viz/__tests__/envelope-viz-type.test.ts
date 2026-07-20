// envelopeVizType — reverse mapping from a V2 envelope to the classic viz-type vocabulary
// (consumers: story embed "bare" detection for single-value, review-context embed measurements).
import { describe, it, expect } from 'vitest';
import { envelopeVizType } from '../viz-templates';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const env = (source: Record<string, unknown>): VizEnvelope => ({ version: 2, source } as unknown as VizEnvelope);

describe('envelopeVizType', () => {
  it('maps DOM-tier kinds straight through', () => {
    expect(envelopeVizType(env({ kind: 'table', columnFormats: null, conditionalFormats: null, css: null }))).toBe('table');
    expect(envelopeVizType(env({ kind: 'pivot', config: {}, columnFormats: null, conditionalFormats: null, css: null }))).toBe('pivot');
  });

  it('maps recipes via the template registry (single-value → single_value)', () => {
    expect(envelopeVizType(env({ kind: 'recipe', recipe: 'minusx/single-value@1', bindings: { value: 'x' }, params: null, columnFormats: null }))).toBe('single_value');
    expect(envelopeVizType(env({ kind: 'recipe', recipe: 'minusx/funnel@1', bindings: {}, params: null, columnFormats: null }))).toBe('funnel');
  });

  it('returns undefined for raw vega/vega-lite specs and missing envelopes', () => {
    expect(envelopeVizType(env({ kind: 'vega-lite', grammar: 'vega-lite@6', spec: {} }))).toBeUndefined();
    expect(envelopeVizType(null)).toBeUndefined();
    expect(envelopeVizType(undefined)).toBeUndefined();
    expect(envelopeVizType(env({ kind: 'recipe', recipe: 'minusx/does-not-exist@9', bindings: {}, params: null, columnFormats: null }))).toBeUndefined();
  });
});
