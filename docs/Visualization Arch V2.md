# Visualization Arch V2

> **Status (2026-07-11):** Active dual-stack implementation. The Vega/Vega-Lite render pipeline,
> shipped recipes, table/pivot DOM tier, validation, themes, and editor panel are working. Legacy
> `vizSettings` remains during migration. Three evidence questions remain in §19; the canonical
> delivery roadmap is §21.

## Document map

- **Parts I–IV** define the target architecture and platform contracts.
- **Part V** records delivery strategy, unresolved evidence, decisions, and the canonical roadmap.
- **Appendix A** is implementation evidence: plot coverage and verified behavior.
- **Appendix B** is a code map plus dated implementation decisions. It is historical context, not
  a second roadmap.

Where the target architecture is ahead of the probe, the document says so explicitly. Current code
must not be inferred from a target-state type example alone.

---

## Part I — Core contract and rendering

### 1. Summary

The `viz-styles-prop` branch (abandoned, salvage-later) was re-implementing a visualization grammar
piecewise — curated style levers, a per-type capabilities matrix, a bespoke style cascade, ECharts/CSS escape
hatches — without gaining the power or compiler maturity of an established one. The expressiveness ceiling was
whatever we had hand-coded; the agent was hobbled by construction.

**V2 adopts Vega-Lite as the normal agent contract and native Vega as the advanced contract.** MinusX owns the
document envelope, data binding, themes, validation, security, and UI — not visualization semantics. Chart
types stop being application-level renderer components and become data: specs and versioned recipes. A new
chart type normally requires **zero new MinusX rendering code**.

The rollout began probe-first and is now in the hardening phase: the `vega-lite` source runs beside the legacy
renderer, shipped recipes exercise native Vega, and table/pivot use the DOM tier. The next gate is completing
agent visibility, export, public surfaces, and operational evidence before family-by-family migration (§18, §21).

**Current implementation snapshot:** persisted V2 sources are `vega-lite`, `recipe`, `table`, and `pivot`.
Native Vega is currently reached through shipped recipe materialization. `builder`, directly-authored `vega`,
`slippy-map`, persisted derived artifacts, workspace recipe files, shared `fieldMeta`, and typed interaction
outputs remain target-state work. Shipped recipes currently materialize at render time from a trusted registry;
the persisted/materialized workspace-recipe lifecycle in §5 is the target contract.

### 2. The envelope

MinusX owns a small envelope; grammar semantics live inside `source`:

```json
{
  "version": 2,
  "source": { "kind": "vega-lite", "grammar": "vega-lite@6", "spec": { "mark": "bar", "encoding": { "…": "…" } } },
  "fieldMeta": { "…": "…" },
  "dataBindings": {},
  "viewParams": {},
  "interactions": { "outputs": {} },
  "assets": {}
}
```

- **`grammar`** is recorded on every grammar-bearing source (and inside every derived artifact, §3), separately
  from the envelope version — `vega-lite@6` / `vega@6`. MinusX pins runtime/compiler package versions and
  validates with the official schema exported by the installed Vega-Lite package; `$schema` is never fetched
  from the network. A Vega/Vega-Lite upgrade is
  an explicit migration with visual regression tests — saved specs are not silently reinterpreted by a new
  major version.
- **Placement:** a new `content.viz` key on question content. New content writes `viz`; legacy `vizSettings` is
  never mutated in place and renders through the compatibility adapter (§18). If both fields are temporarily
  present, **`viz` is authoritative** and save-time validation rejects contradictory states.
- **TypeBox rule:** only the MinusX envelope is TypeBox in `atlas-schemas.ts` — `version`, the `source`
  discriminator, `fieldMeta`, param namespaces, `assets`, recipe provenance, and derived-artifact metadata.
  Spec bodies are `Type.Unknown` there and validated by the package-provided official schema plus the MinusX
  field/security passes (§11–12). **Do not reproduce the Vega/VL grammars in TypeBox or paste them into
  prompts.**

### 3. One authoritative source, and the render flow

Each visualization has exactly one authoritative source. The union below is the **target state**; the shipped
subset is listed in §1.

```ts
type DerivedSpec = {
  grammar: 'vega-lite@6' | 'vega@6'
  spec: object
  sourceHash: string       // hash of the authoritative source + compiler/recipe versions
  compilerVersion: string
}

type VizSource =
  | { kind: 'builder';    builder: SimpleBuilder; compiled: DerivedSpec }
  | { kind: 'recipe';     recipe: string /* e.g. 'minusx/trend@1' */; bindings: object; params: object; materialized: DerivedSpec }
  | { kind: 'vega-lite';  grammar: 'vega-lite@6'; spec: object }
  | { kind: 'vega';       grammar: 'vega@6'; spec: object }
  | { kind: 'table';      spec: TableSpec }
  | { kind: 'pivot';      spec: PivotSpec }
  | { kind: 'slippy-map'; spec: SlippyMapSpec }
```

```text
builder --------> Vega-Lite --+
recipe ---------> VL or Vega -+--> Vega runtime
native VL ------> Vega -------+
native Vega ------------------+

table / pivot --------------------> virtualized DOM grid
slippy-map -----------------------> tile renderer (Leaflet)
```

- **Builder and recipe sources are compilers, not renderers.** They compile at save time and persist their
  native output as the system-managed `DerivedSpec` artifact, stamped with a hash of the authoritative source
  plus compiler/recipe versions. **Theme config stays external and is never baked into the artifact.** Guest,
  server, export, and image-attachment paths render the materialized output without running the
  builder/recipe compiler. The artifact is never independently editable: the **schema, not agent convention,
  prevents builder/spec divergence** — save-time validation rejects stale or directly-edited derived specs and
  regenerates them deterministically.
- **Detach is a deliberate one-way operation** that replaces the source with the materialized native spec
  (`kind` flips in the same write); the materialized spec then becomes authoritative. The UI never parses an
  advanced spec into a simplified model and rewrites it — no UI operation may discard unknown spec structure.
- A Vega-Lite source is named `vega-lite`; native Vega is a separate `vega` source with its own schema and
  authoring guide. Never conflate them.

#### React component boundary

One public component:

```tsx
<Viz definition={viz} data={queryResult} theme={theme} container={container} />
```

`<Viz>` is a dispatcher. Exactly **three permanent leaf renderers**:

- `<VegaRenderer>` — Vega-Lite and native Vega (all grammar kinds). Owns compile → parse (`ast` + interpreter)
  → mount → resize → theme recompile → finalize-on-unmount. A headless sibling serves server preview/export and
  the chart→LLM image pipeline.
- `<GridView>` — one shared virtualized grid for table and pivot (§10).
- `<SlippyMapRenderer>` — the frozen Leaflet surface for tile-backed maps (§9).
- `<LegacyVizRenderer>` — temporary, for unmigrated ECharts content; deleted per-family at parity (§18).

**Every visualization surface — questions, dashboards, stories, notebooks, chat detail cards, image
attachments — must use this same entry point or its headless sibling.**

Zero React components per chart type. `<BarPlot>`, `<LinePlot>`, `<TrendPlot>`, `<RadarPlot>`, `<ComboPlot>`, …
disappear after migration. Surviving editor chrome is generated from metadata (builder zones, `fieldMeta`
controls, recipe `params` controls, a generic theme panel), not written per type. Trend and `single_value`
remain on the recipe path; they do not add DOM chart leaf renderers.

### 4. Grammar tiers

