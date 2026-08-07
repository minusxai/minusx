# Visualization

How a query result becomes a chart: the two vocabularies (V1 `vizSettings` and the V2 `viz`
envelope), the recipe system, the Vega/Vega-Lite render pipeline, the editing surface and the
validation gates.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## What this area owns

**Vega/Vega-Lite is the only chart *rendering engine*.** ECharts and Leaflet are gone and neither
is a dependency — `frontend/package.json` carries `vega`, `vega-lite`, `vega-interpreter` and
`vega-tooltip`, plus the non-rendering helpers the pipeline needs (`d3-format`, `d3-time-format`,
`topojson-client`), and no second engine. Stale `ECharts`/`Leaflet` words survive in comments and
in `next.config.ts`'s `optimizePackageImports`; none of them is a live code path, and nothing new
may reintroduce a second engine.

Every chart on a question, dashboard, notebook, story, Slack message or LLM tool result ends up as
a `vega` `View`. Most get there through a `vega-lite` compile; the five recipes that declare
`engine: 'vega'` (radar, trend, single-value, choropleth, point-map) are native Vega specs that
skip the compile entirely. `table` and `pivot` deliberately never touch Vega — they render as real
DOM (`<table>` + tanstack-virtual).

Four directories own this: `lib/viz` (the V2 engine), `lib/chart` (engine-free chart math,
formatting and the image compositors), `components/viz` (the V2 renderer + settings panel),
`components/plotx` (the DOM tier, the V1 drop-zone builders, and small SVG widgets).

None of these own query execution, result caching, param substitution, file save/dirty state, or
screenshot capture — they take rows and a viz spec and produce pixels or a JPEG. The viz *schema*
is not theirs either: it lives in `lib/validation/atlas-schemas.ts`.

## Two vocabularies, one bridge

There are two independent type systems and the whole area hinges on the mapping between them.

**V1 — `VizSettings.type`** (`lib/validation/atlas-schemas.ts`, the `VIZ_TYPES` const; exported
as `VisualizationType`). Seventeen members, and this list is the authority — not prose:

```
table  bar  line  scatter  area  funnel  pie  pivot  trend  waterfall
combo  radar  geo  single_value  row  choropleth  point_map
```

`VizSettings` also carries the V1 knobs the converter reads: `xCols`/`yCols`/`yRightCols`,
`pivotConfig`, `geoConfig`, `trendConfig`, `singleValueConfig`, `styleConfig`, `axisConfig`,
`annotations`, `columnFormats`, `conditionalFormats`.

**V2 — `VizEnvelope`** (same file): `{version: 2, source}` where `source.kind` is one of
`vega-lite | vega | recipe | table | pivot`. `recipe` names one of exactly eight shipped
builders in `lib/viz/viz-templates.ts` (`VIZ_TEMPLATES`), each declaring its own `engine` and the
`vizType` it maps back to:

| Recipe id | `engine` | `vizType` |
|---|---|---|
| `minusx/funnel@1` | `vega-lite` | `funnel` |
| `minusx/waterfall@1` | `vega-lite` | `waterfall` |
| `minusx/combo@1` | `vega-lite` | `combo` |
| `minusx/radar@1` | `vega` | `radar` |
| `minusx/trend@1` | `vega` | `trend` |
| `minusx/single-value@1` | `vega` | `single_value` |
| `minusx/choropleth@1` | `vega` | `choropleth` |
| `minusx/point-map@1` | `vega` | `point_map` |

The `engine` is load-bearing beyond render — it decides which validation path a recipe takes (see
Validation) and which source kind `lib/viz/detach.ts` freezes to.

The panel's own selector vocabulary is a third list — `V2_SUPPORTED_VIZ_TYPES` in
`lib/viz/encoding-edit.ts`. The two lists are not nested: V2 adds `heatmap`, `boxplot` and
`histogram`, which exist only as spec shapes (a `rect` mark, a `boxplot` mark, a binned `bar`),
have no `VizSettings.type`, and are classified back out of the spec by `getVizType()`. V1's
umbrella `geo` has no V2 member at all — it decomposes on `geoConfig.subType` into the two geo
recipes, so a `geo` question converts but nothing converts back to `geo`.

`lib/viz/from-vizsettings.ts` is the bridge between the two (detailed below), and its switch is
exhaustiveness-guarded (`const _never: never = type`) — adding a member to `VIZ_TYPES` fails the
type check until the switch handles it. `envelopeVizType()` in `lib/viz/viz-templates.ts` is the
reverse map (recipes → their `vizType`, DOM kinds pass through, raw specs → `undefined`).

## Render pipeline

