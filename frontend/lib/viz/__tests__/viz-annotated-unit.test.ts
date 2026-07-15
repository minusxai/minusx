/**
 * Annotated-unit recognition ("bring annotations into the fold"): a spec of shape
 * {layer: [unit chart, ...datum-only rule/rect/text layers]} is still recognized as its
 * base chart type — the panel keeps drop zones, type switching, settings, and the
 * shared tooltip, instead of degrading to Custom. Pure structural detection, so
 * agent-authored reference lines fold in too. No stored-data migration: the layers
 * ARE the format.
 */
import { describe, it, expect } from 'vitest';
import {
  addReferenceLine, unitOf, getVizType, getEnvelopeVizType, isEnvelopeEditable,
  setVizType, setChannelField, getStacked, setStacked, getSeriesColors,
} from '../encoding-edit';
import { buildTooltipPlan } from '../tooltip-plan';
import { COLOR_PALETTE } from '@/lib/chart/echarts-theme';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const envelope = (spec: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
}) as VizEnvelope;

const specOf = (env: VizEnvelope): Record<string, any> =>
  (env.source as unknown as { spec: Record<string, any> }).spec;

const LINE = () => envelope({
  mark: { type: 'line' },
  encoding: {
    x: { field: 'week', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative' },
  },
});

const annotated = () => addReferenceLine(LINE(), { axis: 'y', value: 500, label: 'Target' });

describe('annotated-unit detection', () => {
  it('unitOf sees through annotation layers to the base chart', () => {
    const spec = specOf(annotated());
    expect(unitOf(spec)?.encoding).toEqual(expect.objectContaining({ y: expect.objectContaining({ field: 'revenue' }) }));
  });

  it('the chart KEEPS its type (line, not custom)', () => {
    expect(getVizType(specOf(annotated()))).toBe('line');
    expect(getEnvelopeVizType(annotated())).toBe('line');
  });

  it('stays panel-editable', () => {
    expect(isEnvelopeEditable(annotated())).toBe(true);
  });

  it('a spec with a FIELD-encoded extra layer is NOT folded in (genuinely custom)', () => {
    const custom = envelope({
      layer: [
        specOf(LINE()),
        { mark: { type: 'point' }, encoding: { x: { field: 'week', type: 'temporal' }, y: { field: 'other', type: 'quantitative' } } },
      ],
    });
    expect(getEnvelopeVizType(custom)).toBeNull();
  });
});

describe('editing operates on the base layer, annotations survive', () => {
  it('type switch (line → bar) transforms the base and keeps the reference line', () => {
    const next = setVizType(annotated(), 'bar');
    const spec = specOf(next);
    expect(spec.layer[0].mark.type).toBe('bar');
    expect(spec.layer[1].mark.type).toBe('rule'); // annotation untouched
  });

  it('channel edits hit the base layer', () => {
    const next = setChannelField(annotated(), 'color', { name: 'platform', kind: 'nominal' });
    expect(specOf(next).layer[0].encoding.color.field).toBe('platform');
  });

  it('settings toggles (stacked) read/write the base layer', () => {
    const off = setStacked(annotated(), false);
    expect(specOf(off).layer[0].encoding.y.stack).toBeNull();
    expect(getStacked(specOf(off))).toBe(false);
  });

  it('series colors resolve from the base layer', () => {
    const series = getSeriesColors(annotated(), [{ week: 'W1', revenue: 1 }]);
    expect(series).toEqual([{ key: 'revenue', color: COLOR_PALETTE[0], overridden: false }]);
  });

  it('the shared tooltip still plans against the base chart', () => {
    const plan = buildTooltipPlan(specOf(annotated()));
    expect(plan).not.toBeNull();
    expect(plan!.xField).toBe('week');
  });
});