- **`vega-lite` — the default for almost all charts.** The x/y/split vs y1/y2 distinction dissolves into the
  grammar (`color` encoding vs `fold`/layers); composition is native (`layer`, `facet`, `concat`, dual-axis via
  scale resolution); the compiler owns scales, label overlap, legend layout, axis inference.
- **`vega` — the advanced tier** for geometry/interaction VL cannot express (radar, density maps, precise KPI
  composition). Structured, validated JSON — not an arbitrary-code escape hatch — but verbose and less familiar
  to agents: **prefer versioned recipes for common full-Vega shapes**, materialize only when deeper editing is
  necessary.
- **Why not raw ECharts options:** cheaper migration, but no layout compiler (manual grid/margin management),
  silent failures on invalid options, callback-dependent advanced behavior, no grammar model. It remains the
  documented fallback if the probe fails, not the preferred surface.

## Part II — Authoring and presentation

### 5. Recipes

A recipe is an authoring shortcut and reusable artifact — not another renderer or second grammar.

**Current probe vs target contract:** shipped `minusx/*` recipes are trusted TypeScript build functions in the
local registry and materialize at render time. The declarative, publishable workspace-recipe contract below is
the required next form before recipes become user-authored files.

**Contract:** immutable versioned id; a native Vega or Vega-Lite body; typed field bindings; named-signal
params with declarative UI-control metadata; full validation at publish time; a materialize operation. No
executable template functions, no string interpolation, no arbitrary markup.

```json
{
  "id": "minusx/trend@1",
  "engine": "vega",
  "bindings": { "date": {"accepts": ["temporal"]}, "value": {"accepts": ["quantitative"]} },
  "params": {
    "valueFontSize": {"type": "number", "default": 64, "min": 20, "max": 120},
    "positiveColor": {"type": "color", "default": "#16a38b"}
  },
  "spec": { "…": "…" }
}
```

**Binding mechanism — narrow and declarative.** A recipe declares typed slots as **structural placeholder
nodes, never string templating**: a field slot appears only where a native field reference would appear —
`{"field": {"$binding": "dimension"}}` — and materialization replaces exactly those nodes. Every `$binding`
must be declared in the recipe's typed binding schema. Params map only to named signals declared by the recipe
and override those signals' initial values. Positional/structural addressing is acceptable *inside* an
immutable, content-hashed recipe because body and binding metadata change together; it is **not** acceptable as
an external patch against a saved visualization owned by another file. Publish-time validation ensures all
placeholders and params resolve, expands the recipe, and validates the fully materialized result against the
official grammar schema. No other substitution mechanism exists.

**Lifecycle & storage:** a `viz_recipe` workspace file type (introduced after the contract passes the spike).
Shipped recipes use the reserved `minusx/` namespace (`minusx/trend@1`, `minusx/radar@1`); workspace recipes
use an org namespace and cannot shadow shipped ids. Drafts are mutable; published versions are immutable and
content-hashed; editing a published recipe creates a new version. Org-wide publication follows the existing
permission model (authorized publisher/admin).

**Instances always materialize:** an instance stores the fully materialized spec *plus* the recipe ref
`{id, version, contentHash}` and bindings/params. The materialized spec is what renders — recipe deletion
breaks nothing, public stories carry no dependency on mutable workspace state, and there is no runtime recipe
resolution. The ref is provenance plus the affordance for re-parameterization and explicit (never automatic)
upgrades.

**Discovery:** a compact generated catalog in the visualizations skill (id, one-line description, bindings
summary — the live prompt-vars pattern) plus `SearchFiles` for workspace recipes. Full bodies load on demand.

**Custom marks:** reserved for a genuinely new geometric primitive that cannot be composed from standard marks.
Neither trend nor radar meets that bar; Vega has no spec-level mark plugin API and forking the renderer is
forbidden.

### 6. Field metadata (`fieldMeta`)

One small renderer-neutral layer shared by charts, recipes, tables, and pivots:

```json
{ "fieldMeta": {
    "order_month":     { "title": "Month",  "format": {"kind": "time",   "pattern": "%b %Y"} },
    "conversion_rate": { "title": "Conv %", "format": {"kind": "number", "pattern": ".1%"} } } }
```

- **D3 number/time patterns** are the format vocabulary (Vega/VL understand them natively). UI presets
  (Currency, Percent, `MMM YYYY`) compile to D3 patterns; `prefix`/`suffix` survive as convenience fields.
  New writes emit D3 patterns from day one; existing Unicode/date-fns formats remain readable through the
  explicitly versioned format object (`format.kind` discriminates) — saved content is never silently rewritten.
- The compiler applies `fieldMeta` **only where a native title/format is absent** — explicit spec values win.
  Detached specs therefore keep the global rename/format UI. Applies to axes, legends, tooltips, text marks,
  recipe labels, table headers/cells, pivot values.
- `fieldMeta` is keyed by **query-result columns only**; fields created inside spec transforms are styled
  in-spec.
- SQL result types are the initial type inference; an encoding may explicitly override (numeric ID as nominal).

### 7. Themes

**Two separate mechanisms — never one giant precedence chain** (that would rebuild the branch's cascade under
new names):

**Mechanism A — external theme config (config domain only):**

```text
MinusX config < organization config < dashboard/story config
```

Config objects merged with documented config-aware semantics (nested objects merge; ordered values like palette
arrays replace), passed as external compiler/parser config. Vega/VL then apply their native rule that
spec-internal `config` wins — MinusX does not recreate that.

**Mechanism B — source normalization (a compiler pass MinusX owns):**

```text
builder/recipe expansion → fieldMeta injection (absent-only) → recipe params → validate native spec
```

**Dark/light from day one:** one MinusX token module *generates* all artifacts — VL light/dark configs, Vega
parser configs, and stable theme signals (`mxForeground`, `mxBackground`, `mxPositive`, `mxNegative`,
`mxFontSizeScale`) — so tiers cannot drift. VL views recompile on mode change; native Vega recipes built on
theme signals may signal-update when safe, otherwise reparse; the exact boundary remains an evidence item
(§19, §21.8). Explicit spec colors are never silently rewritten. Canvas/SVG marks must not depend on
application CSS variables.

**Deleted outright:** indexed color keys, percentage opacity controls, `dataLabelColor`, colorScale enums, and
kin. Native colors/schemes, 0–1 opacity, native mark/encoding properties.

### 8. Story & embed semantics

- Story/embed config supplies **theme defaults only** — it cannot replace properties explicitly set inside a
  spec.
- Stable named recipe params handle supported per-instance changes.
- A structural change or an override of explicit spec properties **materializes/forks the spec** so the embed
  owns its copy. Forks record provenance (`forkedFrom: {fileId, contentHash}`) so the UI can show "restyled
  copy of Q123" and offer *manual* re-sync.
- **Forbidden:** positional JSON Patch against a saved visualization (silently changes meaning when `/layer/1`
  reorders) and generic deep-merging of `layer`/`transform`/`params` arrays.

## Part III — Specialized surfaces

### 9. Geographic visualization

All analytic geo converges on Vega/VL through `<VegaRenderer>`:

| Current behavior | Grammar implementation |
|---|---|
| Choropleth | `geoshape` + `lookup` join + color encoding (VL) |
| Lat/lng points, bubble radius, point color | circle marks on `longitude`/`latitude` + `size`/`color` encodings (VL) |
| Origin→destination lines | geographic `rule` with lon/lat pairs (VL); great-circle paths via Vega geopath |
| Density heatmap | Vega `geopoint` → `kde2d` → heatmap (recipe) |
| Labels/annotations, multi-layer, vector pan/zoom | layered marks; projection signals (Vega) |

