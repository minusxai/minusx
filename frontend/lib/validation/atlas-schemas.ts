/**
 * Atlas file content schemas — the single source of truth for question/dashboard
 * content types and their JSON-Schema validation.
 *
 * Authored in TypeBox: each `export const X = Type.Object(...)` is BOTH a runtime
 * JSON Schema (consumed at module load by `atlas-json-schemas.ts` → the `atlasSchema`
 * object used by Ajv validation in `content-validators.ts` and `$ref` resolution in the
 * content↔markup conversion in `file-markup.ts`/`content-jsx.ts`)
 * and a static TypeScript type via the colocated `export type X = Static<typeof X>`.
 *
 * No codegen step — edit this file and consumers re-build on next module load.
 */
import { Type, type Static, type TSchema } from 'typebox';

/** JSON-Schema string enum: `{ type:'string', enum:[...] }` with a literal-union Static type. */
const StringEnum = <const T extends readonly string[]>(values: T, description?: string) =>
  Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...(description ? { description } : {}) });

/** Optional + nullable property: `X | null`. */
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

export const ConditionalFormatRule = Type.Object({
  id: Type.String({ description: 'stable unique id for this rule' }),
  column: Type.String({ description: 'the column whose value the condition is checked against' }),
  operator: StringEnum(['=', '!=', '>', '<', '>=', '<=', 'contains'], 'comparison operator'),
  value: Type.String({ description: 'value to compare against (coerced to number for numeric columns)' }),
  target: StringEnum(['cell', 'row', 'column'], "what gets painted when the condition matches: the matching 'cell', the entire 'row', or the entire 'column'"),
  bgColor: Type.String({ description: "background color as a hex string, e.g. '#fde68a'" }),
}, { title: 'ConditionalFormatRule' });
export type ConditionalFormatRule = Static<typeof ConditionalFormatRule>;

export const VisualizationStyleConfig = Type.Object({
  colors: Nullable(Type.Record(Type.String(), Type.String(), { description: "color overrides mapping series index to color key (e.g. {'0': 'danger', '2': 'warning'})." })),
  opacity: Nullable(Type.Number({ description: 'series opacity from 0.1 to 1.0' })),
  markerSize: Nullable(Type.Integer({ description: 'point marker size for charts that render markers, such as scatter and line' })),
  stacked: Nullable(Type.Boolean({ description: 'whether bar and area series should be stacked. Defaults to true for those chart types.' })),
  showDataLabels: Nullable(Type.Boolean({ description: 'show numeric value labels on each data point. Defaults to false.' })),
  dataLabelColor: Nullable(Type.String({ description: "color for the data value labels as a hex string, e.g. '#ffffff'. Defaults to black on bars and the series color otherwise. Only relevant when showDataLabels is true." })),
}, { title: 'VisualizationStyleConfig' });
export type VisualizationStyleConfig = Static<typeof VisualizationStyleConfig>;

export const TrendCompareMode = StringEnum(['last', 'previous']);
export type TrendCompareMode = Static<typeof TrendCompareMode>;

export const TrendConfig = Type.Object({
  compareMode: Nullable(StringEnum(['last', 'previous'], "which periods to compare: 'last' (default, last vs second-to-last) or 'previous' (second-to-last vs third-to-last, skips partial current period)")),
}, { title: 'TrendConfig' });
export type TrendConfig = Static<typeof TrendConfig>;

// Typographic control for the single_value (big number) viz. The number is ALWAYS live (read
// from the query result) — these props only style/decorate it; they never replace the value.
export const SingleValueConfig = Type.Object({
  label: Nullable(Type.String({ description: 'override the displayed label (defaults to the metric column name); set to an empty string to hide the label' })),
  prefix: Nullable(Type.String({ description: "text shown immediately before the number, e.g. '$'" })),
  suffix: Nullable(Type.String({ description: "text shown immediately after the number, e.g. '%' or ' MRR'" })),
  valueSize: Nullable(Type.String({ description: "CSS font-size for the number, e.g. '4rem' or 'clamp(2rem, 10cqi, 6rem)'. Omit for the responsive default." })),
  valueColor: Nullable(Type.String({ description: 'CSS color for the number, e.g. "#16a34a" (a CSS color string, not a theme token)' })),
  valueWeight: Nullable(Type.Integer({ description: 'font weight for the number (100–900)' })),
  labelColor: Nullable(Type.String({ description: 'CSS color for the label' })),
  align: Nullable(StringEnum(['left', 'center', 'right'], 'horizontal alignment of the value block (default center)')),
}, { title: 'SingleValueConfig' });
export type SingleValueConfig = Static<typeof SingleValueConfig>;

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
  conditionalFormats: Nullable(Type.Array(ConditionalFormatRule, { description: "conditional background-color rules for table viz. Each rule paints a cell/row/column a color when a condition on a column holds. Only used when type is 'table'." })),
  styleConfig: NullableD(VisualizationStyleConfig, 'shared visual styling for the chart, such as colors, opacity, and marker size.'),
  annotations: Nullable(Type.Array(ChartAnnotation, { description: 'annotations for cartesian charts. Each annotation specifies x, series, and text.' })),
  axisConfig: NullableD(AxisConfig, 'axis configuration for scale type (linear or log). Only set when user explicitly requests log scale.'),
  trendConfig: NullableD(TrendConfig, "trend chart configuration (only used when type is 'trend')"),
  geoConfig: NullableD(GeoConfig, "geo map configuration (only used when type is 'geo')"),
  singleValueConfig: NullableD(SingleValueConfig, "single-value (big number) styling — label, prefix/suffix, font size/color/weight, alignment. The number stays live; these only decorate it. Only used when type is 'single_value'."),
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

