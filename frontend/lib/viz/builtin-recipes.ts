/**
 * Built-in default viz recipes: the base layer of the file-recipe resolution
 * order. These are DATA in the same inert-template language as workspace `.viz`
 * files (lib/viz/recipe-file.ts) — not code like the shipped registry in
 * viz-templates.ts — so a workspace file with the same name shadows one, and
 * everything downstream (materialization, panel binding, advertisement) treats them
 * identically to files. Keys are recipe NAMES (the basename a file would have).
 *
 * Every entry must materialize with dummy bindings and pass the envelope
 * validator — pinned by lib/viz/__tests__/viz-recipe-resolve.test.ts.
 */
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';

export const BUILTIN_VIZ_RECIPES: Record<string, VizRecipeContent> = {
  // Value bars with a target tick per category — the classic KPI-vs-goal chart.
  bullet: {
    description: 'Bullet chart: value bars with a target tick per category (value vs goal)',
    engine: 'vega-lite',
    bindings: [
      { name: 'category', label: 'Category', accepts: ['nominal', 'temporal'] },
      { name: 'value', label: 'Value', accepts: ['quantitative'] },
      { name: 'target', label: 'Target', accepts: ['quantitative'] },
    ],
    params: [{ name: 'tickColor', label: 'Target color', default: '#e11d48' }],
    template: {
      layer: [
        {
          mark: { type: 'bar', height: { band: 0.6 } },
          encoding: {
            x: { field: '{{value}}', type: 'quantitative', title: null },
            y: { field: '{{category}}', type: '{{category:kind}}', title: null },
          },
        },
        {
          mark: { type: 'tick', color: '{{tickColor}}', thickness: 2, size: 24 },
          encoding: {
            x: { field: '{{target}}', type: 'quantitative' },
            y: { field: '{{category}}', type: '{{category:kind}}' },
            tooltip: [
              { field: '{{category}}', type: '{{category:kind}}' },
              { field: '{{value}}', type: 'quantitative' },
              { field: '{{target}}', type: 'quantitative' },
            ],
          },
        },
      ],
    },
  },

  // A thin stem with a dot — a bar chart that de-emphasizes mass, good for ranks.
  lollipop: {
    description: 'Lollipop chart: thin stems with end dots — a lighter bar chart for rankings',
    engine: 'vega-lite',
    bindings: [
      { name: 'category', label: 'Category', accepts: ['nominal', 'temporal'] },
      { name: 'value', label: 'Value', accepts: ['quantitative'] },
    ],
    params: [{ name: 'dotSize', label: 'Dot size', default: 100 }],
    template: {
      layer: [
        {
          mark: { type: 'rule' },
          encoding: {
            y: { field: '{{category}}', type: '{{category:kind}}', title: null, sort: '-x' },
            x: { field: '{{value}}', type: 'quantitative', title: null },
          },
        },
        {
          mark: { type: 'circle', size: '{{dotSize}}', opacity: 1 },
          encoding: {
            y: { field: '{{category}}', type: '{{category:kind}}', sort: '-x' },
            x: { field: '{{value}}', type: 'quantitative' },
            tooltip: [
              { field: '{{category}}', type: '{{category:kind}}' },
              { field: '{{value}}', type: 'quantitative' },
            ],
          },
        },
      ],
    },
  },

  // A bar spanning start→end per category — durations, ranges, before/after spans.
  'range-bar': {
    description: 'Range bar: a bar spanning start to end per category (durations, min–max ranges)',
    engine: 'vega-lite',
    bindings: [
      { name: 'category', label: 'Category', accepts: ['nominal', 'temporal'] },
      { name: 'start', label: 'Start', accepts: ['quantitative', 'temporal'] },
      { name: 'end', label: 'End', accepts: ['quantitative', 'temporal'] },
    ],
    template: {
      mark: { type: 'bar', height: { band: 0.6 } },
      encoding: {
        y: { field: '{{category}}', type: '{{category:kind}}', title: null },
        x: { field: '{{start}}', type: '{{start:kind}}', title: null },
        x2: { field: '{{end}}' },
        tooltip: [
          { field: '{{category}}', type: '{{category:kind}}' },
          { field: '{{start}}', type: '{{start:kind}}' },
          { field: '{{end}}', type: '{{end:kind}}' },
        ],
      },
    },
  },
};