Shipped recipes: `minusx/choropleth@1`, `minusx/bubble-map@1`, `minusx/flow-map@1`, `minusx/density-map@1`,
`minusx/zoomable-map@1`. The old bespoke options map to native scales (`minRadius`/`radiusScale` → size scale
range; colorScale enums → `scale.scheme`; `pinnedCenter`/`pinnedZoom` → projection params).

**Boundary data** (`topo:`/GeoJSON) comes from the approved named-asset registry (§12) — never network URLs.

**The tile exception:** Vega is not a slippy-tile manager (tile pyramids, caching, street labels,
attribution). Tiles are a product requirement, so Leaflet stays — **restricted to the explicitly named
`slippy-map` source** so the tile renderer can never re-absorb bubbles/flows/choropleths. New maps default to
the Vega recipes; a future tile-engine change must not affect the recipe contract. There is no generic "geo"
renderer.

### 10. Table & pivot

Same envelope, DOM rendering — VL's `pivot` transform reshapes data but is not a production pivot grid
(virtualized rows/columns, nested sticky headers, expand/collapse, totals, accessible grid navigation).

- **Pivot splits into two non-overlapping layers:** a pure data engine (header trees, aggregates, totals,
  cells — `aggregatePivotData` stays pure TS) and a virtualized React grid that only presents/interacts.
- **Pivot is a table with a data transform and a hierarchical column tree.** Plain table supplies
  `(rows, flatColumnTree, cellMeta)`; pivot supplies `(crossTabRows, nestedColumnTree, cellMeta)`. Both render
  through the one `<GridView>`, so virtualization, striping, conditional formatting, selection, `fieldMeta`,
  accessibility, and slot styling are implemented once. Pivot's structured `spec` (rows/columns/values, totals,
  `cellEncoding`) stays agent-authorable.
- Both receive the common platform behavior: data binding, `fieldMeta`, theme defaults, validation/feedback,
  container sizing, export.
- A `minusx/` recipe may offer "visualize this pivot as a heatmap" when the desired output is a chart.
- Widget presentation uses **named slots with allowlisted CSS properties/values**. Arbitrary markup/CSS widget
  templates are **out of V1** (another language plus sanitization/a11y/security obligations before the
  architecture is proven).

## Part IV — Platform guarantees

### 11. Validation & agent feedback

`ValidateVisualization` / the preview path returns, in order:

1. JSON Schema errors with JSON Pointer paths (official package-provided schema).
2. `E_FIELD_NOT_FOUND` — a **field-aware pass** walks all field references and compares against actual
   query-result columns and inferred types, with suggestions
   (`"margin_pct" is not in the query result. Available quantitative fields: margin_percentage, …`).
   Schema validation alone cannot catch this; VL renders wrong fields as a silently empty chart.
3. Type mismatches and invalid transforms.
4. Captured VL compiler warnings (never silent).
5. Runtime parse/render errors.
6. A rendered preview image (the agent sees what it made).

- **The field walker is one shared deliverable**: the same traversal powers `E_FIELD_NOT_FOUND` and `fieldMeta`
  injection. Build once, probe step 1.
- **Dynamic field access** (Vega expressions) cannot always be inferred: recipe expansion resolves typed
  bindings into static references wherever possible; a native spec using dynamic access must declare its
  expected fields in `usermeta.minusx.fields`, checked against the result schema; otherwise
  `W_DYNAMIC_FIELD_UNVERIFIED`.
- The agent surface stays compact: a pinned-version VL guide with common examples, on-demand Vega
  instructions, the validator, and the result columns/types. No per-chart quirk documentation.