```
VizEnvelope ──resolveEnvelopeSpec──▶ {spec, engine, assets?}     lib/viz/render-vega.ts
   recipe    → materializeRecipe (lib/viz/viz-templates.ts)  → vega-lite | vega
   vega-lite → spec as-is                            → vega-lite
   vega      → spec + assets as-is                   → vega
                          │
              toVegaSpec ─┤
                 vega-lite: prepareVegaLiteSpec (inject data:{name:'main'})
                            → injectXLabelAngle / injectSingleSeriesLegend
                            → injectLegendToggle / injectHeatmapCellLayout
                            → suppressLegendTitles → compile(spec, {config: theme})
                            → injectLegendPlan
                 vega:      spec + getVegaParserConfig(mode)
                          │
              createVegaView: parse(spec, cfg, {ast:true}) + expressionInterpreter
                          │
              setMainData(view, rows)  ── the ONLY dataset binding, name 'main'
              injectNamedAssets(view, assets) ── geo boundaries, by local dataset name
                          │
        ┌─────────────────┴──────────────────┐
   renderer 'svg' (browser)          renderer 'none' (headless)
   components/viz/VegaChart.tsx      renderEnvelopeToSvg / renderEnvelopeToCanvas
```

`lib/viz/render-vega.ts` is the single pipeline; there is no browser-only or server-only variant
of it. Everything below the fold is a caller.

**`components/viz/VegaChart.tsx`** is the only browser renderer. Pure view (envelope + rows +
colorMode in, no Redux). It hard-forces Vega's **SVG** renderer because captures serialize live
DOM and `<canvas>` serializes empty. It rebuilds the view on envelope/colorMode change, pushes
data-only updates through `view.data()`, and drives root width/height signals from a
`ResizeObserver`; top-level facets instead receive container-planned `child_width`/`child_height`
signals because Vega-Lite compiles each panel to those dimensions. The same plan is seeded into
the nested facet spec before compilation so a discrete axis cannot replace `child_width` with its
default category-count × band-step signal and silently undo responsive sizing.
Several render-time decisions are *compile-time constants* baked before `parse` — the legend
column count (`computeLegendPlan`) and the x-axis label angle (`computeXLabelAngle`) — so a
resize that flips either decision bumps an epoch and rebuilds the whole view. The planner descends
into nested facet specs, so a long faceted-series legend wraps within the outer container instead
of widening and shifting the facet grid. The component also owns the
shared multi-series tooltip (`lib/viz/tooltip-plan.ts` builds the plan and HTML,
`lib/viz/shared-tooltip.ts` positions the card, `lib/viz/facet-tooltip.ts` resolves a hovered
facet cell, `lib/viz/guide-mark.ts` injects the guide rule). Shared-scale top-level facets use
the same axis tooltip as unit charts: their index is partitioned by facet value and the pointer
snaps in child-local coordinates. Their guide rule is repeated inside the compiled `cell` group,
clipped to each child plot, and gated by the hovered facet datum so only that panel's line appears.
and the interactive-map zoom buttons.

**Theme.** `lib/viz/theme.ts` generates the light/dark Vega-Lite `config` and the native-Vega
parser config from one token source in `lib/chart/chart-theme.ts` (`COLOR_PALETTE`,
`LIGHT_THEME`/`DARK_THEME`, `getChartFontFamily`). House looks that live in the theme rather than
in specs: donut `arc`, GitHub-green `heatmap` range, rounded `rect` cells with a
surface-coloured stroke, transparent `geoshape` fill, boxplot sub-mark colours, SI `numberFormat`
(`.3~s`), top-oriented legends. `lib/viz/chart-tokens.ts` reads `--chart-1..5` from the computed
style of the chart's container; inside a design-theme (`[data-theme]`) scope those replace the
house categorical range, outside one they are undefined and the house palette wins.

## The V1 → V2 bridge

`lib/viz/from-vizsettings.ts` exposes four entry points, all pure:

| Function | Used by | Contract |
|---|---|---|
| `vizSettingsToEnvelope(vs, columns?)` | everything below | the switch itself |
| `vizSettingsToEnvelopeStatic(vs, query?)` | migration v37 (`lib/database/migrations.ts`, questions **and** notebook SQL cells), `POST /api/viz/backfill`, `lib/data/story/story-question.ts`, V1 pivot in `components/question/QuestionVisualization.tsx` | no query is run; column kinds come from a name heuristic + query-text proof (`DATE_TRUNC`, `::date`, `CAST(… AS DATE)`) |
| `resolveLegacyRenderEnvelope({hasVizEnvelope, vizSettings, columns})` | `components/question/QuestionVisualization.tsx` | `null` for `table`/`pivot` and for files that already have a `viz` — caller falls back to the DOM tier |
| `resolveImageEnvelope({viz, vizSettings, columns, types})` | `lib/tools/handlers/chart-images.ts`, `lib/chart/ChartImageRenderer.server.ts`, `agents/benchmark-analyst/db-tools.server.ts` | a V2 `viz` is authoritative; `null` when nothing images |

