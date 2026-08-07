import { describe, expect, it } from 'vitest';
import { findFacetCellAtPoint } from '../facet-tooltip';
import { compileVegaLite, computeFacetLayoutPlan, createVegaView } from '../render-vega';

const scenegraph = {
  items: [{
    items: [
      {
        mark: { name: 'cell', role: 'scope' },
        datum: { tag_valence: 'Positive' },
        bounds: { x1: -1, y1: -1, x2: 405, y2: 191 },
        items: [{ mark: { name: 'marks' }, bounds: { x1: 0, y1: 0, x2: 405, y2: 190 } }],
      },
      {
        mark: { name: 'cell', role: 'scope' },
        datum: { tag_valence: 'Negative' },
        bounds: { x1: 425, y1: -1, x2: 831, y2: 191 },
      },
    ],
  }],
};

describe('findFacetCellAtPoint', () => {
  it('returns the facet panel under the root-relative pointer', () => {
    expect(findFacetCellAtPoint(scenegraph, 100, 80, ['tag_valence'])).toEqual({
      x1: -1,
      y1: -1,
      x2: 405,
      y2: 191,
      datum: { tag_valence: 'Positive' },
    });
    expect(findFacetCellAtPoint(scenegraph, 600, 80, ['tag_valence'])?.datum).toEqual({ tag_valence: 'Negative' });
  });

  it('returns null between panels or when a scope lacks the requested facet field', () => {
    expect(findFacetCellAtPoint(scenegraph, 415, 80, ['tag_valence'])).toBeNull();
    expect(findFacetCellAtPoint(scenegraph, 100, 80, ['missing'])).toBeNull();
  });

  it('finds real Vega-Lite facet cells after compilation', async () => {
    const spec = {
      facet: { column: { field: 'tag_valence', type: 'nominal' } },
      spec: {
        mark: { type: 'area' },
        encoding: {
          x: { field: 'quarter_start', type: 'temporal' },
          y: { field: 'tag_assignments', type: 'quantitative', stack: 'zero' },
          color: { field: 'tag', type: 'nominal' },
        },
      },
    } as Record<string, unknown>;
    const rows = [
      { tag_valence: 'Positive', quarter_start: '2025-01-01', tag: 'praise', tag_assignments: 10 },
      { tag_valence: 'Negative', quarter_start: '2025-01-01', tag: 'criticism', tag_assignments: 8 },
    ];
    const facetLayout = computeFacetLayoutPlan(spec, rows, 600, 260)!;
    const view = createVegaView(compileVegaLite(spec, 'light', { facetLayout }), rows, {
      renderer: 'none', width: 600, height: 260, facetLayout,
    });
    try {
      await view.runAsync();
      const root = (view.scenegraph() as unknown as { root: unknown }).root;
      expect(findFacetCellAtPoint(root, 10, 10, ['tag_valence'])?.datum.tag_valence).toBe('Negative');
      expect(
        findFacetCellAtPoint(root, facetLayout.childWidth! + 25, 10, ['tag_valence'])?.datum.tag_valence,
      ).toBe('Positive');
    } finally {
      view.finalize();
    }
  });
});
