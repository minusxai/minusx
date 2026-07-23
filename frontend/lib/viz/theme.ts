/**
 * MinusX Vega-Lite theme configs (RFC §7, Mechanism A).
 *
 * One token source generates the light and dark VL `config` objects. Tokens are
 * sourced from the existing chart constants (lib/chart/chart-theme.ts palette +
 * JetBrains Mono) so the two chart stacks cannot drift during migration.
 * Passed as external compiler config — spec-internal `config` wins natively.
 */
import type { Config as VegaLiteConfig } from 'vega-lite';
import { COLOR_PALETTE, LIGHT_THEME, DARK_THEME, getChartFontFamily } from '@/lib/chart/chart-theme';

/**
 * The card-surface color per mode. Used by render-time enrichments that need an OPAQUE
 * surface-colored fill (the reference-line badge backing) — VL bakes mark fills at
 * compile, so named style configs can't supply this; the renderer resolves it instead.
 */
export function getSurfaceColor(mode: 'light' | 'dark'): string {
  return (mode === 'light' ? LIGHT_THEME : DARK_THEME).bgSurface;
}

export function getVegaLiteConfig(mode: 'light' | 'dark'): VegaLiteConfig {
  const colors = mode === 'light' ? LIGHT_THEME : DARK_THEME;
  return {
    // getChartFontFamily resolves the ACTUAL loaded font family (next/font registers
    // JetBrains Mono under a hashed name, exposed via --font-jetbrains-mono). Using the
    // literal name makes canvas measureText and SVG rendering fall back to DIFFERENT
    // fonts — vega then under-reserves every label and titles overlap ticks.
    font: getChartFontFamily(),
    // Default number format for quantitative axis/legend/tooltip labels without an
    // explicit format: SI units ('.3~s' → 20k, 1.5M, 431k). Specs override per-encoding.
    numberFormat: '.3~s',
    // The card owns the surface; charts inherit it (same rule as the ECharts theme).
    background: 'transparent',
    range: {
      category: COLOR_PALETTE,
      // Quantitative colour on rect marks (heatmaps) pulls from `heatmap`: the
      // GitHub contribution-graph greens, per mode. Lives HERE (like the house
      // donut) so a bare `mark: rect` + quantitative color — what agents and the
      // UI transform both produce — gets the look; a spec-level `scale.scheme`
      // or `scale.range` opts out.
      // Dark low end is #21262d (GitHub's border gray), NOT GitHub's #161b22
      // empty-cell colour — that's identical to our dark card surface, and a
      // lowest-value cell must still read as a cell, not a hole.
      heatmap: mode === 'light'
        ? ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
        : ['#21262d', '#0e4429', '#006d32', '#26a641', '#39d353'],
    },
    axis: {
      labelColor: colors.fgMuted,
      titleColor: colors.fgDefault,
      gridColor: colors.borderMuted,
      domainColor: colors.borderDefault,
      tickColor: colors.borderDefault,
      labelFontSize: 11,
      titleFontSize: 12,
      titleFontWeight: 'normal',
      gridDash: [3, 3],
      // JetBrains Mono runs wider than the fonts VL's default spacing assumes:
      // give titles room from the tick labels and keep thinned labels apart.
      titlePadding: 12,
      labelSeparation: 4,
      // Discrete (band/point) scales don't thin overlapping labels by default —
      // a 100-value ordinal axis (weekly heatmap columns) renders as a smear.
      labelOverlap: true,
    },
    legend: {
      orient: 'top',
      labelColor: colors.fgMuted,
      labelFontSize: 11,
      labelLimit: 220,
    },
    // Automatic tooltips everywhere: hovering any mark shows its encoded fields
    // (with their titles/formats). A spec-level `tooltip` encoding overrides this
    // with a custom field list; `mark: {tooltip: null}` opts a spec out.
    mark: { tooltip: { content: 'encoding' } },
    // Text marks default to BLACK in vega-lite — unreadable in dark mode. Theme them
    // like axis titles; specs/recipes override per-layer where they need contrast.
    text: { color: colors.fgDefault, fontSize: 11 },
    title: {
      color: colors.fgDefault,
      fontSize: 14,
      fontWeight: 'normal',
      anchor: 'start',
    },
    view: { stroke: 'transparent' },
    // Sensible mark defaults; spec-level mark properties win natively.
    // Small filled dots on every line point (house default). Kept intentionally small so
    // dense time-series stay legible; a spec can opt out with `mark: {point: false}`.
    line: { strokeWidth: 2, point: { filled: true, size: 25 } },
    point: { filled: true, size: 60 },
    bar: { cornerRadiusEnd: 2 },
    // Choropleth / analytic-geo regions (RFC §9): a bare `mark: geoshape` — the
    // background outline layer of every map recipe — draws NO fill (a neutral fill
    // washed the map out on the card and read as a solid block) and a clearly visible
    // inter-region border, so no-data regions read as clean outlines. The choropleth
    // layer's color encoding supplies the fill for regions that DO have data; the
    // border stroke travels to it too.
    geoshape: { fill: 'transparent', stroke: colors.fgSubtle, strokeWidth: 0.75 },
    // House heatmap cells = the GitHub contribution graph: rounded cells with a
    // CONSTANT pixel gap. The gap is a full-band rect stroked in the card surface
    // colour — a relative band gap scales with cell size and looks cavernous on
    // small cross-tabs (2×3 → giant cells → giant gaps).
    rect: { cornerRadius: 5, stroke: colors.bgSurface, strokeWidth: 4 },
    // House pie = responsive donut with rounded, slightly separated sectors (matches
    // the classic ECharts pie). Lives HERE so a bare `mark: arc` — what agents and
    // the UI transform both produce — gets the look; `innerRadius: 0` in a spec
    // opts out to a solid pie.
    arc: {
      innerRadius: { expr: 'min(width,height)/2 * 0.45' },
      cornerRadius: 6,
      padAngle: 0.015,
    },
    // Boxplot sub-marks: whiskers are `rule` marks and VL defaults them (and the
    // outlier points) to BLACK — invisible on the dark card. Mode-aware foregrounds;
    // the median tick uses the strong foreground so it reads against the
    // series-coloured box fill in both modes. Spec-level boxplot config wins natively.
    boxplot: {
      rule: { color: colors.fgMuted, strokeWidth: 1.5 },
      median: { color: colors.fgDefault },
      outliers: { color: colors.fgMuted },
    },
  };
}

/**
 * Parser config for NATIVE Vega specs (the `vega` engine — e.g. minusx/radar@1).
 * Same token source as the VL config so the tiers can't drift (RFC §7). Applied at
 * vega.parse; spec-level properties win natively.
 */
export function getVegaParserConfig(mode: 'light' | 'dark'): Record<string, unknown> {
  const colors = mode === 'light' ? LIGHT_THEME : DARK_THEME;
  const font = getChartFontFamily();
  return {
    background: 'transparent',
    range: { category: COLOR_PALETTE },
    text: { fill: colors.fgDefault, font, fontSize: 11 },
    style: {
      'mx-trend-focus': { fill: colors.bgSurface },
    },
    legend: {
      orient: 'top',
      layout: { top: { anchor: 'middle' } },
      labelColor: colors.fgMuted,
      labelFont: font,
      labelFontSize: 11,
    },
    title: { color: colors.fgDefault, font, fontSize: 14 },
  };
}