Cartesian types are built as a SUM-aggregated bar and then morphed with `setVizType`, so the
converter's output is byte-identical to what the icon selector produces. V1 style knobs are
re-expressed as the same spec shapes the V2 editors write (`applyLegacyStyle`): opacity, marker
size (V1 `markerSize` is a **diameter**, Vega-Lite point `size` is an **area**), index-keyed colour overrides → a scale
`range`, stacked/log/bounds via the surgical editors, annotations as reference-line layers. The
bridge is **render-only** — nothing is ever written back to the file. The write path is the
backfill route and the v37 migration.

## Editing surface

`lib/viz/encoding-edit.ts` is the largest module in the area and the one everything else leans
on. Its rule: never parse a spec into a simplified model and rewrite it — every helper makes one
surgical, immutable edit and preserves every other property. It covers channel fields, mark type,
viz-type transforms, stacking, log scale, y bounds, bin count, line interpolation, reference
lines, series colours, channel presentation, recipe params, column formats, table CSS,
conditional formats and pivot config, plus the envelope-level predicates
(`isEnvelopeImageViz`, `isEnvelopeEditable`, `getEnvelopeVizType`, `getEnvelopeZones`).
Composed specs (`layer`/`facet`/`concat`/`repeat`) are not editable through the lens —
`isUnitVegaLiteSpec` gates the panel and those charts are edited by chat. An **annotated unit**
(a base chart plus reference-line layers) is the one exception: `annotationSplit` finds the base
so adding a reference line doesn't cost the panel or the injected legend behaviours.

`components/viz/VegaVizPanel.tsx` is the panel (Fields | Settings | Spec), composing
`components/viz/VegaEncodingPanel.tsx` (drop-zone lens, reusing `components/plotx/AxisComponents.tsx` chips),
`components/viz/VizFieldPopover.tsx` (alias + d3 format, storage-agnostic — native specs get channel
`title`/`axis.format`, recipes get `source.columnFormats`), `components/viz/VizSpecInspector.tsx` (raw JSON +
detach/reattach), and, for pivot envelopes, `components/plotx/PivotAxisBuilder.tsx` and
`components/plotx/TableConditionalFormatPanel.tsx`.

`lib/viz/detach.ts` implements the escape hatch: `detachRecipe` materializes a recipe and freezes
the spec as `kind: 'vega'` (or `'vega-lite'` for VL recipes), keeping `detachedFrom` so
`reattachRecipe` can reset. Reached from `lib/tools/handlers/detach-viz.ts` and the inspector.

## DOM tier (`components/plotx`)

`table` and `pivot` never route through Vega. `components/plotx/TableV2.tsx` (tanstack-table + tanstack-virtual,
column stats, faceted filters, drilldown, header format editor) and `components/plotx/PivotTable.tsx` are the real
renderers; `components/viz/VizTableView.tsx` and `components/viz/VizPivotView.tsx` are thin envelope adapters
over them, unpacking `columnFormats` / `conditionalFormats` / `wrapColumns` / `config` / `css` via
`encoding-edit` getters. The `css` field is scoped to the instance with native CSS nesting under
a per-mount class (`.mx-viz-scope-*`) and is written against a stable class contract.

**The classes are emitted from four files, not one.** `components/plotx/TableV2.tsx` writes
`.mx-table`, `.mx-header-row` and the `<col>` classes (`.mx-column`,
`.mx-column-type-<text|number|date|json>`, `.mx-col-<name>` via `cssColumnClass` in
`components/plotx/table-v2-utils.ts`); `components/plotx/TableBody.tsx` writes `.mx-row`,
`.mx-row-odd/-even`, `.mx-row-wrap`, `.mx-row-clickable`, `.mx-cell`, `.mx-cell-wrap`;
`components/plotx/TableHeaderCell.tsx` writes `.mx-th`, `.mx-th-accented`, `.mx-type-icon`
(+ `.mx-type-icon-<type>`), `.mx-header-toggle`, `.mx-sort-icon`, `.mx-filter-icon`,
`.mx-resize-handle`, `.mx-facet-list`; `components/plotx/TableBottomBar.tsx` writes `.mx-toolbar`;
the pivot's `components/plotx/PivotTableBody.tsx` / `PivotTableHeader.tsx` write the same
row/cell/th classes under the `.mx-pivot` root. Every *default* for those classes is a
zero-specificity `:where()` rule in `TABLE_BASE_CSS` (`components/plotx/TableV2.tsx`) — that file
styles far more classes than it emits, so grep for the `className=` to find the owner. Custom
properties: `--mx-column-width`, `--mx-table-accent`, `--mx-cell-padding-block/inline`,
`--mx-header-padding-block/inline`.

