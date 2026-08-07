/**
 * Shared-tooltip guide-line injection.
 *
 * Bounds invariant: the guide `rule` must read its height from the rest-at-zero
 * `mxGuideH` signal, never from the fit-solved `height` signal — a hidden rule spanning
 * the plot must contribute ZERO bounds to the `autosize: fit` solve. It only grows to
 * the plot height on hover, when the layout is settled (VegaChart drives the signal).
 * (The silent-blank-chart bug this was once suspected of causing turned out to be the
 * tooltip-suppression ordering in VegaChart — covered by vega-chart-render.ui.test.tsx.)
 */
import { describe, it, expect } from 'vitest';
import { injectGuideMark, GUIDE_WIDTH, GUIDE_OPACITY } from '../guide-mark';
import { compileVegaLite, createVegaView } from '../render-vega';

const compiledBar = () => ({
  marks: [{ type: 'rect', from: { data: 'main' }, encode: {} }],
  signals: [{ name: 'width', value: 400 }, { name: 'height', value: 300 }],
});

describe('injectGuideMark', () => {
  it('prepends the guide rule behind the data marks', () => {
    const spec = compiledBar();
    expect(injectGuideMark(spec)).toBe(true);
    expect(spec.marks[0].type).toBe('rule'); // unshifted → renders first → behind data
    expect(spec.marks[1].type).toBe('rect');
  });

  it('declares the mxGuidePx / mxGuideOn / mxGuideH signals', () => {
    const spec = compiledBar();
    injectGuideMark(spec);
    const names = spec.signals.map((s: { name: string }) => s.name);
    expect(names).toContain('mxGuidePx');
    expect(names).toContain('mxGuideOn');
    expect(names).toContain('mxGuideH');
  });

  it('declares mxGuideW / mxGuideOpacity signals resting at the thin-line defaults', () => {
    const spec = compiledBar();
    injectGuideMark(spec);
    const w = spec.signals.find((s: { name: string }) => s.name === 'mxGuideW') as { value: number };
    const op = spec.signals.find((s: { name: string }) => s.name === 'mxGuideOpacity') as { value: number };
    // Rests at the thin-line width/opacity; VegaChart widens it to the band on hover for bars.
    expect(w.value).toBe(GUIDE_WIDTH);
    expect(op.value).toBe(GUIDE_OPACITY);
  });

  it('drives the rule width + opacity from the signals (so the guide can grow to a band)', () => {
    const spec = compiledBar();
    injectGuideMark(spec);
    const rule = spec.marks[0] as unknown as {
      encode: { update: { strokeWidth: { signal: string }; opacity: { signal: string } } };
    };
    expect(rule.encode.update.strokeWidth.signal).toBe('mxGuideW');
    expect(rule.encode.update.opacity.signal).toBe('mxGuideOn * mxGuideOpacity');
  });

  it('rests mxGuideH at 0 so the guide adds no bounds to the autosize:fit solve', () => {
    const spec = compiledBar();
    injectGuideMark(spec);
    const guideH = spec.signals.find((s: { name: string }) => s.name === 'mxGuideH') as { value: number };
    expect(guideH.value).toBe(0);
  });

  it('the guide height references mxGuideH and NEVER the fit-solved `height` signal', () => {
    const spec = compiledBar();
    injectGuideMark(spec);
    const rule = spec.marks[0] as unknown as { encode: { update: { y2: { signal: string } } } };
    // `height` is the fit-solved signal — referencing it would feed the hidden guide's
    // full-plot bounds into the autosize solve.
    expect(rule.encode.update.y2.signal).toBe('mxGuideH');
    expect(rule.encode.update.y2.signal).not.toBe('height');
  });

  it('is a no-op for empty/rootless compiled specs (nothing to unshift into)', () => {
    expect(injectGuideMark({ marks: [] })).toBe(false);
    expect(injectGuideMark({})).toBe(false);
  });

  it('injects a clipped rule into every repeated facet cell and gates it by facet datum', () => {
    const spec = {
      signals: [{ name: 'child_height', value: 200 }],
      marks: [
        { name: 'column_header', type: 'group' },
        {
          name: 'cell',
          type: 'group',
          from: { facet: { data: 'main', groupby: ['tag_valence'] } },
          marks: [{ name: 'child_marks', type: 'area' }],
        },
      ],
    };

    expect(injectGuideMark(spec, { facetFields: ['tag_valence'] })).toBe(true);
    const facetSignal = spec.signals.find((signal: { name: string }) => signal.name === 'mxGuideFacet') as { value: unknown };
    expect(facetSignal.value).toBeNull();
    const cell = spec.marks.find(mark => mark.name === 'cell') as unknown as {
      marks: Array<{
        type: string;
        clip?: boolean;
        encode?: { update: { opacity: { signal: string } } };
      }>;
    };
    expect(cell.marks[0].type).toBe('rule');
    expect(cell.marks[1].type).toBe('area');
    expect(cell.marks[0].clip).toBe(true);
    expect(cell.marks[0].encode?.update.opacity.signal).toContain('parent["tag_valence"] === mxGuideFacet["tag_valence"]');
    // The rule belongs to each child plot, never the root/header mark list.
    expect(spec.marks[0].name).toBe('column_header');
  });

  it('renders the facet guide only in the selected compiled cell', async () => {
    const vlSpec = {
      facet: { column: { field: 'tag_valence', type: 'nominal' } },
      spec: {
        mark: { type: 'area' },
        encoding: {
          x: { field: 'quarter_start', type: 'temporal' },
          y: { field: 'tag_assignments', type: 'quantitative' },
          color: { field: 'tag', type: 'nominal' },
        },
      },
    } as Record<string, unknown>;
    const rows = [
      { tag_valence: 'Positive', quarter_start: '2025-01-01', tag: 'praise', tag_assignments: 10 },
      { tag_valence: 'Negative', quarter_start: '2025-01-01', tag: 'criticism', tag_assignments: 8 },
    ];
    const facetLayout = { columns: 2, rows: 1, childWidth: 300, childHeight: 200 };
    const vegaSpec = compileVegaLite(vlSpec, 'light', { facetLayout });
    injectGuideMark(vegaSpec as unknown as Record<string, unknown>, { facetFields: ['tag_valence'] });
    const view = createVegaView(vegaSpec, rows, {
      renderer: 'none', width: 640, height: 260, facetLayout,
    });
    try {
      view
        .signal('mxGuideOn', 1)
        .signal('mxGuidePx', 100)
        .signal('mxGuideH', 200)
        .signal('mxGuideFacet', { tag_valence: 'Positive' });
      await view.runAsync();
      const items: Array<{ opacity?: number; mark?: { group?: { datum?: { tag_valence?: string } } } }> = [];
      const visit = (candidate: unknown): void => {
        if (!candidate || typeof candidate !== 'object') return;
        const item = candidate as { opacity?: number; mark?: { name?: string; group?: { datum?: { tag_valence?: string } } }; items?: unknown[] };
        if (item.mark?.name === 'mx_guide') items.push(item);
        item.items?.forEach(visit);
      };
      visit((view.scenegraph() as unknown as { root: unknown }).root);
      expect(items).toHaveLength(2);
      expect(items.find(item => item.mark?.group?.datum?.tag_valence === 'Positive')?.opacity).toBe(GUIDE_OPACITY);
      expect(items.find(item => item.mark?.group?.datum?.tag_valence === 'Negative')?.opacity).toBe(0);
    } finally {
      view.finalize();
    }
  });
});