- **Authoring syntax (EditFile/markup):** the spec stays JSON — in-distribution VL-JSON is the point — but it
  is delivered **as a raw element body** in the file markup (a `format: 'json'` codec in `content-jsx`, the
  same mechanism as the story body's `format: 'jsx'`), never as an escaped JSON string value and never
  JSX-ified into elements. Element text bodies need no escaping (literal newlines/quotes — the same reason SQL
  bodies work), which eliminates the historical `\n`/`\"` corruption class entirely: quotes in the spec are
  single-level, there is no escaping context.
- **Lenient-in, canonical-out parsing:** strict `JSON.parse` first; on failure, a tolerant JSON5/jsonc pass
  (trailing commas, comments, single quotes — the "JS-object-mode" slip class). If the tolerant pass succeeds,
  the edit is accepted, the stored spec is the canonicalized strict JSON, and the tool result notes what was
  normalized. Only a double failure surfaces an error — with line/column — before `ValidateVisualization`
  takes over for semantic feedback. JSON-syntax-error-rate-per-EditFile is a probe metric; escalate the
  tolerance policy only if the measurement demands it.

### 12. Security

One policy, one module, applied identically to editing previews, saved questions, image export, and
guest-rendered public stories:

- **CSP-safe expressions everywhere:** `vega.parse(spec, config, { ast: true })` **and**
  `new vega.View(runtime, { expr: vega.expressionInterpreter, … })` — `ast: true` alone does nothing.
  Interpreter mode is CSP compatibility, not a complete untrusted-spec boundary, and has a perf cost
  (benchmarked, §17).
- **No arbitrary network access:** external `data.url`/`data.format` rejected; the query result is injected
  under the reserved name `main`; secondary data (boundaries, lookup tables) only via the MinusX **named
  asset/dataset registry** — permission-checked, content-hashed, size-limited, available to client and server
  renderers, packaged/materialized for public stories.
- Links/images/extensions/custom expression functions restricted; event config denies window/timer/CSS-selector
  sources unless a reviewed interaction needs them; every mounted view finalized on unmount.
- Limits on data volume, generated marks, transform depth, and render time (numbers from the spike, §17/§19).

### 13. Parameters & interactions

Reserved envelope namespaces — never one grab-bag `params` object:

- `dataBindings` — query/data params; re-execute the query (binds the existing `:param` system; no new
  machinery).
- `viewParams` — presentation-only; recipe params / named signals (lands with recipes). The `mx` signal-name
  prefix is reserved for platform/theme/system signals; the validator rejects agent-authored specs and
  workspace recipes that define conflicting names.
- `interactions.outputs` — selections emit **MinusX-owned typed events**
  (`{"type": "filter", "field": "region", "operator": "in", "values": ["West"]}`) for future cross-filtering.
  Arbitrary Vega signals are never passed between visualizations. Reserved now, implemented later.

### 14. SQL vs visualization transforms

Business semantics, joins, governed metrics, expensive calculations, and major aggregations belong in SQL.
Presentation-oriented reshaping (`fold`, `window`, `stack`, ranking, regression, binning) belongs in the
grammar when it makes the visualization reusable — it is what lets a recipe work across datasets.

**Trend semantics:** ordinary previous-row/period comparison lives in the recipe transforms. "Skip the partial
current period" is not universally inferable (fiscal calendars, delayed ingestion): the query either excludes
incomplete rows or returns an explicit `is_complete` field the recipe binds/filters. **No new
application-owned comparison logic**; the legacy adapter preserves current behavior until migration.

### 15. Sizing & accessibility contracts

- **Container sizing is a platform contract:** MinusX owns the outer card/chrome; the visualization owns its
  internal view. Builder output and recipes default to container-supplied responsive width/height with
  documented autosize/padding. Native specs may opt into fixed dimensions; the UI/validator warns when fixed
  sizing will likely clip in dashboards/stories.
- **Accessibility is a publication gate, not post-migration cleanup:** every visualization needs a
  human-readable description/ARIA label, keyboard-safe interactions, and a "view data" fallback from the bound
  query result. Recipes declare a default accessible description template. Vega's generated SVG ARIA is useful
  but not sufficient alone.

## Part V — Delivery, evidence, and decisions

### 16. Type mapping

| Current type | V2 implementation |
|---|---|
| bar, row, line, area, scatter, pie | Vega-Lite |
| combo / dual-axis | `minusx/combo@1`, Vega-Lite layers + independent scale resolution |
| waterfall | VL transforms + layered marks |
| trend | `minusx/trend@1`, native Vega recipe (decision complete) |
| single_value | `minusx/single-value@1`, native Vega recipe; first query row, not a DOM widget |
| radar | `minusx/radar@1`, native Vega recipe (the pure recipe-contract test; requires an explicit domain strategy — shared fixed domain, normalized values, or per-metric bounds — compiler warns on unlike scales) |
| funnel | VL where practical; otherwise native Vega recipe |
| geo (choropleth/points/lines/density) | VL / Vega recipes (§9) |
| tiled maps | `slippy-map` (Leaflet), tile-backed only |
| table, pivot | virtualized DOM grids (§10) |

### 17. Evidence and benchmark protocol

Parity cases:

1. Simple bar chart.
2. Split-series chart.
3. Multiple wide-form measures.
4. Dual-axis bar+line.
5. **Trend KPI built both ways** (Vega recipe vs DOM widget) with period comparison + sparkline, judged against
   the acceptance criteria below.
6. Story-themed layered visualization: config defaults + named recipe params + an owned-spec fork.
7. Normalized multi-series radar recipe.
8. Geo: choropleth + bubble overlay from recipes over registry TopoJSON, plus a full-Vega density map.

**Trend result:** the native Vega recipe passed the decision rule; `single_value` follows the recipe path.
The acceptance criteria remain regression requirements: responsive at card/dashboard/story widths; independently adjustable
value/delta/label/date font sizes; light+dark; last-period and skip-partial-period comparison; optional
sparkline; prefix/suffix + D3 formatting; browser/exported-SVG parity; accessible label; no clipping across
font sizes; no application-owned comparison calculation for presentational semantics. The architectural success
criterion: a new KPI archetype authored, styled, and reused **without TypeScript**.

**The spike must measure** (no numbers copied from generic estimates; ECharts compared on representative MinusX
pages): lazy-loaded bundle cost in the production build; 1 view vs ~20 mounted views; lazy mount/virtualization
and finalization off-viewport; SVG vs canvas; mount/resize/mode-change/teardown times; memory after navigating
away; 1k/10k/max result sizes; CSP interpreter mode client and server; browser vs server image parity;
JetBrains Mono loading; tooltips, drilldown, CSV download, image export; public-story rendering under
production CSP; mobile/narrow containers; timezone-sensitive temporal fields; structured errors for misspelled
fields; chart-to-agent image attachments so the agent can inspect its rendered result in follow-up turns.

**Temporal rule:** query-result column metadata is the source of truth; normalize recognized temporal values
*before* data enters Vega (no heuristic per-spec parsing); distinguish date-only, local datetime, and tz-aware
timestamps; test DST boundaries; client and server must render identical axis values.

### 18. Migration path

1. **Probe (greenlit, ships themed):** `content.viz` with a `vega-lite` source + renderer beside the legacy
   stack — named data binding, schema + field-aware validation, captured compiler warnings, CSP-safe rendering,
   preview/export images, and the MinusX base theme **from day one**. The **chart→LLM image pipeline
   (`buildChartAttachments`) is in probe scope**: without a Vega render path, agent-authored charts are
   invisible to the agent in follow-up turns, contaminating the probe's behavioral evidence. Let the agent work
   with it before committing further.
   **The probe follows contract-first TDD:** define the envelope schema, validator interface, field walker,
   renderer props, and view-factory security policy; write failing tests for schema/field/security errors,
   named data binding, theme config, derived-artifact hashes, and rendering; then implement and
   browser-verify (including the side-chat debug view to confirm what the agent actually receives).
2. Org + story VL config defaults (Mechanism A) — no custom style cascade.
3. Builder source compiling to VL, with detach.
4. Native Vega + `minusx/trend@1` (KPI composition, named signals, story customization) — and the trend
   bake-off (§17).
5. Shared `fieldMeta` with the versioned dual format vocabulary; gradual format migration.
6. `VizSettings` compatibility adapter; migrate per visualization family, never a big-bang data rewrite.
7. `viz_recipe` workspace files + discovery, once the recipe contract has passed the spike.
8. Remove legacy levers, capabilities tables, aggregation paths, and ECharts renderers per family as parity
   gates pass.

**Parity gates per family (all required before deleting a legacy path):** representative visual parity;
interaction/export/story-embed parity; saved-question compatibility; production telemetry showing no remaining
fallback dependence.

**`viz-styles-prop`:** abandoned, not merged. Salvage later against the V2 contract: theme-precedence thinking,
story-vs-embed override tests, the renderer/editor registry idea, column formatting tests.

### 19. Open evidence questions

Three questions still require measurement rather than design debate: operational budgets (§21.7), the boundary
between native-Vega theme signal updates and reparsing (§21.8), and a temporal wire contract that renders
identically across browser, server, exports, and public stories (§21.6). They are work items only in §21.

### 20. Decision log (2026-07-10)

- Merged RFC first; probe starts from this document.
- Probe ships **themed** from day one.
- **Maps are required** → Leaflet stays, restricted to the named `slippy-map` source; all analytic geo moves to
  the grammar; no generic geo renderer.
- `viz-styles-prop` abandoned; salvage later.
- Embeds: config defaults + recipe params + fork-with-provenance; JSON Patch and generic array deep-merge
  rejected.
- Recipes: workspace `viz_recipe` files, `minusx/` reserved namespace, draft→published immutability,
  content-hashed refs, instances always materialize.
- Envelope: new `content.viz` key + legacy adapter; if both `viz` and `vizSettings` are present, `viz` is
  authoritative. Grammar version pinned per grammar-bearing source; builder/recipe sources persist a
  `DerivedSpec` artifact (source hash + compiler version, theme excluded); spec bodies are `Type.Unknown` in
  TypeBox.
- ECharts-options-as-contract: documented fallback only.

### 21. Remaining work — one ordered list

This is the only todo list in this document. Work it top to bottom unless a production issue changes the order.
(Shipped items — all analytic geo recipes, street tiles, interactive pan/zoom + persistence, and the detach
escape hatch — have moved to Appendix A. This list is now driven by **retiring V1** and closing the last gaps.)

**The V1 → V2 retirement track (items 1–5) — sequence is load-bearing: migrate everything, test everything, THEN delete.**

1. **V1→V2 converter + runtime fallback (the keystone).** ✅ **Shipped 2026-07-14** (see Appendix A). The pure
   `vizSettingsToEnvelope(vizSettings, columns?)` (`lib/viz/from-vizsettings.ts`) covers every V1 type and all
   geo subtypes; the render-only bridge (`resolveLegacyRenderEnvelope`, wired into `QuestionVisualization`)
   routes legacy no-`viz` charts on READ-ONLY surfaces through `<VegaChart>`. Editable surfaces keep the V1
   `ChartBuilder` (nothing persists yet — the picture re-derives from `vizSettings` each render, so V1 edits
   still flow through); the editable cutover happens when **item 4** actually writes the envelope. Unblocks 2–5.
2. **Chart → image artifact pipeline.** Two paths, one encoder target (JPEG, reusing the S3 `uploadChartOrEmbed`
   path): **client** — `View.toCanvas()` → `toDataURL('image/jpeg')`, the direct analogue of the ECharts
   `clientChartImageRenderer`/`buildChartAttachments` path (runs in the browser, so it captures REAL street
   tiles); **headless** (Slack/cron/server preview) — `renderEnvelopeToSvg` → Resvg/sharp (the `render-chart.ts`
   rasterizer already exists; tile maps fall back to the vector boundary). Teach `isImageViz` +
   `renderFileChartImageBlocks` to recognize a `viz` envelope, not just ECharts `vizSettings.type`. Serves both
   chart→LLM attachments and user image download.
3. **Default new questions to V2.** `lib/data/story/template-defaults.ts` authors a `viz` envelope (`kind:'table'`)
   and STOPS emitting `vizSettings`. New questions are V2-only from here.
4. **Backfill migration.** Bump `LATEST_DATA_VERSION` + add a `MIGRATIONS` entry that writes
   `viz = vizSettingsToEnvelope(...)` for every question still lacking one; sweep dashboard/notebook/story embeds
   (they render referenced questions through the same path); `npm run update-workspace-template`.
5. **Test everything, then big-bang delete V1.** Verify every former V1 type (incl. geo) renders correctly through
   V2 across question/dashboard/notebook/story/guest surfaces — the bake period. THEN, in one sweep: delete the
   ~42 `components/plotx/*` (ChartBuilder, all `*Plot`, GeoPlot/Leaflet, VizConfigPanel/AxisBuilders) + the
   geo-V1 libs (`geo-constraints`/`geo-data`/`geo-*`) + the ECharts image path; drop `vizSettings`/`VizSettings`/
   `GeoConfig` from `QuestionContent` (make `viz` REQUIRED); simplify the validators.

**Carry-over gaps (do alongside / after the retirement track):**

6. **Close the correctness matrix.** Parameterized queries, empty results, nulls, narrow many-series legends,
   timezone-sensitive temporal values; use the temporal findings to close §19.
7. **Set operational budgets from measurements.** Interpreter-mode render time, mounted-view concurrency, memory,
   result rows, mark count, transform depth; enforce the resulting limits.
8. **Resolve native-Vega theme updates.** Which specs can update stable theme signals safely vs require a
   reparse; encode the rule in the renderer + regression tests.
9. **Finish small high-value UI + geo gaps.** Pivot leaf-column sort/hide/filter + header formatting; the V2
   color-control contract, then annotations; fit-to-region geo control.
10. **Make recipes publishable (§21.10, longer horizon).** Replace the trusted TypeScript recipe builders with a
    declarative template contract (binding tokens + substitution), then workspace `viz_recipe` files/discovery
    and a direct `slippy-map` source kind. Detach (item shipped) is the substrate: a detached spec IS a
    fully-bound recipe; a publishable recipe is "detach + keep bindings as tokens".

**Take up next:** item 2 (chart→image) — the highest-value user/LLM win, orthogonal to the V1 conversion.
Then item 4 (the backfill migration) reuses the shipped converter to make the editable surfaces V2-native.

---

## Appendix A — Implementation evidence (living)

This appendix records what has been demonstrated. Outstanding work belongs only in §21.

### Plot coverage snapshot

| Family | Status | V2 implementation |
|---|---|---|
| bar, line, area, row, scatter, pie | Shipped | Vega-Lite encodings and surgical UI transforms |
| funnel, waterfall | Shipped | Versioned Vega-Lite recipes |
| radar | Shipped | `minusx/radar@1`, native Vega recipe |
| trend | Shipped | `minusx/trend@1`, native Vega recipe; comparison and formatting computed in-spec |
| single_value | Shipped | `minusx/single-value@1`, native Vega recipe; first-row KPI with responsive typography |
| combo | Shipped | `minusx/combo@1`, layered Vega-Lite recipe with independent scales and optional shared color/split |
| table, pivot | Shipped | DOM tier with shared grid styling, formats, conditional formats, and export |
| heatmap | Shipped | Native Vega-Lite rect spec and V2 transform |
| choropleth | Shipped | `minusx/choropleth@1` — layered geoshape+lookup recipe; boundary injected from the named-asset registry, value joined by region name |
| point / bubble / flow | Shipped | `minusx/point-map@1` (UI label "Geo") — circle marks (bubbles when `size` bound) over a vector or **street-tile** basemap; optional destination coords → `rule` flow lines; interactive pan/zoom + persisted view |
| street-tile basemap | Shipped | `basemap: 'tiles'` on `minusx/point-map@1` — slippy Carto tiles as Vega image marks off the mercator `scale`/`center` signals (browser-only; vector boundary is the headless/canvas fallback). Follows the app theme (Carto light/dark) via VegaChart; override provider via `tileUrl`. Deep zoom to street level (zoom cap raised to slippy ~z18) |
| density geo | Folded into point-map | V1 geo `heatmap` migrates to `point-map` + `size` (decided 2026-07-14); a true hexbin/density recipe is an optional future, not a migration blocker |
| detach / custom spec | Shipped | `kind:'vega'` raw-spec source + `detachRecipe`/`reattachRecipe` (`detachedFrom` provenance) — the full-control escape hatch; "Customize freely"/"Reset to recipe" UI + the agent-side `DetachViz` tool |
| V1→V2 converter | Shipped | `vizSettingsToEnvelope` (`lib/viz/from-vizsettings.ts`) — pure map from every legacy `VizSettings.type` (+ all geo subtypes) to a V2 envelope, reusing `setVizType`/`addYField` for cartesian and the recipe registry for the rest; `resolveLegacyRenderEnvelope` bridges read-only legacy charts through `<VegaChart>`. The function item 4's backfill migration runs (§21 items 1, 4) |

### ✅ Verified (as of 2026-07-11)

**Rendering & theming**
- JetBrains Mono renders AND measures correctly — root-caused: Chakra `@layer reset` overrides SVG
  presentation attributes (any author rule beats them); fixed via inline-style promotion + MutationObserver
  in `VegaChart`
- SI number labels by default (`650k`, `2.5M`); mono-width `titlePadding`; axis title clear of ticks
- Legend on top, correctly spaced, all items visible at real widths
- Temporal axis multi-scale labels legible
- Container-fill sizing: discrete-axis charts fill the card (`width/height: container` injected at compile —
  VL step-sizing rendered a 5-category bar ~tiny otherwise); explicit spec width = author opt-out
- Chart re-renders on hot data without rebuild (data-only view updates)
- Dark ↔ light toggle recompiles correctly (axis/legend/tooltip colors flip, no stale colors)
- Viz-V2 and legacy ECharts charts side by side look like siblings (palette/font parity)
- Very narrow container (dashboard-tile width) — labels thin gracefully, no overlap
- Legend wrap in narrow containers (2026-07-12, browser-verified on the tutorial dashboard):
  `computeLegendPlan` decides columns in plain JS at build (true container width + actual data labels
  + exact mono metrics) and bakes CONSTANTS into the compiled legend — a signal-driven `columns` was
  probed and rejected (Vega laid out against an unsettled width and never re-flowed). Wrapped grids
  omit the redundant legend title; axis-less charts (pie) reserve no y-gutter; cap at 3 rows with a
  muted "+N more" LIST entry (hidden symbol, explicit
  legend `values`; chart keeps all series); re-planned on resize/data via epoch rebuild only when the
  plan flips (post-build replan + pre-view-check RO replan close the 0-width-mount race)
- Single-series charts always get a legend (constant color datum named after the measure — ECharts parity)
- Legend entries centered over the chart; no legend title
- House donut in theme `config.arc` (responsive hole, rounded padded sectors): a bare agent-authored
  `mark: arc` renders identically to the UI transform; spec-level `innerRadius` overrides (solid pie)

**Agent authoring**
- Simple + stacked bar from a prompt — clean multi-line JSON, tooltips/formats/titles idiomatic, no escaping
- Split series via `color` encoding (no SQL pivot)
- Convert an existing vizSettings question ("rewrite this in vega") — first try, clean spec
- Pie from a prompt follows the skill idiom (minimal `mark: arc` + SUM theta, no hand-rolled donut props)
- Explicit label formats on request ("show full numbers", "format dates as Jan '25")

**Interactions**
- Legend click highlights series (others dim to 25%), legend entries dim too — injected
  `mx_legend_sel` platform default with opt-outs (own params / own opacity / composed specs);
  human click on a legend entry verified
- Shift-click accumulates legend selection; click-elsewhere clears
- Automatic tooltips on all marks (`config.mark.tooltip: encoding`), styled vega-tooltip handler;
  hover shows encoded fields with titles + formats (mono, rounded)

**UI panel (Fields / Settings / Spec)**
- Icon grid above subtabs (classic placement); 6 types enabled (bar/line/area/row/scatter/pie),
  9 dimmed as the live V2 coverage list
- Fields tab reads current spec encodings into type-aware zones (pie → Slices/Value, never x/y)
- Type switching with proper encoding transforms: bar↔line↔area↔scatter (mark swap), row (x/y def swap,
  axis config travels), pie (y→theta SUM-aggregated, grouping channels dropped, rounded donut) — round
  trips verified in browser
- Mark/type edits are surgical (unknown spec content preserved); dirty state (Review/Save/Cancel) rides
  the normal editFile path; Cancel restores
- Zone-chip × removal persists — fixed: viz envelope now has REPLACE delta semantics in `editFile`
  (deep-merge resurrected deleted channels from prior deltas); red-first store-level regression test
- Multiple Y columns per zone via a render-friendly fold transform (create/append/unfold; an
  agent-authored default-key fold is recognized; author color never stolen)
- Field-settings gear on native single-field chips: alias → channel `title`, format presets → d3
  `axis.format` — preset click re-rendered the axis live (`650k` → `650,000.00`). Popover PORTALS to
  body — fixed: the chip's overflow-hidden clipped an in-chip panel invisible (the original DOM-query
  "verification" was a false positive; physical-click re-verified)