**The contract exists in three hand-maintained copies and they have already drifted.** The
authority is the `css` field description on `VizSourceTable` (and `VizSourcePivot`) in
`lib/validation/atlas-schemas.ts` — that string is what the agent reads, so a class added in a
component without a schema edit is undiscoverable. The panel's help text in
`components/viz/VegaVizPanel.tsx` is a second copy shown to humans. Today the schema description
omits `.mx-th-accented`, `.mx-row-wrap`, `.mx-cell-wrap`, `.mx-resize-handle`, `.mx-header-toggle`,
`.mx-facet-list`, `--mx-column-width` and `--mx-table-accent`; treat those as
emitted-but-undocumented until the description is updated.

Pivot math is split: `lib/chart/pivot-utils.ts` is the aggregation engine (`aggregatePivotData`,
`computeFormulas`, dimension-value helpers) and `lib/chart/pivot-grid.ts` is the pure layout
engine (column entries, nested header rows, display rows, row spans, heatmap domain, cell
background). `components/plotx/PivotTable.tsx` uses both. `lib/chart/conditional-format-utils.ts` +
`lib/chart/color-scale.ts` supply cell painting for both the flat table and the pivot.

`components/plotx/MiniBarChart.tsx` and `components/plotx/MiniHistogram.tsx` are hand-rolled plain-SVG column-stat widgets in the
table header — no chart library at all.

**Structural table declarations live in a zero-specificity sheet, never inline.** `TABLE_BASE_CSS` in
`components/plotx/TableV2.tsx` wraps every default in `:where()` (0-0-0) so the envelope's scoped `css`
wins without `!important`. Widths, the accent and cell padding are therefore *tokens*, not literals: a
dragged or supplied column width is written as `--mx-column-width` on the `<col>` element and read back
by `.mx-column`/`.mx-th`/`.mx-cell`. An inline `style="width:…"` would beat every author rule and
silently void the documented contract, which is the failure this shape exists to prevent
(`components/plotx/__tests__/table-style-contract.ui.test.tsx` asserts both halves, plus that
column-resize drags bind to the *owning* document — inside a story iframe, TanStack's
`getResizeHandler()` handed the module-global `document` never sees the move or the up).

**Text wrapping is a source field, not CSS, because the virtualizer must know.** `wrapColumns` on
`VizSourceTable` lists result columns whose cells wrap. Wrapping changes row GEOMETRY: `TableV2` only
wires `measureElement` into `useVirtualizer` when the set is non-empty, and drops the cached
measurements whenever wrapping is toggled, so unwrapped rows fall back to the fixed `ROW_HEIGHT`.
Styling `white-space` through the `css` field alone leaves the virtualizer measuring the old height and
the rows overlap. `lib/viz/validate.ts` field-checks every `wrapColumns` entry against the real result
columns (`E_FIELD_NOT_FOUND`) for the same reason it checks `columnFormats` — a typo'd column is
otherwise a silent no-op.

## Geo

Vega may not fetch geometry: the validator rejects `data.url` and `data.values`, and the only
dataset bound at render is the query result. Boundaries therefore go through a named-asset
allowlist. `lib/viz/geo-assets.ts` defines `GEO_ASSETS` — `us-states`, `us-counties`, `world`,
`india-states`, each naming a file under `public/geojson/` plus the `nameProp` lookup key and the
Vega projection that frames it. An entry with a `topojsonObject` is converted from TopoJSON at
load; `india-states` has none and is plain GeoJSON. `DEFAULT_GEO_ASSET` is `us-states`. The
reserved dataset name is `GEO_BOUNDARY_DATASET` (`__mx_geo_boundary`). A recipe declares
`{localName: assetId}` via `VizTemplate.assets`, and `injectNamedAssets` resolves and binds the
features next to `main`. Loading goes through a swappable fetcher: browsers `fetch` the
root-relative path; headless contexts must install
`lib/viz/geo-assets.server.ts#installFsGeoAssetFetcher` (which `lib/chart/render-viz-image.ts`
does at module load) or geo charts silently render empty.

`lib/chart/geo-color-scale.ts` and `lib/chart/geo-data.ts` back the V1 `GeoAxisBuilder`;
`components/plotx/ColorScalePicker.tsx` is shared between choropleth and pivot heatmap.

## Image pipelines

Two paths, one compositor family, both gated by `isEnvelopeImageViz` (everything except
`table`/`pivot`) and sized by `getChartHeight` from `lib/chart/renderable-types.ts`.

