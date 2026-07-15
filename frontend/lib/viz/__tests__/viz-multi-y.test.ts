/**
 * Multi-measure Y (the classic yCols case): dropping a second quantitative column
 * onto Y creates a `fold` transform (RFC §4 — wide data dissolves into fold), with
 * y = folded value + color = measure key. Further drops append; removals unfold
 * back to a plain field when one measure remains. Agent-authored folds (default
 * ['key','value'] output names) are recognized and extended, not duplicated.
 */
import { describe, it, expect } from 'vitest';
import { getYFields, addYField, removeYField } from '@/lib/viz/encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const envelope = (spec: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
}) as VizEnvelope;

const specOf = (env: VizEnvelope): Record<string, any> =>
  (env.source as unknown as { spec: Record<string, any> }).spec;

const BAR = {
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative', axis: { format: ',.0f' } },
  },
};

const Q = (name: string) => ({ name, kind: 'quantitative' as const });

describe('addYField', () => {
  it('first field is a plain y encoding', () => {
    const empty = envelope({ mark: 'bar', encoding: { x: { field: 'month', type: 'temporal' } } });
    const next = addYField(empty, Q('revenue'));
    expect(specOf(next).encoding.y.field).toBe('revenue');
    expect(specOf(next).transform).toBeUndefined();
  });

  it('second field creates a fold; y reads the folded value, color the measure key', () => {
    const next = addYField(envelope(BAR), Q('profit'));
    const spec = specOf(next);
    expect(spec.transform).toEqual([{ fold: ['revenue', 'profit'], as: ['__mx_key', '__mx_value'] }]);
    expect(spec.encoding.y.field).toBe('__mx_value');
    expect(spec.encoding.y.axis).toEqual({ format: ',.0f' }); // y props survive the fold
    expect(spec.encoding.y.title).toBeNull(); // the internal '__mx_value' name never leaks as an axis title
    expect(spec.encoding.color).toEqual({ field: '__mx_key', type: 'nominal', title: null });
    expect(getYFields(spec)).toEqual(['revenue', 'profit']);
  });

  it('third field appends to the existing fold (deduped)', () => {
    const two = addYField(envelope(BAR), Q('profit'));
    const three = addYField(two, Q('cost'));
    expect(getYFields(specOf(three))).toEqual(['revenue', 'profit', 'cost']);
    expect(getYFields(specOf(addYField(three, Q('cost'))))).toEqual(['revenue', 'profit', 'cost']);
  });

  it('does not steal a color channel already bound to a real category', () => {
    const withColor = envelope({ ...BAR, encoding: { ...BAR.encoding, color: { field: 'region', type: 'nominal' } } });
    const next = addYField(withColor, Q('profit'));
    expect(specOf(next).encoding.color.field).toBe('region'); // untouched
    expect(getYFields(specOf(next))).toEqual(['revenue', 'profit']); // fold still happens
  });

  it('extends an agent-authored fold with default output names', () => {
    const agent = envelope({
      mark: 'line',
      transform: [{ fold: ['a', 'b'] }],
      encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'value', type: 'quantitative' }, color: { field: 'key', type: 'nominal' } },
    });
    const next = addYField(agent, Q('c'));
    expect(specOf(next).transform[0].fold).toEqual(['a', 'b', 'c']);
    expect(getYFields(specOf(next))).toEqual(['a', 'b', 'c']);
  });
});

describe('removeYField', () => {
  it('removing down to one measure unfolds back to a plain y (props restored, key color dropped)', () => {
    const two = addYField(envelope(BAR), Q('profit'));
    const one = removeYField(two, 'profit');
    const spec = specOf(one);
    expect(spec.transform).toBeUndefined();
    expect(spec.encoding.y.field).toBe('revenue');
    expect(spec.encoding.y.axis).toEqual({ format: ',.0f' });
    expect('title' in spec.encoding.y).toBe(false); // fold's title:null is cleared so the single measure auto-titles
    expect(spec.encoding.color).toBeUndefined();
  });

  it('removing one of three keeps the fold with the rest', () => {
    const three = addYField(addYField(envelope(BAR), Q('profit')), Q('cost'));
    const spec = specOf(removeYField(three, 'profit'));
    expect(getYFields(spec)).toEqual(['revenue', 'cost']);
  });

  it('unfolding preserves a real category color (never dropped)', () => {
    const withColor = envelope({ ...BAR, encoding: { ...BAR.encoding, color: { field: 'region', type: 'nominal' } } });
    const spec = specOf(removeYField(addYField(withColor, Q('profit')), 'profit'));
    expect(spec.encoding.color.field).toBe('region');
  });

  it('removing the only plain y clears the channel', () => {
    const spec = specOf(removeYField(envelope(BAR), 'revenue'));
    expect(spec.encoding.y).toBeUndefined();
  });
});