- Spec tab shows the live envelope; copy button present
- Table source end-to-end (2026-07-11): envelope renders TableV2 with alias + decimals + conditional
  green cells + `.mx-th` css override live; Table icon enabled/selected; Fields hint; Settings hosts
  the conditional-format panel + css textarea; table→waterfall icon switch inferred bindings from
  the columns fallback (STEPS=platform, VALUE=revenue) with a working Discard round-trip
- Pivot source end-to-end (2026-07-11): envelope renders PivotTable with rows×columns, SUM heatmap
  cells, `$` prefix from columnFormats, Total column, `.mx-pivot th` css override live; Pivot icon
  enabled/selected; Fields hosts the full PivotAxisBuilder (Rows/Columns/Values + agg selector)
- Table+pivot grid merge, stages 1–2 (2026-07-11 pm): pivot layout math extracted to the PURE
  engine `lib/chart/pivot-grid.ts` (header trees, display rows, collapse filtering, row spans,
  heatmap domain, conditional cell bg — unit-tested; PivotTable.tsx 682→~300 lines); pivot now
  speaks the table's FULL class contract (`.mx-table` root + `.mx-header-row .mx-th .mx-row`
  + zebra parity classes + `.mx-cell .mx-col-<valueColumn>` + `.mx-toolbar`, `.mx-pivot` kept);
  zebra default on pivot data rows; SHARED bottom toolbar (row count + CSV export — TableBottomBar
  sections go optional); conditionalFormats on pivot VALUE columns (same rule vocabulary as table,
  cell/row/column/scale semantics over the cross-tab); concrete cell colours paint INLINE (like
  the table) so css overrides/heatmaps behave identically in both grids