```
server (Node)   envelope → renderEnvelopeToSvg → composeSvgToJpeg (Resvg → Sharp)
                lib/chart/render-viz-image.ts  ← lib/chart/svg-to-jpeg.ts
                callers: lib/chart/ChartImageRenderer.server.ts (Slack via
                         lib/integrations/slack/process-event.ts),
                         agents/benchmark-analyst/db-tools.server.ts

browser         envelope → renderEnvelopeToCanvas → toJpegObjectUrl (canvas → JPEG)
                lib/chart/VizImageRenderer.client.ts ← lib/chart/render-chart-client.ts
                callers: lib/tools/handlers/chart-images.ts (ReadFiles / EditFile),
                         components/viz/ChartDownloadMenu.tsx
```

The browser path rasterizes through Vega's **canvas** renderer specifically so slippy street
tiles are captured; the server path is SVG and cannot draw tiles. `lib/chart/query-presentation.ts`
decides whether a tool result sends an image, rows, or both (`isContentImageViz`,
`selectExecuteQueryImage`, `shouldDropRows`) — the image is additive, `rawData: true` never
suppresses it.

## Validation

`lib/viz/validate.ts` (`validateVizEnvelope`) runs stages that short-circuit on the first error:
envelope shape (`E_ENVELOPE`) → recipe materialization (`E_RECIPE` — unknown id or missing
bindings) → data policy (`E_EXTERNAL_DATA`, `E_DATASET_NAME`) → the Vega-Lite package schema via
Ajv (`E_SCHEMA`) → field references against the actual result columns (`E_FIELD_NOT_FOUND`, with
suggestions; transform-derived names allowed) → compile warnings (`W_COMPILE`, never fatal).
`E_CSS` rejects `@import` and **any** `url()`, not merely an external one. Codes and
`formatVizIssues` live in `lib/viz/types.ts`.

Three source kinds take shortcuts, and knowing which avoids chasing a check that never runs.
`table`/`pivot` have no grammar: only column references (`columnFormats`, `wrapColumns`, pivot
`config`) and the `css` sanitizer apply. A detached `vega` source and a `vega` recipe cannot run
the Vega-Lite pipeline, so they are data-policy checked and then smoke-parsed
(`parse(spec, undefined, {ast: true})`). Recipe **bindings** are field-checked directly against the
columns, but the materialized spec is not — it legitimately references boundary geometry fields
(`properties.name`) that are not query columns, and checking it would false-positive. `columns`
being undefined (headless paths, or an edit changing query and viz together) skips every field
check rather than false-positive against stale columns.

`lib/viz/query-data.ts` is where "column kinds" come from: `sqlTypeToVizKind` maps a connector's
SQL type string onto `quantitative | temporal | nominal | boolean | unknown`, and `toVizColumns`
zips `QueryResult.columns` with `.types`. Every caller that hands `columns` to the validator, the
bridge or the encoding panel goes through it.

The Vega-Lite schema is large and server-only, so the browser reaches the validator over
`POST /api/viz/validate` through `lib/viz/validate-remote.ts`, which **fails open**: an
unreachable route returns `{ok: true, issues: []}` and the edit proceeds. `EditFile` /
`CreateFile` validate before applying (rejecting atomically with the issue list) and again after
auto-execute, that second pass advisory only.

## Boundaries with other areas

| Direction | Boundary | Contract |
|---|---|---|
| schema → viz | `lib/validation/atlas-schemas.ts` | `VizSettings`, `VizEnvelope`, `PivotConfig`, `ColumnFormatConfig`, `ConditionalFormatRule`. Adding a `VIZ_TYPES` member breaks the `from-vizsettings` switch by design |
| question page → viz | `components/question/QuestionVisualization.tsx` | picks DOM tier vs `VegaChart`; memoizes the bridged envelope because `VegaChart` keys its build effect on envelope **identity** |
| agent tools → viz | `lib/tools/handlers/edit-file.ts`, `lib/tools/handlers/create-file.ts` | `validateVizRemote` + `formatVizIssues`; `lib/tools/handlers/detach-viz.ts` → `detachRecipe`; `lib/tools/handlers/viz-warning.ts` → `getVizSettingsWarning`; `lib/tools/handlers/chart-images.ts` → `resolveImageEnvelope` + browser renderer |
| agent prompts → viz | `orchestrator/prompts/prompts.yaml` skills, `agents/web-analyst/web-tools.ts` | recipe ids, binding slots and the `.mx-*` CSS contract are documented in the skills, **not** derived from `VIZ_TEMPLATES` — they drift silently |
| story/dashboard → viz | `components/views/shared/StoryJsxBody.tsx`, `components/views/shared/AgentHtml.tsx`, `components/views/notebook/NotebookSqlCell.tsx`, `components/explore/tools/ChartCarousel.tsx` | `envelopeVizType()` for "bare single-value" embed detection; `VizConfigPanel` for the classic builder |
| capture → viz | `lib/screenshot/app-state-screenshot.ts` | serializes live DOM, which is why `VegaChart` forces SVG |
| Slack → viz | `lib/integrations/slack/process-event.ts` → `lib/chart/ChartImageRenderer.server.ts` | server JPEG; `lib/integrations/slack/messages.ts` decides *which* charts qualify with its own private set (see gotchas) |
| migrations → viz | `lib/database/migrations.ts` (v37), `app/api/viz/backfill/route.ts` | `vizSettingsToEnvelopeStatic`; `vizSettings` is never modified, so both are rerun-safe |
| viz → data | `lib/database/duckdb.ts` | `TableV2` column stats and `lib/chart/histogram.ts` load result rows into DuckDB to compute stats/histograms |