// Per-file query-cache windows (Query Execution, Cache & Params Arch V2). Both ms.
// `revalidateMs`: results younger than this are served fresh. `expiryMs`: results
// older than this are never served — execution blocks. Between the two, results
// are stale-valid (served immediately while a background refresh runs). Omitted
// fields fall back to env-configured defaults (20 min / 1 hr).
export const CachePolicy = Type.Object({
  revalidateMs: Type.Optional(Type.Number({ description: 'serve-fresh window in ms (default 20 min)' })),
  expiryMs: Type.Optional(Type.Number({ description: 'hard-expiry window in ms (default 1 hr)' })),
}, { title: 'CachePolicy' });
export type CachePolicy = Static<typeof CachePolicy>;

// ============================================================================
// Semantic query (Semantic tier state, persisted alongside the generated SQL)
// ============================================================================

export const SemanticQueryFilter = Type.Object({
  dimension: Type.String({ description: 'dimension name from the semantic model' }),
  operator: StringEnum(['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL']),
  value: Nullable(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.String())])),
}, { title: 'SemanticQueryFilter' });
export type SemanticQueryFilter = Static<typeof SemanticQueryFilter>;

export const SemanticQuerySpec = Type.Object({
  model: Type.String({ description: 'semantic model name from the active context' }),
  measures: Type.Array(Type.String(), { description: 'measure/metric names to compute (at least one)' }),
  dimensions: Type.Array(Type.String(), { description: 'dimension names to group by' }),
  timeGrain: Nullable(StringEnum(['HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'])),
  filters: Nullable(Type.Array(SemanticQueryFilter)),
  limit: Nullable(Type.Integer()),
}, { title: 'SemanticQuerySpec' });
export type SemanticQuerySpec = Static<typeof SemanticQuerySpec>;

