/**
 * VIZ_CAPABILITIES — the single source of truth for what each visualization type exposes:
 * which renderer draws it, which drop zones it uses, which human-UI settings panels apply,
 * which style levers are honored, and which escape hatch it supports
 * (`echartsOverrides` for canvas charts, `cssOverrides` for DOM/Leaflet renderers).
 *
 * Consumers:
 *  - AxisBuilder / VizConfigPanel — panel visibility (replaces the old private CHART_SETTINGS map)
 *  - viz-prompt-vars — the live-generated capabilities table in the visualizations skill,
 *    so the agent always knows exactly which levers a type honors
 *  - viz-constraints — warnings when a config group / hatch is set on a type that ignores it
 *
 * `Record<VisualizationType, …>` is compile-time exhaustive: adding a viz type won't build
 * until it is registered here.
 */
import type { VisualizationType, VisualizationStyleConfig } from '@/lib/validation/atlas-schemas';

export type VizRenderer = 'echarts' | 'table' | 'pivot' | 'leaflet' | 'dom';

export type StyleConfigKey = keyof VisualizationStyleConfig;

export interface VizCapability {
  renderer: VizRenderer;
  /** Which axis drop zones the type uses (drives UI zones + agent docs). */
  zones: { x: boolean; y: boolean; yRight: boolean; tooltip: boolean };
  /** Human-UI settings-panel visibility (AxisBuilder / viz config). */
  panels: { xAxisSettings: boolean; yAxisSettings: boolean; style: boolean; annotations: boolean; tableStyle: boolean };
  levers: {
    /** Exactly which styleConfig keys this type honors. */
    styleConfig: readonly StyleConfigKey[];
    axisConfig: boolean;
    columnFormats: boolean;
    conditionalFormats: boolean;
    /** The type-specific config group, if any. */
    configGroup: 'pivotConfig' | 'geoConfig' | 'trendConfig' | 'singleValueConfig' | null;
    /** Raw ECharts option fragment hatch — canvas-rendered types only. */
    echartsOverrides: boolean;
    /** Scoped raw-CSS hatch — DOM/Leaflet-rendered types only. */
    cssOverrides: boolean;
  };
  /** Stable selector hooks the cssOverrides hatch can target ('selector — what it is'). */
  cssHooks: readonly string[];
  /** One-line constraint/behavior note surfaced in the agent prompt. */
  notes: string;
}

const ECHARTS_STYLE_BASE = [
  'colors', 'opacity', 'showDataLabels', 'dataLabelColor',
  'background', 'legend', 'textColor', 'titleColor', 'echartsOverrides',
] as const satisfies readonly StyleConfigKey[];

const cartesianZones = { x: true, y: true, yRight: false, tooltip: true };
const noZones = { x: false, y: false, yRight: false, tooltip: false };
const hiddenPanels = { xAxisSettings: false, yAxisSettings: false, style: false, annotations: false, tableStyle: false };

const echartsLevers = (styleConfig: readonly StyleConfigKey[]) => ({
  styleConfig, axisConfig: true, columnFormats: true, conditionalFormats: false,
  configGroup: null, echartsOverrides: true, cssOverrides: false,
} as const);

const TABLE_CSS_HOOKS = [
  'table — the results table element',
  'thead th — header cells',
  'tbody tr — body rows',
  'tbody td — body cells',
] as const;