ESLint (`frontend/eslint.config.mjs`) bans Chakra imports under `components/plotx/**` and
`components/viz/**.tsx` — these are on the Tailwind + `components/kit` stack.

## Gotchas

- **The legend plan and x-label angle are baked in before `parse`.** They are computed in plain
  JS from real labels and the true container width, not by Vega signals: a signal expression on
  `legend.columns` is evaluated against an unsettled width and never re-flows. A container that
  mounts at ~0 width (a dashboard tile) therefore re-plans after layout and rebuilds the view once.
- **`view.tooltip()` must be called before the first `runAsync()`.** It re-initializes the
  renderer, which synchronously clears the SVG. Calling it after the first render wipes the chart
  with no error and nothing repaints until the next interaction.
- **Facet shared tooltips must hit-test the compiled `cell` scopes.** A facet view reports a
  root width of zero and its shared x scale returns child-local pixels. `facet-tooltip.ts` finds
  the hovered scope from scenegraph bounds; `VegaChart` subtracts that cell origin and filters the
  tooltip index by its facet datum. Treating a facet like a unit chart mixes panels and never snaps.
- **Vega logs dataflow errors instead of rejecting `runAsync`.** `VegaChart` installs a custom
  logger and promotes the first logged error to a throw, otherwise a broken spec renders as a
  silent blank card.
- **Specs and rows must be cloned before they reach Vega.** They arrive immer-frozen from Redux,
  and vega-lite normalizes specs in place while vega tags every tuple with `Symbol(vega_id)`.
  `compileVegaLite` deep-clones the spec; `setMainData` and `injectNamedAssets` shallow-clone rows
  and features.
- **Font attributes are promoted to inline styles.** Vega writes fonts as SVG presentation
  attributes, which lose to any author CSS rule (including Chakra's universal preflight); a
  `MutationObserver` re-promotes them after every re-render. Separately, the build effect awaits
  `document.fonts.ready` — measuring with the fallback font under-reserves every label.
- **The converter's static path deliberately under-types.** An ambiguous column name (`month`,
  `year`, `week`) stays `nominal`, because typing label strings as `temporal` breaks the axis
  while `nominal` merely renders plainer. It self-heals on the first render with real columns.
- **Empty-string vs missing recipe bindings.** `materializeRecipe` treats `''` and `[]` as
  missing and returns `{ok: false, error}` naming the slots — envelopes are never partially built.
- **Legend/tooltip injections are additive-only.** `injectLegendToggle` bails on composite marks
  (`boxplot`/`errorbar`/`errorband`), because Vega-Lite silently drops the selection param but
  still compiles the opacity condition, leaving a dangling `Unrecognized signal name` at runtime.
- **Interactive maps are detected by capability, not recipe id — and by one shared predicate.**
  `lib/viz/interactive-map.ts` looks for an `mxViewParams` signal (the recipe ids
  `minusx/point-map@1` / `minusx/choropleth@1` are only a fast path), so a *detached* map keeps its
  pan/zoom and persistence. It exports two entry points because the two callers hold different things:
  `isInteractiveMapEnvelope` (an envelope — `components/viz/VegaChart.tsx`) and
  `isInteractiveMapContent` (question content — `components/containers/SmartEmbeddedQuestionContainer.tsx`).
  The content form checks `viz` **before** legacy `vizSettings` and never both; reversing that
  misclassifies every file carrying both.
