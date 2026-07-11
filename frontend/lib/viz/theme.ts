/**
 * MinusX Vega-Lite theme configs (RFC §7, Mechanism A).
 *
 * One token source generates the light and dark VL `config` objects. Tokens are
 * sourced from the existing chart constants (lib/chart/echarts-theme.ts palette +
 * JetBrains Mono) so the two chart stacks cannot drift during migration.
 * Passed as external compiler config — spec-internal `config` wins natively.
 */
import type { Config as VegaLiteConfig } from 'vega-lite';
import { COLOR_PALETTE, LIGHT_THEME, DARK_THEME } from '@/lib/chart/echarts-theme';

const FONT = 'JetBrains Mono, Consolas, Monaco, Courier New, monospace';

export function getVegaLiteConfig(mode: 'light' | 'dark'): VegaLiteConfig {
  const colors = mode === 'light' ? LIGHT_THEME : DARK_THEME;
  return {
    font: FONT,
    // The card owns the surface; charts inherit it (same rule as the ECharts theme).
    background: 'transparent',
    range: { category: COLOR_PALETTE },
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
    },
    legend: {
      labelColor: colors.fgMuted,
      titleColor: colors.fgDefault,
      labelFontSize: 11,
      titleFontSize: 12,
      titleLimit: 240,
      labelLimit: 220,
    },
    title: {
      color: colors.fgDefault,
      fontSize: 14,
      fontWeight: 'normal',
      anchor: 'start',
    },
    view: { stroke: 'transparent' },
    // Sensible mark defaults; spec-level mark properties win natively.
    line: { strokeWidth: 2 },
    point: { filled: true, size: 60 },
    bar: { cornerRadiusEnd: 2 },
  };
}