- ConditionalFormatRule is now a UNION: condition rules + colour-scale rules (`{id, column, scale:
  red-yellow-green|green|blue}`) — ramp math extracted to `lib/chart/color-scale.ts` (shared by
  table cells, pivot cells, and the legacy pivot heatmap); panel grew an "Add scale" button; the
  flat table gets heatmap cells (closes "heatmap table?"); dark/light ramps via ui colorMode
- Inline viz validation on EditFile/CreateFile (2026-07-11): errors reject the write atomically with
  per-issue paths + available fields in the tool result; query+viz combined edits re-check after
  auto-execute (`vizValidation`); columns-unknown paths skip field checks (no false positives).
  `POST /api/viz/validate` carries it for the browser-side handlers (schema stays server-only)
- Column alias/format for RECIPE sources and PIVOT — RESOLVED (was: gear only on native
  single-field channels): recipes use the unified VizFieldPopover, pivot's zone chips carry the
  d3 FormatPopover (`d3Formats` mode); both covered by ui tests (viz-pivot / recipe formats)
- Zebra stripe is a CSS default on parity classes (`.mx-row-odd`/`.mx-row-even`, data-index — not
  nth-child, virtualization spacers would flip parity) — overridable from the `css` field
- Drag a column chip into a drop zone (drag-and-drop path)
- Stacked toggle / log-scale toggle round-trip in browser
- Save persists → reload renders the saved spec
- Field-settings popover near viewport edges / while the panel scrolls
- Composed spec classification: canonical bar+line+independent-Y layers select Combo; unmatched
  compositions select the Custom icon, keep the complete icon grid, expose no drop
  zones while retaining neutral query-column reference chips, and may be safely rebuilt by choosing
  a supported family; Spec still works. While a known family is active, Custom stays clickable as a
  UI-only PREVIEW (icon selects, Fields swaps to "ask the agent / edit in Spec" copy, envelope
  untouched — custom is derived, never stored; any family click exits, same family = silent return)
- Undo/redo behavior with surgical edits

**Analytic geo — choropleth (2026-07-12, browser-verified on the dev server)**
- `minusx/choropleth@1` renders a US revenue-by-state map end-to-end: agent/UI-authored envelope
  (`kind: recipe`, bindings region/value, params mapName/colorScale), boundary features injected from
  the named-asset registry under `__mx_geo_boundary`, value joined to each polygon by region NAME via a
  VL `lookup`, quantitative color scale + gradient legend. Icon in the V2 grid (`LuMap`, Choropleth),
  Fields shows Region/Value zones, Settings hosts the Map + Color-scale native dropdowns (mapName /
  colorScale params), light + dark both clean.
- Boundary quality: swapped the v1 ECharts geojson (`/geojson/us-states.json`, `world.json`) — which was
  built for ECharts' equirectangular geo and broke under real projections (Alaska's Aleutians at -188.9°
  smeared across the map; phantom inset frames) — for the projection-clean **us-atlas states-10m** and
  **world-atlas countries-110m** TopoJSON (the named atlas sources vega-datasets derives from, with
  `properties.name` baked in). Alaska + Hawaii now render as correct albersUsa insets, no frames; empty
  regions are transparent with a legible border. India keeps its v1 geojson. v1 files untouched (legacy
  ECharts geo still uses them).
