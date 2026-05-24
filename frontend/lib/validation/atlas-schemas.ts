/**
 * Atlas file content schemas — the single source of truth for question/dashboard
 * content types and their JSON-Schema validation.
 *
 * Authored in TypeBox: each `export const X = Type.Object(...)` is BOTH a runtime
 * JSON Schema (consumed by `scripts/generate-atlas-schema.ts` → the
 * `atlas-schema*.gen.json` artifacts used by Ajv + the EditFile tool embed) and a
 * static TypeScript type via the colocated `export type X = Static<typeof X>`.
 *
 * This replaces the old Pydantic → `export_schema.py` → `types.gen.ts` pipeline:
 * there is no Python in the loop anymore. To regenerate the JSON artifacts after
 * editing this file: `cd frontend && npm run generate-types`.
 */
import { Type, type Static, type TSchema } from 'typebox';

/** JSON-Schema string enum: `{ type:'string', enum:[...] }` with a literal-union Static type. */
const StringEnum = <const T extends readonly string[]>(values: T, description?: string) =>
  Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...(description ? { description } : {}) });

/** Optional + nullable, matching Pydantic's `Optional[X] = None` → `X | null`. */
const Nullable = <T extends TSchema>(schema: T) => Type.Optional(Type.Union([schema, Type.Null()]));

/** Optional + nullable, carrying a field-level description on the union. */
const NullableD = <T extends TSchema>(schema: T, description: string) =>
  Type.Optional(Type.Union([schema, Type.Null()], { description }));

// ============================================================================
// Visualization Settings
// ============================================================================

const VIZ_TYPES = [
  'table', 'bar', 'line', 'scatter', 'area', 'funnel', 'pie', 'pivot',
  'trend', 'waterfall', 'combo', 'radar', 'geo', 'single_value', 'row',
] as const;
export const VisualizationType = StringEnum(VIZ_TYPES);
export type VisualizationType = Static<typeof VisualizationType>;

// -- Geo configs (discriminated by subType) --
const geoBase = {
  mapName: Nullable(Type.String({ description: "base GeoJSON map: 'world', 'us-states', 'india-states'" })),
  showTiles: Nullable(Type.Boolean({ description: 'toggle OpenStreetMap tile layer' })),
  pinnedCenter: Nullable(Type.Array(Type.Number(), { description: 'pinned map center as [lat, lng]' })),
  pinnedZoom: Nullable(Type.Integer({ description: 'pinned map zoom level' })),
};

export const ChoroplethConfig = Type.Object({
  ...geoBase,
  subType: Type.Literal('choropleth', { description: 'geo visualization sub-type' }),
  regionCol: Nullable(Type.String({ description: 'column matching GeoJSON feature names' })),
  valueCol: Nullable(Type.String({ description: 'numeric value column for fill color' })),
  colorScale: Nullable(Type.String({ description: "color scale: 'green' (default), 'blue', 'red-yellow-green'" })),
}, { title: 'ChoroplethConfig' });
export type ChoroplethConfig = Static<typeof ChoroplethConfig>;

export const PointsConfig = Type.Object({
  ...geoBase,
  subType: Type.Literal('points', { description: 'geo visualization sub-type' }),
  latCol: Nullable(Type.String({ description: 'latitude column' })),
  lngCol: Nullable(Type.String({ description: 'longitude column' })),
  valueCol: Nullable(Type.String({ description: 'numeric value column for bubble sizing (optional)' })),
  colorCol: Nullable(Type.String({ description: 'column for coloring points by value (categorical or numeric)' })),
  colorScale: Nullable(Type.String({ description: "color scale for numeric colorCol: 'green' (default), 'blue', 'red-yellow-green'" })),
  minRadius: Nullable(Type.Integer({ description: 'minimum circle radius in pixels (default 5, range 1-20)' })),
  radiusScale: Nullable(Type.Number({ description: 'radius multiplier (default 1, e.g. 2 = double size)' })),
}, { title: 'PointsConfig' });
export type PointsConfig = Static<typeof PointsConfig>;

export const LinesConfig = Type.Object({
  ...geoBase,
  subType: Type.Literal('lines', { description: 'geo visualization sub-type' }),
  latCol: Nullable(Type.String({ description: 'origin latitude column' })),
  lngCol: Nullable(Type.String({ description: 'origin longitude column' })),
  latCol2: Nullable(Type.String({ description: 'destination latitude column' })),
  lngCol2: Nullable(Type.String({ description: 'destination longitude column' })),
}, { title: 'LinesConfig' });
export type LinesConfig = Static<typeof LinesConfig>;