- **The dashboard tile's edit-mode drag surface must not cover an interactive chart.** In edit mode
  `SmartEmbeddedQuestionContainer` lays a `.drag-handle` over the card so the whole tile is grabbable —
  correct for a static chart, fatal for a map: the overlay is what the browser hit-tests, so Vega never
  receives the wheel, the drag or the hover, and pan, zoom and tooltips are all dead on precisely the
  charts that have them. Interactive tiles get a header-height strip instead; static ones keep the
  full-card overlay with a clip-path notch sparing the bottom-right 24px so the zoom buttons stay
  clickable. Both sides read `lib/viz/interactive-map.ts`, so they cannot drift apart again.
- **Vega binds `window:` event sources to its own realm, so drag-pan is dead inside an iframe.** Every
  pan stream ends in `[pointerdown, window:pointerup] > window:pointermove`, and vega-view resolves
  `window` to the realm its CODE runs in — the parent. Story and dashboard charts render into an iframe
  document, so their moves and ups fire on the IFRAME window and never arrive: element-level click and
  wheel work, pan does not. `bridgeIframeDragEvents` (`lib/viz/iframe-event-bridge.ts`, installed by
  `VegaChart`, a no-op in the main document) re-dispatches the iframe window's move/end events onto the
  parent, but ONLY between a down on the chart container and the matching end, so nothing leaks into
  parent listeners outside a chart-initiated drag. Three details are load-bearing: cloning detects by
  TYPE STRING because cross-realm `instanceof PointerEvent` is always false; listeners attach in the
  CAPTURE phase because chart-stack handlers `stopPropagation` mid-path; and a 150ms grace window after
  the first end event forwards the compatibility sibling (`pointerup` then `mouseup`), since a
  mouse-stream spec closes its pan gate only on `window:mouseup` and a dropped sibling leaves the chart
  panning on bare hovers.
- **The chart-image gate and the render gate disagree by design.** `RENDERABLE_CHART_TYPES`
  (V1, 10 types) excludes `trend`, `single_value` and the geo types, but `isEnvelopeImageViz`
  (V2) includes every non-DOM kind. A legacy `trend` question renders on screen but produces no
  tool image; the same chart as a `minusx/trend@1` envelope does.
- **`validateVizRemote` fails open.** No network, no validation — the bad spec lands and surfaces
  at render instead.
- **Slack keeps its own private renderable set.** `lib/integrations/slack/messages.ts` defines a
  local `RENDERABLE_CHART_TYPES` of six types (`line bar area scatter pie funnel`) that is
  narrower than `lib/chart/renderable-types.ts` — a legacy `row`/`waterfall`/`radar`/`combo`
  ExecuteQuery result posts to Slack with no chart image and no error.
- **`lib/viz/tooltip-styles.ts` injects into the chart's `ownerDocument`.** Charts render inside
  story/dashboard iframes; `globals.css` only styles the app document, and vega-tooltip's own
  handler closes over the wrong realm's `document` (hence `lib/viz/vega-tooltip-handler.ts`).
- **A wrong field name is not a Vega-Lite error.** Vega-Lite compiles and renders a spec that
  references a column the query result does not have — as an empty chart, with no warning anywhere.
  That is why `lib/viz/validate.ts` walks field references against the actual result columns as its
  own stage rather than trusting the package schema, which cannot see the data.
- **CSP-safe rendering needs both halves.** `parse(spec, config, { ast: true })` and
  `new View(runtime, { expr: expressionInterpreter })` are one mechanism in `lib/viz/render-vega.ts`.
  `ast: true` only changes how expressions are *stored*; the interpreter is what evaluates them
  without `new Function`. Drop either half and rendering keeps working wherever no CSP is enforced,
  then breaks only in the environments that matter. Interpreter mode is CSP *compatibility*, not a
  boundary against untrusted specs — that boundary is `lib/viz/validate.ts` (external `data.url`
  rejected, `main` the only bound dataset, boundaries only from the named-asset allowlist). Every
  mounted view is `finalize()`d when it is torn down.

## Design rules

**Chart types are data, not components.** MinusX owns the envelope, the data binding, the theme,
validation and security; visualization *semantics* live in the Vega/Vega-Lite grammar and in
versioned recipes. Adding a chart shape therefore normally adds no rendering code: a new spec shape
needs none at all, and a new recipe is one entry in `lib/viz/viz-templates.ts`. `trend` and
`single_value` ship as recipes specifically so they add no DOM leaf renderer, and the editor's
controls are generated from envelope metadata — binding zones from `getEnvelopeZones`, per-recipe
controls from a recipe's declared `params` — rather than written per chart type. A per-type React
renderer or a per-type settings panel is the anti-pattern this design exists to prevent.