- Two-layer recipe: a themed background outline of EVERY region (so no-data regions still read) beneath
  the value-colored regions (lookup + `isValid` filter). Inline validation accepts the recipe's declared
  boundary dataset name (allowed alongside `main`) and skips field-ref checks for recipe specs (boundary
  `properties.name` isn't a query column).
- **Point map (2026-07-13, browser-verified)**: `minusx/point-map@1` plots coordinate rows over a boundary
  backdrop (backdrop geoshape beneath `main` symbol marks). `size` bound → bubbles, `color` → category
  palette (or a sequential ramp with `colorScale`), and binding BOTH `lat2`/`lng2` switches the marks to
  `rule` flow lines (one recipe, no mode toggle). Panel: Points icon (`LuMapPin`), Fields zones
  (Latitude/Longitude/End lat/lng/Size/Color) with lat/lng auto-inferred by column name on type-switch,
  Settings Map + Color-scale + **Center (lat,lng)** + Zoom.
- **Point map is a RECENTERABLE MERCATOR (not albersUsa)** driven by `scale` + `center` + `translate`
  signals — the canonical vega [Zoomable World Map] pattern. This pivot was empirically forced: vega's
  projection `fit` only frames real *source* geometry (fit-to-a-region-feature works; fit to a
  computed/inline bbox does NOT, on any projection), and a composite projection can't recenter/pan.
  Proven headless: centering on `[-119, 37]` lands the point at exactly `(300, 200)`. Trade-off: the US
  point map loses albersUsa's AK/HI insets (fine — a zoomable point map can't use a composite);
  **choropleth keeps albersUsa** (static overview). Framing = geographic `center [lat,lng]` + `zoom`
  (not fit-by-name, which breaks across basemaps — there is no county named "California"); no `center`
  → the projection auto-frames the DATA extent. Each control is a reactive BASE (from data) + a settable
  USER override (`value`+`on`) — `update` would clobber interactive sets — combined so user wins.
- **Interactive pan/zoom + persist (Phase 2/3)**: drag pans (pointer delta → `centerLng/LatUser` via the
  pixel↦degree conversion), wheel zooms (`scaleUser`), and Google-Maps-style **+/− buttons** (`VegaChart`
  nudges `scaleUser`). After a real interaction (never on initial render), `VegaChart` reads back
  `centerLng/centerLat/scale` (debounced) and persists `center`+`zoom` via `onViewChange` →
  `setRecipeParam` → `onVizChange`, so Save/reload restores the exact view (`POINT_MAP_REGION_SCALE`
  maps scale↔zoom). Verified in-browser: + zooms, "Review 1 change" registers, save persists.
- **us-counties basemap**: `us-atlas-counties-10m.json` (3231 named counties) as a "US (Counties)"
  basemap — a finer point-map backdrop (county *choropleth* deferred: county names aren't unique, needs
  FIPS). Center+zoom holds across states↔counties because it's geographic.

**Street tiles, deep zoom, solid color, detach (verified 2026-07-14)**
- **Street-tile basemap** (`basemap: 'tiles'`): slippy tiles as Vega **image marks** positioned by pure
  arithmetic off the mercator `scale`/`center`/`tx`/`ty` signals (Web Mercator is linear in projected pixel
  space — no per-tile projection). A `tiles` dataset enumerates only the viewport tiles (sequence→grid via
  modulo). Browser-verified: real Carto tiles render behind the markers; the vector boundary stays beneath as
  the headless/canvas fallback. **Theme-following** (Carto light/dark) is applied by `VegaChart` keyed on the
  `tileUrlTemplate` signal (capability, not recipe id), so a detached map keeps it; `tileUrl` overrides.
- **Deep zoom fix**: the recipe `zoom` clamp (was 40) collapsed every zoom-in on the persistence round-trip
  (`zoom = scale/REGION_SCALE`), capping at ~metro level. Raised so tiles reach street level (~slippy z18);
  browser-verified click-through to individual SF street grids.
- **`markColor`** param: a solid CSS color for all markers/flows when no data-driven `color` column is bound
  (a bound `color` still wins) — fills the "just make the points red" gap without a fake color binding.
- **Detach escape hatch** (RFC §21.10 substrate): `kind:'vega'` raw-spec source + `detachRecipe`/
  `reattachRecipe` with `detachedFrom` provenance (reversible). `VegaChart` detects map capabilities by
  SIGNAL (`mxViewParams`/`scaleUser`/`tileUrlTemplate`), so a detached map keeps pan/zoom + buttons + dark
  tiles. Browser-verified round-trip: recipe → "Customize freely"/`DetachViz` → Custom `kind:'vega'` (buttons
  + dark tiles intact) → "Reset to recipe" → back to the recipe. The agent-side `DetachViz` tool
  autonomously detaches when a request exceeds recipe params (verified: "make the markers diamond-shaped").

**V1→V2 converter + render bridge (verified 2026-07-14)**
- `vizSettingsToEnvelope` covers every legacy `VizSettings.type` and all four geo subtypes; cartesian output is
  built by reusing `setVizType`/`addYField` so it is byte-identical to the icon selector, and recipe/table/pivot
  sources carry their formats through. 27 unit tests (converter + `resolveLegacyRenderEnvelope` gating), red-first.
- Browser-verified on the tutorial dashboard `/f/11`: 10 legacy questions with NO `viz` envelope (trend cards,
  multi-series line, stacked area, donut) render as **10 Vega SVGs, 0 ECharts canvases**, all correct; the pivot
  correctly stays on the DOM renderer (bridge excludes table/pivot); editable question pages keep V1 ChartBuilder.

**Data handling**
- 10k+ row result — render time acceptable

**Regressions**
- Full test suite green after every probe commit (continuous through the session)

## Appendix B — Implementation map and dated decisions

Appendix A holds verification evidence. This appendix records where the implementation lives and decisions
that are not obvious from the code. Active priorities belong only in §21.

### Implementation map (all under `frontend/`)

- **Envelope schemas** — `lib/validation/atlas-schemas.ts`: `VizEnvelope` (version 2), `VizSource` =
  `VizSourceRecipe | VizSourceVegaLite | VizSourceVega | VizSourceTable | VizSourcePivot`. `VizSourceVega`
  (`kind:'vega'`, `grammar:'vega@6'`, `spec`, `assets`, `detachedFrom`) is the detach target / full-control
  escape hatch. `ColumnFormatConfig` gained `format` (d3). Spec bodies stay `Type.Unknown` (RFC §2).
- **Detach** — `lib/viz/detach.ts`: `detachRecipe`/`reattachRecipe`/`canReattach` (pure); the agent-side
  `DetachViz` tool (`agents/web-analyst/web-tools.ts` + `lib/tools/handlers/detach-viz.ts`).