export const HeatmapConfig = Type.Object({
  ...geoBase,
  subType: Type.Literal('heatmap', { description: 'geo visualization sub-type' }),
  latCol: Nullable(Type.String({ description: 'latitude column' })),
  lngCol: Nullable(Type.String({ description: 'longitude column' })),
  valueCol: Nullable(Type.String({ description: 'numeric intensity column (optional, defaults to 1)' })),
  colorScale: Nullable(Type.String({ description: "color scale: 'green' (default), 'blue', 'red-yellow-green'" })),
}, { title: 'HeatmapConfig' });
export type HeatmapConfig = Static<typeof HeatmapConfig>;

export const GeoConfig = Type.Union([ChoroplethConfig, PointsConfig, LinesConfig, HeatmapConfig]);
export type GeoConfig = Static<typeof GeoConfig>;

export const AggregationFunction = StringEnum(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']);
export type AggregationFunction = Static<typeof AggregationFunction>;

export const FormulaOperator = StringEnum(['+', '-', '*', '/']);
export type FormulaOperator = Static<typeof FormulaOperator>;

export const PivotValueConfig = Type.Object({
  column: Type.String({ description: 'column name for the measure' }),
  aggFunction: Type.Optional(StringEnum(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'], 'aggregation function to apply (SUM, AVG, COUNT, MIN, MAX)')),
}, { title: 'PivotValueConfig' });
export type PivotValueConfig = Static<typeof PivotValueConfig>;

export const PivotFormula = Type.Object({
  name: Type.String({ description: "display label, e.g. 'YoY Change'" }),
  operandA: Type.String({ description: "dimension value, e.g. '2024'" }),
  operandB: Type.String({ description: "dimension value, e.g. '2023'" }),
  operator: StringEnum(['+', '-', '*', '/'], 'arithmetic operator: +, -, *, /'),
  dimensionLevel: Nullable(Type.Integer({ description: 'which dimension level to match (0=top-level, 1=second level, etc.). Defaults to 0.' })),
  parentValues: Nullable(Type.Array(Type.String(), { description: "parent dimension values to scope the formula when dimensionLevel > 0, e.g. ['PnL'] means only match within the PnL group" })),
}, { title: 'PivotFormula' });
export type PivotFormula = Static<typeof PivotFormula>;

export const PivotConfig = Type.Object({
  rows: Type.Array(Type.String(), { description: 'dimension columns for row headers' }),
  columns: Type.Array(Type.String(), { description: 'dimension columns for column headers' }),
  values: Type.Array(PivotValueConfig, { description: 'measures with per-value aggregation functions' }),
  showRowTotals: Nullable(Type.Boolean({ description: 'show row totals column' })),
  showColumnTotals: Nullable(Type.Boolean({ description: 'show column totals row' })),
  showHeatmap: Nullable(Type.Boolean({ description: 'show heatmap conditional formatting' })),
  compact: Nullable(Type.Boolean({ description: 'compact heatmap mode: hides cell values, shows only colored squares with tooltips, and uses smaller cells — like a GitHub contribution graph' })),
  heatmapScale: Nullable(Type.String({ description: "heatmap color scale: 'red-yellow-green' (default), 'green' (single-hue like GitHub), 'blue' (single-hue blue)" })),
  rowFormulas: Nullable(Type.Array(PivotFormula, { description: 'formulas combining top-level row dimension values' })),
  columnFormulas: Nullable(Type.Array(PivotFormula, { description: 'formulas combining top-level column dimension values' })),
}, { title: 'PivotConfig' });
export type PivotConfig = Static<typeof PivotConfig>;

export const AxisScale = StringEnum(['linear', 'log']);
export type AxisScale = Static<typeof AxisScale>;

export const AxisConfig = Type.Object({
  xScale: Nullable(StringEnum(['linear', 'log'], "X-axis scale type: 'linear' (default) or 'log'")),
  yScale: Nullable(StringEnum(['linear', 'log'], "Y-axis scale type: 'linear' (default) or 'log'")),
  xMin: Nullable(Type.Number({ description: 'explicit X-axis minimum value' })),
  xMax: Nullable(Type.Number({ description: 'explicit X-axis maximum value' })),
  yMin: Nullable(Type.Number({ description: 'explicit Y-axis minimum value' })),
  yMax: Nullable(Type.Number({ description: 'explicit Y-axis maximum value' })),
  yTitle: Nullable(Type.String({ description: 'optional Y-axis title override for charts with a single Y axis' })),
  dualAxis: Nullable(Type.Boolean({ description: 'enable dual Y-axis mode. When true, yRightCols in VizSettings determines which columns go on the right axis.' })),
}, { title: 'AxisConfig' });
export type AxisConfig = Static<typeof AxisConfig>;

export const ColumnFormatConfig = Type.Object({
  alias: Nullable(Type.String({ description: 'display name override for the column header' })),
  decimalPoints: Nullable(Type.Integer({ description: 'number of decimal places (0-4) for numeric columns' })),
  dateFormat: Nullable(Type.String({ description: "date display format as a Unicode date pattern, e.g. 'yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'MMM dd, yyyy', \"MMM'yy\", 'yyyy', 'yyyy-MM-dd HH:mm', 'HH:mm:ss'. Tokens: yyyy (4-digit year), yy (2-digit year), MMMM (full month), MMM (short month), MM (month number), dd (day), HH (hours 24h), mm (minutes), ss (seconds)." })),
  prefix: Nullable(Type.String({ description: "string to prepend to displayed values (e.g. '$', '€')" })),
  suffix: Nullable(Type.String({ description: "string to append to displayed values (e.g. '%', ' units', 'k')" })),
}, { title: 'ColumnFormatConfig' });
export type ColumnFormatConfig = Static<typeof ColumnFormatConfig>;

export const VisualizationStyleConfig = Type.Object({
  colors: Nullable(Type.Record(Type.String(), Type.String(), { description: "color overrides mapping series index to color key (e.g. {'0': 'danger', '2': 'warning'})." })),
  opacity: Nullable(Type.Number({ description: 'series opacity from 0.1 to 1.0' })),
  markerSize: Nullable(Type.Integer({ description: 'point marker size for charts that render markers, such as scatter and line' })),
  stacked: Nullable(Type.Boolean({ description: 'whether bar and area series should be stacked. Defaults to true for those chart types.' })),
  showDataLabels: Nullable(Type.Boolean({ description: 'show numeric value labels on each data point. Defaults to false.' })),
}, { title: 'VisualizationStyleConfig' });
export type VisualizationStyleConfig = Static<typeof VisualizationStyleConfig>;

export const TrendCompareMode = StringEnum(['last', 'previous']);
export type TrendCompareMode = Static<typeof TrendCompareMode>;

export const TrendConfig = Type.Object({
  compareMode: Nullable(StringEnum(['last', 'previous'], "which periods to compare: 'last' (default, last vs second-to-last) or 'previous' (second-to-last vs third-to-last, skips partial current period)")),
}, { title: 'TrendConfig' });
export type TrendConfig = Static<typeof TrendConfig>;

export const ChartAnnotation = Type.Object({
  x: Type.Union([Type.String(), Type.Number()], { description: 'X-axis value to anchor the annotation to' }),
  series: Nullable(Type.String({ description: 'series name to anchor the annotation to' })),
  text: Type.String({ description: 'annotation label text' }),
}, { title: 'ChartAnnotation' });
export type ChartAnnotation = Static<typeof ChartAnnotation>;

export const VizSettings = Type.Object({
  type: StringEnum(VIZ_TYPES, 'type of the visualization (default is table)'),
  xCols: Nullable(Type.Array(Type.String(), { description: 'list of column names in the x axis (for non-pivot chart types)' })),
  yCols: Nullable(Type.Array(Type.String(), { description: 'list of column names in the y axis (for non-pivot chart types). When dualAxis is enabled in axisConfig, these are the left-axis columns.' })),
  yRightCols: Nullable(Type.Array(Type.String(), { description: 'list of column names for the right Y axis (only used when axisConfig.dualAxis is true)' })),
  tooltipCols: Nullable(Type.Array(Type.String(), { description: 'additional columns to show in chart tooltips without changing grouping or series structure' })),
  pivotConfig: NullableD(PivotConfig, "pivot table configuration (only used when type is 'pivot')"),
  columnFormats: Nullable(Type.Record(Type.String(), ColumnFormatConfig, { description: 'per-column display formatting keyed by column name. Only set when user asks to rename columns, change decimal places, or change date format. Good defaults are applied automatically.' })),
  styleConfig: NullableD(VisualizationStyleConfig, 'shared visual styling for the chart, such as colors, opacity, and marker size.'),
  annotations: Nullable(Type.Array(ChartAnnotation, { description: 'annotations for cartesian charts. Each annotation specifies x, series, and text.' })),
  colors: Nullable(Type.Record(Type.String(), Type.String(), { description: 'deprecated legacy color overrides. Use styleConfig.colors instead.' })),
  axisConfig: NullableD(AxisConfig, 'axis configuration for scale type (linear or log). Only set when user explicitly requests log scale.'),
  trendConfig: NullableD(TrendConfig, "trend chart configuration (only used when type is 'trend')"),
  geoConfig: NullableD(GeoConfig, "geo map configuration (only used when type is 'geo')"),
}, { title: 'VizSettings' });
export type VizSettings = Static<typeof VizSettings>;

// ============================================================================
// Question Content
// ============================================================================

export const ParameterType = StringEnum(['text', 'number', 'date']);
export type ParameterType = Static<typeof ParameterType>;

export const QuestionParameterSource = Type.Object({
  type: Type.Literal('question'),
  id: Type.Integer(),
  column: Type.String(),
}, { title: 'QuestionParameterSource' });
export type QuestionParameterSource = Static<typeof QuestionParameterSource>;

export const SqlParameterSource = Type.Object({
  type: Type.Literal('sql'),
  query: Type.String(),
}, { title: 'SqlParameterSource' });
export type SqlParameterSource = Static<typeof SqlParameterSource>;

export const ParameterSource = Type.Union([QuestionParameterSource, SqlParameterSource]);
export type ParameterSource = Static<typeof ParameterSource>;

export const QuestionParameter = Type.Object({
  name: Type.String(),
  type: ParameterType,
  label: Nullable(Type.String()),
  source: Nullable(ParameterSource),
}, { title: 'QuestionParameter' });
export type QuestionParameter = Static<typeof QuestionParameter>;

export const QuestionReference = Type.Object({
  id: Type.Integer(),
  alias: Type.String(),
}, { title: 'QuestionReference' });
export type QuestionReference = Static<typeof QuestionReference>;

export const QuestionContent = Type.Object({
  description: Nullable(Type.String()),
  query: Type.String({ description: 'SQL query string, may contain :paramName tokens' }),
  vizSettings: VizSettings,
  parameters: Nullable(Type.Array(QuestionParameter)),
  parameterValues: Nullable(Type.Record(Type.String(), Type.Unknown())),
  connection_name: Type.String({ description: 'connection name (empty string if none)' }),
  references: Nullable(Type.Array(QuestionReference)),
}, { title: 'QuestionContent' });
export type QuestionContent = Static<typeof QuestionContent>;

// ============================================================================
// Dashboard Content
// ============================================================================

export const FileReference = Type.Object({
  type: Type.Literal('question'),
  id: Type.Integer(),
}, { title: 'FileReference' });
export type FileReference = Static<typeof FileReference>;

export const InlineAsset = Type.Object({
  type: StringEnum(['text', 'image', 'divider']),
  id: Nullable(Type.String()),
  content: Nullable(Type.String()),
}, { title: 'InlineAsset' });
export type InlineAsset = Static<typeof InlineAsset>;

export const AssetReference = Type.Union([FileReference, InlineAsset]);
export type AssetReference = Static<typeof AssetReference>;

export const DashboardLayoutItem = Type.Object({
  id: Type.Union([Type.Integer(), Type.String()]),
  x: Type.Integer(),
  y: Type.Integer(),
  w: Type.Integer({ minimum: 2, description: 'width in grid units (min 2)' }),
  h: Type.Integer({ minimum: 1, description: 'height in grid units (min 1)' }),
}, { title: 'DashboardLayoutItem' });
export type DashboardLayoutItem = Static<typeof DashboardLayoutItem>;

export const DashboardLayout = Type.Object({
  columns: Type.Optional(Type.Integer()),
  items: Nullable(Type.Array(DashboardLayoutItem)),
}, { title: 'DashboardLayout' });
export type DashboardLayout = Static<typeof DashboardLayout>;

export const DashboardContent = Type.Object({
  description: Nullable(Type.String()),
  assets: Type.Array(AssetReference, { description: 'ordered list of questions in the dashboard' }),
  layout: Nullable(DashboardLayout),
  parameterValues: Nullable(Type.Record(Type.String(), Type.Unknown())),
}, { title: 'DashboardContent' });
export type DashboardContent = Static<typeof DashboardContent>;

// ============================================================================
// Top-level discriminated file models
// ============================================================================

export const AtlasQuestionFile = Type.Object({
  id: Nullable(Type.Integer()),
  name: Type.String(),
  path: Type.String(),
  type: Type.Literal('question'),
  content: QuestionContent,
  references: Nullable(Type.Array(Type.Integer())),
}, { title: 'AtlasQuestionFile' });
export type AtlasQuestionFile = Static<typeof AtlasQuestionFile>;

export const AtlasDashboardFile = Type.Object({
  id: Nullable(Type.Integer()),
  name: Type.String(),
  path: Type.String(),
  type: Type.Literal('dashboard'),
  content: DashboardContent,
  references: Nullable(Type.Array(Type.Integer())),
}, { title: 'AtlasDashboardFile' });
export type AtlasDashboardFile = Static<typeof AtlasDashboardFile>;

export const AtlasFile = Type.Union([AtlasQuestionFile, AtlasDashboardFile]);
export type AtlasFile = Static<typeof AtlasFile>;