**Grammar versions are pinned as a correctness contract.** `grammar` is a literal on every
grammar-bearing source — `vega-lite@6` on `VizSourceVegaLite`, `vega@6` on `VizSourceVega`
(`VIZ_GRAMMAR_VEGA_LITE` / `VIZ_GRAMMAR_VEGA` in `lib/validation/atlas-schemas.ts`) — recorded
separately from the envelope's `version`. Specs validate against the schema exported by the
*installed* Vega-Lite package; `$schema` is never fetched from the network. Bumping Vega or
Vega-Lite to a new major is therefore an explicit migration with visual regression checks, not a
dependency update: a saved spec must never be silently reinterpreted by a newer grammar.

**Where a transformation belongs.** Business semantics — joins, governed metrics, expensive
calculations, the major aggregation — belong in SQL. Presentation-oriented reshaping — `fold`,
`window`, `stack`, ranking, regression, binning — belongs in the grammar, because that is what lets
one recipe work across datasets. Display naming and number/date formatting belong in neither: they
are `columnFormats` (`alias` plus a d3 `format`, carried on every source kind and applied at
materialization). Renaming a column in SQL to change a chart label breaks every other consumer of
that query and every field reference in the spec — change the display, never the result column.

**On the DOM tier the only persisted state is display.** `VizSourceTable` and `VizSourcePivot`
store `columnFormats`, `conditionalFormats`, the scoped `css`, and (for pivot) the `config`
structure. Sorting, filtering and column visibility are deliberately ephemeral UI state and are
never written back to the file — a reader's transient sort must not become part of the document.

**The V1 image gate's exclusions are a judgement about what an image adds**, not a gap in the
renderer. `table` and `pivot` are excluded because the data is the visualization — the LLM already
receives the full query result as rows and can read pivoted values off them, so a picture of a
table is strictly less useful than the table. `trend` and `single_value` are excluded because they
are textual KPI cards: the model already has the number and the delta, and an image of
"8,801 +12.3%" carries no information the numbers do not. The geo types are excluded for a
different reason — the server path is SVG and cannot draw map tiles.

**Four `VizEnvelope` fields are RESERVED — not yet implemented, omit them**: `dataBindings`
(query-param bindings that re-execute), `viewParams` (presentation-only signals), `interactions`
(typed interaction outputs) and `assets` (envelope-level named-asset refs; the *live* asset map is
`VizSourceVega.assets`). They are schema-present so a saved envelope never needs a shape migration
when they land, and they are deliberately four namespaces rather than one `params` grab-bag —
re-executing a query, moving a presentation signal and emitting a selection event have three
different lifecycles.

## Key files

| Task | File |
|---|---|
| Add a viz type | `lib/validation/atlas-schemas.ts` (`VIZ_TYPES`) → `lib/viz/from-vizsettings.ts` switch → `components/question/VizTypeSelector.tsx` |
| Add/change a recipe | `lib/viz/viz-templates.ts` (`VIZ_TEMPLATES`; bump `@2`, never mutate `@1`) |
| Change how any chart is compiled or themed | `lib/viz/render-vega.ts`, `lib/viz/theme.ts` |
| Change a panel control / add a spec edit | `lib/viz/encoding-edit.ts` + `components/viz/VegaVizPanel.tsx` |
| Change agent-facing validation | `lib/viz/validate.ts`, `lib/viz/types.ts`, `lib/viz/validate-remote.ts` |
| Change server chart images | `lib/chart/render-viz-image.ts`, `lib/chart/svg-to-jpeg.ts`, `lib/chart/ChartImageRenderer.server.ts` |
| Change browser chart images / download | `lib/chart/VizImageRenderer.client.ts`, `lib/chart/render-chart-client.ts`, `components/viz/ChartDownloadMenu.tsx` |
| Change the table | `components/plotx/TableV2.tsx` (shell/`<col>`), `components/plotx/TableBody.tsx` (rows/cells), `components/plotx/TableHeaderCell.tsx` (headers), `components/viz/VizTableView.tsx`, `components/plotx/table-v2-utils.ts` |
| Change the `.mx-*` class contract | the emitting component **and** the `css` descriptions in `lib/validation/atlas-schemas.ts` **and** the help text in `components/viz/VegaVizPanel.tsx` |
| Change which charts count as interactive | `lib/viz/interactive-map.ts` (both `VegaChart` and the dashboard tile read it) |
| Change the pivot | `lib/chart/pivot-utils.ts` (aggregation), `lib/chart/pivot-grid.ts` (layout), `components/plotx/PivotTable.tsx` |
| Add a boundary map | `lib/viz/geo-assets.ts` + a file under `public/geojson/` |
| Change number/date formatting | `lib/chart/chart-format.ts` (d3 presets, `formatLargeNumber`, `formatDateValue`) |
| Change the palette or theme tokens | `lib/chart/chart-theme.ts`, `lib/viz/chart-tokens.ts` |
| Change how a SQL type becomes a viz column kind | `lib/viz/query-data.ts` |

---