- **`lib/viz/`** — the probe core:
  - `types.ts` (VizIssue codes incl. `E_CSS`; `formatVizIssues`), `query-data.ts` (`toVizColumns`),
    `prepare.ts`, `field-refs.ts`, `theme.ts` (VL config + native-vega parser config; `config.arc`
    house donut; SI `numberFormat`), `viz-templates.ts` (shipped funnel/waterfall/radar/trend recipes;
    `build(bindings, formats, params)`; `numExpr` d3-first), `encoding-edit.ts` (ALL surgical edits: channel/type/zones/multi-Y
    fold/presentation/table+pivot helpers/`mergeVizColumnFormat`; `setEnvelopeVizType(env, type, columns?)`
    — the columns fallback types categories from COLUMN KIND, never hardcodes nominal),
    `render-vega.ts` (compile → parse(ast)+interpreter → View; render-time injections: container sizing,
    single-series legend, `mx_legend_sel` toggle, centered legend layout, `injectNamedAssets` for geo
    boundaries), `validate.ts` (5-stage; `columns` OPTIONAL — field checks skipped when result unknown;
    recipe sources allow their declared boundary dataset names in the data policy and skip field-ref
    checks), `validate-remote.ts` (browser client of the route; FAIL-OPEN). The official schema is
    imported from `vega-lite/vega-lite-schema.json`; no repository copy is checked in.
  - **Geo (RFC §9)** — `geo-assets.ts` = the named boundary registry: `GEO_ASSETS` (us-states →
    us-atlas states-10m, world → world-atlas countries-110m, both TopoJSON w/ `properties.name`; india →
    v1 geojson), `GEO_BOUNDARY_DATASET` (the reserved local dataset name the recipe references),
    `assetFeatures` (TopoJSON→GeoJSON via topojson-client, pure/testable), `loadGeoFeatures` (fetch +
    cache). `viz-templates.ts` `minusx/choropleth@1` is a layered geoshape+lookup recipe declaring its
    boundary via `VizTemplate.assets()`; `materializeRecipe` surfaces `assets`, and the render pipeline
    (`injectNamedAssets`, used by `<VegaChart>` and `renderEnvelopeToSvg`) resolves + injects the features
    under `GEO_BOUNDARY_DATASET` alongside `main`. Boundary files ship under `public/geojson/`
    (`us-atlas-states-10m.json`, `world-atlas-countries-110m.json`); v1 ECharts geo files untouched. The
    empty-region look (transparent fill + `fgSubtle` border) is `config.geoshape` in `theme.ts`. Panel:
    `VizTypeSelector` Choropleth entry (`LuMap`, v2Only), `VegaVizPanel` Settings map + color-scale native
    dropdowns.
- **Components** — `components/viz/`: `VegaChart` (lazy via next/dynamic; promoteFontAttrs beats Chakra
  @layer reset), `VegaVizPanel` (persistent icon grid + informational Custom state +
  Fields/Settings/Spec; DOM-tier settings = conditional
  formats [table] + css textarea), `VegaEncodingPanel` (zones; unified `VizFieldPopover` for native +
  recipes), `VizFieldPopover` (STORAGE-AGNOSTIC: value/onCommit; alias + d3 presets + always-visible
  custom pattern input; portals to body — chips clip overflow), `VizTableView` / `VizPivotView`
  (scoped `<style>` via CSS nesting under a per-mount class), `VizSpecInspector`.
  Routing: `QuestionVisualization` — envelope kind table→VizTableView, pivot→VizPivotView, else
  VegaChart; `onVizChange` prop threads from QuestionViewV2 `onChange({viz})`.
- **Grid reuse** — `TableV2`/`PivotTable`/`PivotAxisBuilder` untouched in behavior; gained the stable
  class contract (`.mx-table .mx-header-row .mx-th .mx-row(+.mx-row-odd/-even zebra, DATA-index — not
  nth-child, virtualization spacers) .mx-cell .mx-col-<name> .mx-toolbar`; pivot root `.mx-pivot` +
  element selectors), d3 cell formatting (`formatD3Number/formatD3Date` in `lib/chart/chart-format.ts`,
  cached, null→legacy fallback), and `d3Formats` popover mode (drilled: TableV2→TableHeaderCell;
  PivotAxisBuilder→AxisBuilder→ZoneChip→FormatPopover).
- **Validation wiring** — `app/api/viz/validate/route.ts` (thin withAuth wrapper; the route keeps the large
  package-provided grammar schema on the server rather than the browser bundle);
  `lib/tools/handlers/edit-file.ts` (pre-apply check: rejects atomically when the envelope CHANGED —
  deep-equality via lodash isEqual, markup round-trip reorders keys; columns only when query unchanged;
  post-auto-execute recheck vs fresh columns → `vizValidation` advisory in result);
  `lib/tools/handlers/create-file.ts` (pre-create, columns undefined).
- **editFile REPLACE semantics** for the `viz` key — `lib/file-state/file-edit.ts` (deep-merge would
  resurrect deleted spec keys).
- **Agent docs** — `orchestrator/prompts/prompts.yaml` `skill_questions`: markup forms (`<spec>{{…}}</spec>`
  double-brace JSON; css as backtick template string — both round-trip via content-jsx), recipes +
  `columnFormats {alias, format}`, table/pivot sources, pie idiom (minimal arc + SUM theta), validation
  contract. Recipe/table/pivot markup examples match what `fileToMarkup` actually emits.

### Decisions made 2026-07-11 (beyond the 07-10 log)

- **Grid merge shape (user-confirmed).** Pivot rides the same grid stack as the table: shared
  class contract + shared toolbar + shared conditional-format vocabulary; pivot stays
  UNVIRTUALIZED (aggregated data is small; rowSpan'd sticky dim columns fight virtualization).
  The pivot's layout stays in the pure engine (`pivot-grid.ts`), not TanStack's row model —
  subtotal/formula interleaving and rowSpans aren't row-model shapes; TanStack remains the flat
  table's engine. Sorting/filter/stats on pivot leaf columns deferred (product semantics TBD).
- **Trend spike verdict: recipe (§17, recipe-first per user).** The native-vega tier handled every
  acceptance criterion — including the two that motivated considering a DOM widget (independent
  font sizing → param-overridable signals; comparison semantics → in-spec window transforms), and
  it gets SVG/image export + agent vision for free, which a DOM widget would not. Recipe params
  got real plumbing (materializeRecipe now passes `params` to build; getRecipeParams/setRecipeParam
  surgical edits; panel Settings toggles for trend). single_value follows as a recipe.
- **Heatmap is a viz TYPE, not a pivot mode.** Native VL rect spec (no recipe — Fields zones work
  directly); `PivotConfig.compact` is deprecated (legacy renders keep working; V2 panel hides the
  toggle). Discrete axes only: temporal category kinds map to ordinal on heatmap axes (rect +
  continuous time = slivers).


- **One format vocabulary = d3, everywhere.** Vega tier natively (spec `axis.format`, recipe label
  exprs); DOM grids render `format` via d3-format/d3-time-format (deps pinned 3.1.2/4.1.0 + @types);
  legacy decimalPoints/prefix/suffix remain as fallback only. One popover per tier: vega tier =
  VizFieldPopover, DOM grids = FormatPopover in `d3Formats` mode; classic (non-V2) surfaces keep the
  legacy popover until migration deletes them.
- **DOM-tier looks = CSS, no style toggles.** `css` field scoped per instance; validator + render guard
  reject `@import`/`url()` (`E_CSS`); chrome hides via `.mx-toolbar{display:none}` per surface or per
  question — story-level styling cascades naturally since embeds share the DOM.
- **Recipes stay reference-level.** Formats ride `columnFormats` on the reference and compile in at
  materialization (never spec patches — recipe internals are private; column names are the public API).
  Spec-level control = the one-way detach (RFC §3), not yet built.
- **No rebuild path may invent a type.** Category VL types always derive from column kinds (regression:
  table→bar hardcoded nominal → temporal week_start band-scaled into a mangled axis).
- **Validation is inline (compiler model), not an agent-called tool.** Errors reject the write; warnings
  ride success; fail-open on route unreachability.