export const VIZ_CAPABILITIES: Record<VisualizationType, VizCapability> = {
  line: {
    renderer: 'echarts',
    zones: cartesianZones,
    panels: { xAxisSettings: false, yAxisSettings: true, style: true, annotations: true, tableStyle: false },
    levers: echartsLevers([...ECHARTS_STYLE_BASE, 'markerSize', 'smooth']),
    cssHooks: [],
    notes: 'Dual axis via axisConfig.dualAxis + yRightCols. Annotations supported with exactly one x column.',
  },
  bar: {
    renderer: 'echarts',
    zones: cartesianZones,
    panels: { xAxisSettings: false, yAxisSettings: true, style: true, annotations: true, tableStyle: false },
    levers: echartsLevers([...ECHARTS_STYLE_BASE, 'stacked']),
    cssHooks: [],
    notes: 'Stacked by default (styleConfig.stacked=false to separate). Annotations supported with exactly one x column.',
  },
  row: {
    renderer: 'echarts',
    zones: cartesianZones,
    panels: { xAxisSettings: false, yAxisSettings: true, style: true, annotations: false, tableStyle: false },
    levers: echartsLevers([...ECHARTS_STYLE_BASE, 'stacked']),
    cssHooks: [],
    notes: 'Horizontal bar; long category labels are truncated automatically.',
  },
  area: {
    renderer: 'echarts',
    zones: cartesianZones,
    panels: { xAxisSettings: false, yAxisSettings: true, style: true, annotations: true, tableStyle: false },
    levers: echartsLevers([...ECHARTS_STYLE_BASE, 'stacked', 'smooth']),
    cssHooks: [],
    notes: 'Stacked by default; opacity scales the area fill.',
  },
  scatter: {
    renderer: 'echarts',
    zones: cartesianZones,
    panels: { xAxisSettings: true, yAxisSettings: true, style: true, annotations: true, tableStyle: false },
    levers: echartsLevers([...ECHARTS_STYLE_BASE, 'markerSize']),
    cssHooks: [],
    notes: 'Only type with X-axis scale settings; tooltipCols adds extra tooltip rows.',
  },
  combo: {
    renderer: 'echarts',
    zones: { ...cartesianZones, yRight: true },
    panels: { xAxisSettings: false, yAxisSettings: true, style: true, annotations: false, tableStyle: false },
    levers: echartsLevers([...ECHARTS_STYLE_BASE, 'stacked', 'markerSize', 'smooth']),
    cssHooks: [],
    notes: 'Bars (yCols) + lines (yRightCols) with axisConfig.dualAxis. No seriesTypes field exists.',
  },
  pie: {
    renderer: 'echarts',
    zones: noZones,
    panels: { xAxisSettings: false, yAxisSettings: false, style: true, annotations: false, tableStyle: false },
    levers: echartsLevers(ECHARTS_STYLE_BASE),
    cssHooks: [],
    notes: 'Two x columns render a nested double ring.',
  },
  funnel: {
    renderer: 'echarts',
    zones: noZones,
    panels: { xAxisSettings: false, yAxisSettings: false, style: true, annotations: false, tableStyle: false },
    levers: echartsLevers(ECHARTS_STYLE_BASE),
    cssHooks: [],
    notes: 'Single-hue fade with inside labels; legend hidden by default (styleConfig.legend.show=true to force).',
  },
  waterfall: {
    renderer: 'echarts',
    zones: cartesianZones,
    panels: { xAxisSettings: false, yAxisSettings: true, style: true, annotations: false, tableStyle: false },
    levers: echartsLevers(ECHARTS_STYLE_BASE),
    cssHooks: [],
    notes: 'Increase = palette[0], total = palette[1], decrease = red; legend hidden by default.',
  },
  radar: {
    renderer: 'echarts',
    zones: noZones,
    panels: { xAxisSettings: false, yAxisSettings: false, style: true, annotations: false, tableStyle: false },
    levers: echartsLevers(ECHARTS_STYLE_BASE),
    cssHooks: [],
    notes: 'Polygon radar over category axes.',
  },
  table: {
    renderer: 'table',
    zones: noZones,
    panels: { ...hiddenPanels, tableStyle: true },
    levers: {
      styleConfig: ['table', 'cssOverrides'], axisConfig: false, columnFormats: true,
      conditionalFormats: true, configGroup: null, echartsOverrides: false, cssOverrides: true,
    },
    cssHooks: TABLE_CSS_HOOKS,
    notes: 'Raw results table. styleConfig.table for header/striping/borders; conditionalFormats paints cells/rows/columns.',
  },
  pivot: {
    renderer: 'pivot',
    zones: noZones,
    panels: { ...hiddenPanels, tableStyle: true },
    levers: {
      styleConfig: ['table', 'cssOverrides'], axisConfig: false, columnFormats: true,
      conditionalFormats: false, configGroup: 'pivotConfig', echartsOverrides: false, cssOverrides: true,
    },
    cssHooks: [...TABLE_CSS_HOOKS, 'tbody th — row-dimension header cells'],
    notes: 'Cross-tab via pivotConfig (rows/columns/values, heatmap, totals). Heatmap colors win over striping.',
  },
  trend: {
    renderer: 'dom',
    zones: { x: true, y: true, yRight: false, tooltip: false },
    panels: hiddenPanels,
    levers: {
      styleConfig: ['cssOverrides'], axisConfig: false, columnFormats: true,
      conditionalFormats: false, configGroup: 'trendConfig', echartsOverrides: false, cssOverrides: true,
    },
    cssHooks: ['.mx-trend-value — the current-period number', '.mx-trend-delta — the change badge', '.mx-trend-label — the comparison caption'],
    notes: 'Requires a date/time column on X. Compare mode via trendConfig.',
  },
  single_value: {
    renderer: 'dom',
    zones: { x: false, y: true, yRight: false, tooltip: false },
    panels: hiddenPanels,
    levers: {
      styleConfig: ['cssOverrides'], axisConfig: false, columnFormats: true,
      conditionalFormats: false, configGroup: 'singleValueConfig', echartsOverrides: false, cssOverrides: true,
    },
    cssHooks: ['.mx-sv-value — the big number', '.mx-sv-label — the label under it'],
    notes: 'Big live number; singleValueConfig IS the styling (size/color/weight/prefix/suffix/align).',
  },
  geo: {
    renderer: 'leaflet',
    zones: noZones,
    panels: hiddenPanels,
    levers: {
      styleConfig: ['cssOverrides'], axisConfig: false, columnFormats: false,
      conditionalFormats: false, configGroup: 'geoConfig', echartsOverrides: false, cssOverrides: true,
    },
    cssHooks: ['.leaflet-container — the map viewport (background, filters)'],
    notes: 'Leaflet map driven entirely by geoConfig (subType, colorScale, tiles).',
  },
};
