/**
 * Facets compile to child_width / child_height signals. The renderer must size
 * those child plots against the outer card; driving only Vega's root width and
 * height leaves every facet at Vega-Lite's 300px default and clips the SVG.
 */
import { describe, expect, it } from 'vitest';
import {
  compileVegaLite,
  computeFacetLayoutPlan,
  createVegaView,
} from '@/lib/viz/render-vega';

const FACET_SPEC = {
  facet: {
    field: 'project_context',
    title: 'Project context',
    type: 'nominal',
  },
  spec: {
    mark: { type: 'area', opacity: 0.8 },
    encoding: {
      x: { field: 'year_start', type: 'temporal', title: 'Year', axis: { format: '%Y' } },
      y: { field: 'post_count', type: 'quantitative', title: 'Posts', stack: 'zero' },
      color: { field: 'artifact_type', type: 'nominal', title: 'Artifact category' },
    },
  },
} as Record<string, unknown>;

const CONTEXTS = ['established_company', 'side_project', 'startup', 'unclear'];
const ARTIFACTS = ['app_or_service', 'content_or_writing', 'dev_tool', 'hardware', 'other', 'project_demo'];
const ROWS = CONTEXTS.flatMap((project_context, contextIndex) =>
  ARTIFACTS.flatMap((artifact_type, artifactIndex) =>
    [2023, 2024, 2025].map((year, yearIndex) => ({
      project_context,
      artifact_type,
      year_start: `${year}-01-01`,
      post_count: (contextIndex + 1) * (artifactIndex + 1) * (yearIndex + 1) * 100,
    })),
  ),
);

const svgSize = (svg: string): { width: number; height: number } => {
  const match = svg.match(/<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/);
  if (!match) throw new Error('SVG has no numeric width/height');
  return { width: Number(match[1]), height: Number(match[2]) };
};

describe('computeFacetLayoutPlan', () => {
  it('divides a flex facet across its distinct values inside the container', () => {
    const plan = computeFacetLayoutPlan(FACET_SPEC, ROWS, 900, 330);
    expect(plan).toMatchObject({ columns: 4, rows: 1 });
    expect(plan!.childWidth).toBeGreaterThan(100);
    expect(plan!.childWidth).toBeLessThan(200);
    expect(plan!.childHeight).toBeGreaterThan(180);
    expect(plan!.childHeight).toBeLessThan(280);
  });

  it('respects authored wrapping and authored child dimensions', () => {
    const spec = {
      ...FACET_SPEC,
      columns: 2,
      spec: { ...(FACET_SPEC.spec as object), width: 240, height: 120 },
    } as Record<string, unknown>;
    expect(computeFacetLayoutPlan(spec, ROWS, 900, 330)).toEqual({
      columns: 2,
      rows: 2,
    });
  });

  it('is not applied to ordinary unit charts', () => {
    expect(computeFacetLayoutPlan({ mark: 'bar', encoding: {} }, ROWS, 900, 330)).toBeNull();
  });
});

describe('facet view sizing', () => {
  it('keeps the screenshot-shaped four-panel facet within the outer bounds', async () => {
    const width = 900;
    const height = 330;
    const facetLayout = computeFacetLayoutPlan(FACET_SPEC, ROWS, width, height);
    const vegaSpec = compileVegaLite(FACET_SPEC, 'light');
    const view = createVegaView(vegaSpec, ROWS, {
      renderer: 'none',
      width,
      height,
      facetLayout,
    });
    try {
      await view.runAsync();
      const size = svgSize(await view.toSVG());
      expect(size.width).toBeLessThanOrEqual(width);
      expect(size.height).toBeLessThanOrEqual(height);
    } finally {
      view.finalize();
    }
  });
});
