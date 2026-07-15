/**
 * Reference lines (annotations, Viz Arch V2): written as REAL Vega-Lite layers — the
 * idiomatic rule pattern, plus a BADGE label (tinted rect plate + colored text, the
 * house chip look) — directly into source.spec. No sidecar config: the spec is the
 * single source of truth, and the annotated shape is RECOGNIZED (see
 * viz-annotated-unit.test.ts) so the chart keeps its type and full panel editing.
 */
import { describe, it, expect } from 'vitest';
import { addReferenceLine, getReferenceLines, setReferenceLineColor, removeReferenceLine } from '../encoding-edit';
import { renderEnvelopeToSvg } from '../render-vega';
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

describe('addReferenceLine', () => {
  it('wraps a unit spec into layers: base chart + rule + badge (backing + tint + text)', () => {
    const next = addReferenceLine(LINE(), { axis: 'y', value: 500000, label: 'Target', color: '#e74c3c' });
    const spec = specOf(next);
    expect(spec.mark).toBeUndefined();            // no longer a unit spec
    expect(spec.layer).toHaveLength(5);           // base + rule + backing + tint + text
    expect(spec.layer[0].mark.type).toBe('line'); // base chart first, unchanged
    expect(spec.layer[0].encoding.y.field).toBe('revenue');
    const rule = spec.layer[1];
    expect(rule.mark.type).toBe('rule');
    expect(rule.mark.color).toBe('#e74c3c');
    expect(rule.encoding.y.datum).toBe(500000);
    // Annotation layers inherit the FULL dataset — without sample(1) each draws once
    // PER ROW (100 rows stacked a 0.16-opacity plate into a solid block).
    for (const i of [1, 2, 3, 4]) expect(spec.layer[i].transform).toEqual([{ sample: 1 }]);
    // The label is a BADGE: an OPAQUE surface backing (theme style, mode-aware fill)
    // under a tinted plate, behind colored text (house chip style).
    const backing = spec.layer[2];
    expect(backing.mark.type).toBe('rect');
    expect(backing.mark.style).toBe('mx-annotation-plate'); // fill comes from the theme
    expect(backing.mark.fill).toBeUndefined();
    const plate = spec.layer[3];
    expect(plate.mark.type).toBe('rect');
    expect(plate.mark.fill).toBe('#e74c3c');
    expect(plate.mark.fillOpacity).toBeLessThan(0.5);
    expect(plate.mark.cornerRadius).toBeGreaterThan(0);
    const text = spec.layer[4];
    expect(text.mark.type).toBe('text');
    expect(text.mark.color).toBe('#e74c3c');
    expect(text.encoding.text.value).toBe('Target');
    expect(text.encoding.y.datum).toBe(500000);
  });

  it('no label → rule layer only', () => {
    const next = addReferenceLine(LINE(), { axis: 'y', value: 100 });
    expect(specOf(next).layer).toHaveLength(2);
  });

  it('keeps a unit spec transform inside the BASE layer when wrapping (folds stay unit-scoped)', () => {
    const folded = envelope({
      mark: { type: 'line' },
      transform: [{ fold: ['a', 'b'], as: ['__mx_key', '__mx_value'] }],
      encoding: {
        x: { field: 'week', type: 'temporal' },
        y: { field: '__mx_value', type: 'quantitative' },
        color: { field: '__mx_key', type: 'nominal' },
      },
    });
    const next = addReferenceLine(folded, { axis: 'y', value: 5 });
    const spec = specOf(next);
    expect(spec.transform).toBeUndefined();
    expect(spec.layer[0].transform).toHaveLength(1);
  });

  it('appends to an ALREADY-layered spec (a second line)', () => {
    const one = addReferenceLine(LINE(), { axis: 'y', value: 100, label: 'Floor' });
    const two = addReferenceLine(one, { axis: 'y', value: 900, label: 'Ceiling' });
    expect(specOf(two).layer).toHaveLength(9); // base + 2×(rule+backing+tint+text)
  });

  it('an X line on a temporal axis converts the value to a VL DateTime datum', () => {
    const next = addReferenceLine(LINE(), { axis: 'x', value: '2025-03-01', label: 'Launch' });
    const rule = specOf(next).layer[1];
    expect(rule.encoding.x.datum).toEqual({ year: 2025, month: 3, date: 1 });
  });

  it('no-op on non-vega-lite sources', () => {
    const recipe = { version: 2, source: { kind: 'recipe', recipe: 'minusx/funnel@1', bindings: {} } } as unknown as VizEnvelope;
    expect(addReferenceLine(recipe, { axis: 'y', value: 1 })).toBe(recipe);
  });

  it('renders headlessly: rule, plates, and label land in the SVG', async () => {
    const next = addReferenceLine(LINE(), { axis: 'y', value: 15, label: 'Target' });
    const svg = await renderEnvelopeToSvg(next, [
      { week: '2025-01-06', revenue: 10 },
      { week: '2025-01-13', revenue: 20 },
    ], 'dark', { width: 400, height: 300 });
    expect(svg).toContain('mark-rule');
    expect(svg).toContain('mark-rect'); // the badge plates
    expect(svg).toContain('Target');
    expect(svg).toContain('mark-line'); // base chart intact
    // The BACKING plate resolves to the mode's OPAQUE surface color at render (the
    // saved spec stays mode-free — the fill is injected by compileVegaLite).
    expect(svg.toLowerCase()).toContain('#161b22'); // DARK_THEME.bgSurface
  });
});