export const QuestionContent = Type.Object({
  description: Nullable(Type.String()),
  query: Type.String({ description: 'SQL query string, may contain :paramName tokens' }),
  vizSettings: VizSettings,
  parameters: Nullable(Type.Array(QuestionParameter)),
  parameterValues: Nullable(Type.Record(Type.String(), Type.Unknown())),
  connection_name: Type.String({ description: 'connection name (empty string if none)' }),
  references: Nullable(Type.Array(QuestionReference)),
  cachePolicy: Nullable(CachePolicy),
  semanticQuery: NullableD(SemanticQuerySpec, 'Semantic-tier state; query holds the compiled SQL'),
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

export const StoryContent = Type.Object({
  description: Nullable(Type.String()),
  story: NullableD(Type.String({ format: 'jsx' }),
    'One self-contained, FLUID RESPONSIVE HTML document rendered as a single scrolling story page (height ' +
    'unlimited — the page scrolls). It is NOT a fixed canvas and is NOT scaled: it renders full-bleed on a phone ' +
    '(~390–430px wide) and capped ~1280px wide, centered, on desktop. The SAME document must look great at BOTH. ' +
    'STYLING — use the built-in DESIGN SYSTEM (the default): put `data-design="tw"` and the `@container` class on ' +
    'your root wrapper (e.g. <div data-design="tw" class="@container mx-auto max-w-[1280px] …">). Every Tailwind ' +
    'v4 utility then works (arbitrary values like text-[13px] included) — the platform compiles exactly the ' +
    'classes you use at save time. Responsiveness: Tailwind CONTAINER-QUERY variants (`@lg:`, `@2xl:`, `@3xl:` — ' +
    'NEVER viewport `md:`/`lg:`), collapsing every multi-column band to one column on narrow widths; wrap wide ' +
    'tables in `overflow-x-auto`. Dark/light: `dark:` variants follow the app mode. Story COMPONENTS replace ' +
    'hand-built containers AND carry the design (components-first is the default): <PageHeader>/<PageFooter>, ' +
    '<Section>, <Eyebrow>, <Headline>, <Standfirst>, <Grid cols={2|3|4}>, <Card>, <Stat>+<StatLabel>/<StatValue>/' +
    '<StatDelta tone="up|down|neutral">, <FigurePlate> (chart + styled caption <p>), <Takeaways> (self-styling ' +
    '<ul>), <Pill tone="neutral|good|bad|warn|info">, <Callout tone="info|good|warn|bad">, <Quote> — text goes in ' +
    'CHILDREN, props are enums plus an optional `class` for accent-level tweaks; they nest freely with HTML and ' +
    'embeds. A <style> ' +
    'block is allowed ONLY for web-font @imports, motif/signature CSS utilities cannot express, and keyframes — ' +
    'keep it short and scoped under your root class; rules targeting body or html will NOT apply. <script> tags, ' +
    'event-handler attributes, and iframes are stripped at render time. Write it like a designed long-form ' +
    'editorial piece: narrative prose between charts, big pull-quote numbers, section headers. CONTRAST: every ' +
    'piece of text must contrast strongly with the background behind it. Set the `colorMode` field to the mode ' +
    'your design uses so embedded charts theme to match (a dark story → "dark"). ' +
    'CHART EMBEDS — the body is the single source of truth (there is no separate assets field). ' +
    'Use the <Question/> component, two forms: ' +
    '(A) SAVED — <Question id={N} height="420px" /> embeds saved question file N. PREFER THIS: reuse an ' +
    'existing saved question whenever one fits the beat (reusable, governed, shows up in search & dependencies). ' +
    '(B) INLINE — embeds a story-LOCAL question whose query/connection/viz live right here in the body (no saved ' +
    'file). The `query` MUST be a TEMPLATE LITERAL in backticks `query={`…`}` — write real, multi-line SQL with ' +
    'actual line breaks and -- comments inside the backticks. NEVER put the query in a double-quoted string and ' +
    'NEVER use \\n / \\t escape sequences: a quoted attribute keeps them literal and the SQL parser breaks on the ' +
    'backslash. Example:\n' +
    '      <Question\n' +
    '        query={`SELECT SUM(mrr) AS mrr\n' +
    '                FROM monthly_saas_metrics\n' +
    '                WHERE month = :month`}\n' +
    '        connection="<db>"\n' +
    '        viz={{type:"single_value", yCols:["mrr"], singleValueConfig:{prefix:"$", suffix:" MRR"}}}\n' +
    '        params={[{name:"month",type:"date",label:null,source:null}]}\n' +
    '        height="200px" />\n' +
    'Use inline ONLY for one-off metrics/live numbers that do not deserve their own saved question. ' +
    'NUMBERS ARE ALWAYS LIVE: never hand-type a metric, percentage, or pull-quote figure into the prose. To show ' +
    'a big number, embed a single_value question (saved or inline) and style it with singleValueConfig ' +
    '(prefix/suffix/label/valueSize/valueColor) — the digits are read from the query, never written by you. ' +
    'The renderer fills the div exactly with a chart card (title bar + live chart), so do NOT add your own ' +
    'duplicate title caption inside or directly above it. SIZING: always give an explicit px height (a missing ' +
    'height defaults to 430px; percentages do NOT work); width is 100%; minimum height 340px is enforced. ' +
    'INLINE LIVE NUMBER — for a figure that sits IN A SENTENCE (not a chart card), use <Number/> instead of a ' +
    'single_value <Question/>. It renders the live digits in a <span> that flows with the prose, e.g. ' +
    '`grew to <Number id={142} prefix="$" />` (saved) or ' +
    '`<Number query={`SELECT SUM(mrr) AS mrr FROM metrics`} connection="<db>" col="mrr" prefix="$" suffix=" MRR" />` ' +
    '(inline). `col` picks the column (default first), `prefix`/`suffix` wrap it, `style={{…}}` themes the span ' +
    '(literal CSS); clicking it reveals the source question as a footnote. Still LIVE — never hand-type the number. ' +
    'READER FILTERS — declare shared, reader-changeable filters with <Param>: ' +
    '`<Param name="city" type="text" nullable={false} />` (typed input), ' +
    '`<Param name="city" type="text" id={5} column="city" />` (autocomplete from question 5\'s column), or ' +
    '`<Param name="limit" type="number" widget="slider" min={0} max={100} step={5} />` (range slider). ' +
    'Every embedded `<Question>` AND inline `<Number>` whose SQL references a matching `:param` rebinds on ' +
    'change (so a `<Number query={`… WHERE mrr >= :min_mrr`}>` is driven live by a `min_mrr` slider); the story\'s ' +
    '`parameterValues` are the defaults. Theme with `style={{…}}` (control) and `labelStyle={{…}}` (label) — LITERAL ' +
    'CSS objects, not theme tokens (they vanish across the shadow boundary).'),
  suggestedQuestions: Type.Optional(Nullable(Type.Array(Type.String(), { description:
    'Up to ~3 short follow-up questions a reader might ask about THIS story, shown as "try these questions" ' +
    'prompts in the chat panel. Make them specific to the story\'s data and narrative (e.g. "Which region drove ' +
    'the drop in Q3?"), not generic. Omit or leave null to fall back to the default generic prompts.' }))),
  colorMode: Type.Optional(Nullable(StringEnum(['light', 'dark'],
    'Pins the STORY SURFACE (embedded chart theming, design-system `dark:` variants, tile chrome) to the ' +
    'mode the design was authored for — everywhere it renders, including inside an app set to the other ' +
    'mode, and for public shared viewers. ALWAYS set it for a single-mode design (a white board deck → ' +
    '"light"); omit/null ONLY if the story styles both modes (every color utility paired with a dark: ' +
    'counterpart), in which case it follows the viewer.'))),
  parameterValues: Nullable(Type.Record(Type.String(), Type.Unknown(), { description:
    'Current/default values for the story\'s shared params (declared via <Param name=…> in the body). ' +
    'Keyed by param name; flows down to every embedded question, like a dashboard. Readers change them at ' +
    'runtime; the values here are the defaults.' })),
}, { title: 'StoryContent' });
export type StoryContent = Static<typeof StoryContent>;

// ============================================================================
// Notebook Content — ordered list of cells (each a full inline question or text)
// ============================================================================

export const NotebookSqlCell = Type.Object({
  type: Type.Literal('sql'),
  id: Type.String({ description: 'stable cell id (uuid) — never reused; enables future cell-to-cell references' }),
  name: Nullable(Type.String({ description: 'optional cell name' })),
  query: Type.String({ description: 'SQL query string, may contain :paramName tokens' }),
  vizSettings: VizSettings,
  parameters: Nullable(Type.Array(QuestionParameter)),
  parameterValues: Nullable(Type.Record(Type.String(), Type.Unknown())),
  connection_name: Type.String({ description: 'connection name (empty string if none)' }),
  references: Nullable(Type.Array(QuestionReference, { description: '@alias references to saved question files, composed as CTEs' })),
}, { title: 'NotebookSqlCell' });
export type NotebookSqlCell = Static<typeof NotebookSqlCell>;

export const NotebookTextCell = Type.Object({
  type: Type.Literal('text'),
  id: Type.String({ description: 'stable cell id (uuid)' }),
  name: Nullable(Type.String()),
  content: Type.String({ description: 'rich-text body stored as markdown' }),
}, { title: 'NotebookTextCell' });
export type NotebookTextCell = Static<typeof NotebookTextCell>;

export const NotebookCell = Type.Union([NotebookSqlCell, NotebookTextCell]);
export type NotebookCell = Static<typeof NotebookCell>;

// System-managed cached result for a SQL cell, persisted so a reopened notebook
// shows charts/tables without re-running. Keyed by cell id in NotebookContent.
// `queryHash` is getQueryHash(query, params, connection) at capture time — the
// snapshot is ignored on load if it no longer matches the cell's current query.
export const NotebookCellResult = Type.Object({
  queryHash: Type.String(),
  executedAt: Type.Number({ description: 'epoch ms when the result was captured' }),
  data: Type.Object({
    columns: Type.Array(Type.String()),
    types: Type.Array(Type.String()),
    rows: Type.Array(Type.Unknown()),
  }),
  truncated: Type.Optional(Type.Boolean({ description: 'true if rows were capped at capture time' })),
}, { title: 'NotebookCellResult' });
export type NotebookCellResult = Static<typeof NotebookCellResult>;

export const NotebookContent = Type.Object({
  description: Nullable(Type.String()),
  cells: Type.Array(NotebookCell, { description: 'ordered, vertical list of notebook cells' }),
  cellResults: Type.Optional(Type.Record(Type.String(), NotebookCellResult, {
    description: 'system-managed cached cell results keyed by cell id — never authored by the agent',
  })),
}, { title: 'NotebookContent' });
export type NotebookContent = Static<typeof NotebookContent>;

// ============================================================================
// Context Content — the AGENT's flattened, editable view of a context
// ============================================================================
// This is NOT the stored context shape (which is version-based — see ContextContent
// in lib/types.ts, with versions[]/published). It is the KNOWLEDGE LAYER the agent
// authors: the live (published) version's docs/metrics/annotations flattened to the top
// level, plus the content-level evals/skills. The flatten (on read) and fold (on edit,
// back into versions[live]) live in lib/context/context-agent-view.ts.
//
// Schema whitelisting (which tables/columns are exposed) is deliberately ABSENT: it's a
// human concern managed in the Databases tab, not something the agent edits. The agent
// instead receives the resolved (already-whitelisted) schema as read-only app-state
// context and documents on top of it.
//
// `evals` is modelled as opaque (described) values so the schema-driven markup renders
// each via the JSON escape hatch — an eval is a discriminated Test union that round-trips
// losslessly as JSON without a brittle nested-tag projection.

const CtxDocEntry = Type.Object({
  content: Type.String({ description: 'Markdown documentation content' }),
  title: Nullable(Type.String({ description: 'short human-readable title; required to save a non-draft doc' })),
  description: Nullable(Type.String({ description: 'one-line summary; required to save a non-draft doc' })),
  childPaths: Nullable(Type.Array(Type.String(), { description: 'child context paths that inherit this doc' })),
  draft: Nullable(Type.Boolean({ description: 'if true, hidden from the agent until activated' })),
  alwaysInclude: Nullable(Type.Boolean({ description: 'if true, stays inline in the prompt every turn; otherwise lazy-loaded on demand via LoadContext' })),
}, { title: 'ContextDocEntry' });

const CtxMetricDef = Type.Object({
  name: Type.String(),
  description: Nullable(Type.String()),
  sql: Nullable(Type.String()),
  connection: Nullable(Type.String({ description: "owning table's connection (database) name" })),
  schema: Nullable(Type.String({ description: "owning table's schema" })),
  table: Nullable(Type.String({ description: 'owning table name' })),
}, { title: 'ContextMetricDef' });

const CtxColumnAnnotation = Type.Object({
  name: Type.String(),
  description: Nullable(Type.String()),
}, { title: 'ContextColumnAnnotation' });

const CtxTableAnnotation = Type.Object({
  connection: Nullable(Type.String({ description: 'connection (database) name — disambiguates the same schema.table across connections' })),
  schema: Type.String(),
  table: Type.String(),
  description: Nullable(Type.String()),
  columns: Nullable(Type.Array(CtxColumnAnnotation)),
}, { title: 'ContextTableAnnotation' });

const CtxSkillEntry = Type.Object({
  name: Type.String(),
  description: Type.String(),
  content: Type.String(),
  enabled: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  createdBy: Type.Integer(),
}, { title: 'ContextSkillEntry' });

export const ContextAgentContent = Type.Object({
  docs: Type.Array(CtxDocEntry, { description: 'documentation entries the agent authors for this context' }),
  metrics: Nullable(Type.Array(CtxMetricDef, { description: 'named metrics attached to tables' })),
  annotations: Nullable(Type.Array(CtxTableAnnotation, { description: 'editorial table/column descriptions' })),
  skills: Nullable(Type.Array(CtxSkillEntry, { description: 'user-defined skills available in this context' })),
  evals: Nullable(Type.Array(Type.Unknown(), { description:
    'eval test definitions for this context (each an opaque Test object: { type, subject, answerType, operator, value })' })),
}, { title: 'ContextContent' });
export type ContextAgentContent = Static<typeof ContextAgentContent>;

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

export const AtlasStoryFile = Type.Object({
  id: Nullable(Type.Integer()),
  name: Type.String(),
  path: Type.String(),
  type: Type.Literal('story'),
  content: StoryContent,
  references: Nullable(Type.Array(Type.Integer())),
}, { title: 'AtlasStoryFile' });
export type AtlasStoryFile = Static<typeof AtlasStoryFile>;

export const AtlasNotebookFile = Type.Object({
  id: Nullable(Type.Integer()),
  name: Type.String(),
  path: Type.String(),
  type: Type.Literal('notebook'),
  content: NotebookContent,
  references: Nullable(Type.Array(Type.Integer())),
}, { title: 'AtlasNotebookFile' });
export type AtlasNotebookFile = Static<typeof AtlasNotebookFile>;

export const AtlasFile = Type.Union([AtlasQuestionFile, AtlasDashboardFile, AtlasStoryFile, AtlasNotebookFile]);
export type AtlasFile = Static<typeof AtlasFile>;