describe('reference-line management', () => {
  const twoLines = () => addReferenceLine(
    addReferenceLine(LINE(), { axis: 'y', value: 100, label: 'Floor', color: '#16a085' }),
    { axis: 'x', value: '2025-03-01', label: 'Launch' },
  );

  it('getReferenceLines lists each line with axis, value, label, color', () => {
    const lines = getReferenceLines(twoLines());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ axis: 'y', value: 100, label: 'Floor', color: '#16a085' });
    expect(lines[1].axis).toBe('x');
    expect(lines[1].label).toBe('Launch');
    expect(String(lines[1].value)).toBe('2025-03-01'); // DateTime datum reads back displayable
  });

  it('setReferenceLineColor recolors rule, tint plate, and text — NOT the surface backing', () => {
    const env = twoLines();
    const [first] = getReferenceLines(env);
    const next = setReferenceLineColor(env, first.index, '#0000ff');
    const spec = specOf(next);
    expect(spec.layer[first.index].mark.color).toBe('#0000ff');       // rule
    expect(spec.layer[first.index + 1].mark.fill).toBeUndefined();    // backing keeps its theme fill
    expect(spec.layer[first.index + 2].mark.fill).toBe('#0000ff');    // tint plate
    expect(spec.layer[first.index + 3].mark.color).toBe('#0000ff');   // text
    expect(getReferenceLines(next)[0].color).toBe('#0000ff');
  });

  it('removeReferenceLine removes one line (rule + badge)', () => {
    const env = twoLines();
    const lines = getReferenceLines(env);
    const next = removeReferenceLine(env, lines[1].index);
    expect(getReferenceLines(next)).toHaveLength(1);
    expect(getReferenceLines(next)[0].label).toBe('Floor');
  });

  it('removing the LAST line unwraps back to a plain unit spec', () => {
    const one = addReferenceLine(LINE(), { axis: 'y', value: 100, label: 'Floor' });
    const [line] = getReferenceLines(one);
    const next = removeReferenceLine(one, line.index);
    const spec = specOf(next);
    expect(spec.layer).toBeUndefined();
    expect(spec.mark.type).toBe('line'); // the original unit spec again
    expect(spec.encoding.y.field).toBe('revenue');
  });
});
