# Visualization Arch V2

> **Status:** Working V2 direction — merged from the two discussion documents
> (`frontend/docs/viz_discussion.md` and the Codex counterpart, both retired to reference).
> Decisions dated 2026-07-10. Only the four evidence questions in §19 remain open; everything
> else here is the agreed direction unless the spike produces contrary evidence.

## 1. Summary

The `viz-styles-prop` branch (abandoned, salvage-later) was re-implementing a visualization grammar
piecewise — curated style levers, a per-type capabilities matrix, a bespoke style cascade, ECharts/CSS escape
hatches — without gaining the power or compiler maturity of an established one. The expressiveness ceiling was
whatever we had hand-coded; the agent was hobbled by construction.

**V2 adopts Vega-Lite as the normal agent contract and native Vega as the advanced contract.** MinusX owns the
document envelope, data binding, themes, validation, security, and UI — not visualization semantics. Chart
types stop being application-level renderer components and become data: specs and versioned recipes. A new
chart type normally requires **zero new MinusX rendering code**.

The rollout is probe-first: add a `vega-lite` source beside the current renderer, let the agent use it on real
work, and converge the rest of the stack after seeing the results (§18).

## 2. The envelope

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
  from the envelope version — `vega-lite@6` / `vega@6`. MinusX vendors the exact JSON schemas and pins
  runtime/compiler package versions; `$schema` is never fetched from the network. A Vega/Vega-Lite upgrade is
  an explicit migration with visual regression tests — saved specs are not silently reinterpreted by a new
  major version.
- **Placement:** a new `content.viz` key on question content. New content writes `viz`; legacy `vizSettings` is
  never mutated in place and renders through the compatibility adapter (§18). If both fields are temporarily
  present, **`viz` is authoritative** and save-time validation rejects contradictory states.
- **TypeBox rule:** only the MinusX envelope is TypeBox in `atlas-schemas.ts` — `version`, the `source`
  discriminator, `fieldMeta`, param namespaces, `assets`, recipe provenance, and derived-artifact metadata.
  Spec bodies are `Type.Unknown` there and validated by the vendored official schemas plus the MinusX
  field/security passes (§11–12). **Do not reproduce the Vega/VL grammars in TypeBox or paste them into
  prompts.**

## 3. One authoritative source, and the render flow

Each visualization has exactly one authoritative source:

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

### React component boundary

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
controls, recipe `params` controls, a generic theme panel), not written per type. (If the trend spike picks the
DOM widget, it adds one small leaf renderer; `single_value` follows trend either way.)

## 4. Grammar tiers

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

## 5. Recipes

A recipe is an authoring shortcut and reusable artifact — not another renderer or second grammar.

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

## 6. Field metadata (`fieldMeta`)

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

## 7. Themes

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
theme signals may signal-update when safe, otherwise reparse (spike decides, §17). Explicit spec colors are
never silently rewritten. Canvas/SVG marks must not depend on application CSS variables.

**Deleted outright:** indexed color keys, percentage opacity controls, `dataLabelColor`, colorScale enums, and
kin. Native colors/schemes, 0–1 opacity, native mark/encoding properties.

## 8. Story & embed semantics

- Story/embed config supplies **theme defaults only** — it cannot replace properties explicitly set inside a
  spec.
- Stable named recipe params handle supported per-instance changes.
- A structural change or an override of explicit spec properties **materializes/forks the spec** so the embed
  owns its copy. Forks record provenance (`forkedFrom: {fileId, contentHash}`) so the UI can show "restyled
  copy of Q123" and offer *manual* re-sync.
- **Forbidden:** positional JSON Patch against a saved visualization (silently changes meaning when `/layer/1`
  reorders) and generic deep-merging of `layer`/`transform`/`params` arrays.

## 9. Geographic visualization

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

## 10. Table & pivot

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

## 11. Validation & agent feedback

`ValidateVisualization` / the preview path returns, in order:

1. JSON Schema errors with JSON Pointer paths (vendored schemas).
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

## 12. Security

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

## 13. Parameters & interactions

Reserved envelope namespaces — never one grab-bag `params` object:

- `dataBindings` — query/data params; re-execute the query (binds the existing `:param` system; no new
  machinery).
- `viewParams` — presentation-only; recipe params / named signals (lands with recipes). The `mx` signal-name
  prefix is reserved for platform/theme/system signals; the validator rejects agent-authored specs and
  workspace recipes that define conflicting names.
- `interactions.outputs` — selections emit **MinusX-owned typed events**
  (`{"type": "filter", "field": "region", "operator": "in", "values": ["West"]}`) for future cross-filtering.
  Arbitrary Vega signals are never passed between visualizations. Reserved now, implemented later.

## 14. SQL vs visualization transforms

Business semantics, joins, governed metrics, expensive calculations, and major aggregations belong in SQL.
Presentation-oriented reshaping (`fold`, `window`, `stack`, ranking, regression, binning) belongs in the
grammar when it makes the visualization reusable — it is what lets a recipe work across datasets.

**Trend semantics:** ordinary previous-row/period comparison lives in the recipe transforms. "Skip the partial
current period" is not universally inferable (fiscal calendars, delayed ingestion): the query either excludes
incomplete rows or returns an explicit `is_complete` field the recipe binds/filters. **No new
application-owned comparison logic**; the legacy adapter preserves current behavior until migration.

## 15. Sizing & accessibility contracts

- **Container sizing is a platform contract:** MinusX owns the outer card/chrome; the visualization owns its
  internal view. Builder output and recipes default to container-supplied responsive width/height with
  documented autosize/padding. Native specs may opt into fixed dimensions; the UI/validator warns when fixed
  sizing will likely clip in dashboards/stories.
- **Accessibility is a publication gate, not post-migration cleanup:** every visualization needs a
  human-readable description/ARIA label, keyboard-safe interactions, and a "view data" fallback from the bound
  query result. Recipes declare a default accessible description template. Vega's generated SVG ARIA is useful
  but not sufficient alone.

## 16. Type mapping

| Current type | V2 implementation |
|---|---|
| bar, row, line, area, scatter, pie | Vega-Lite |
| combo / dual-axis | VL layers + independent scale resolution |
| waterfall | VL transforms + layered marks |
| trend, single_value | recipe (Vega/VL) **or** DOM widget — spike decides (§17) |
| radar | `minusx/radar@1`, native Vega recipe (the pure recipe-contract test; requires an explicit domain strategy — shared fixed domain, normalized values, or per-metric bounds — compiler warns on unlike scales) |
| funnel | VL where practical; otherwise native Vega recipe |
| geo (choropleth/points/lines/density) | VL / Vega recipes (§9) |
| tiled maps | `slippy-map` (Leaflet), tile-backed only |
| table, pivot | virtualized DOM grids (§10) |

## 17. Spike protocol

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

**Trend acceptance criteria** (decision rule: the recipe wins unless it *materially fails* a criterion; ties go
to the recipe; `single_value` follows): responsive at card/dashboard/story widths; independently adjustable
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

## 18. Migration path

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

## 19. Open evidence questions

Only these remain open — they require measurement, not design debate:

1. **Trend renderer:** does the native Vega recipe meet the §17 criteria, or is the DOM widget materially
   better?
2. **Operational budgets:** what result-row, mark, transform-depth, render-time, concurrent-view, and memory
   limits follow from the production benchmark under interpreter mode?
3. **Native Vega theme updates:** which specs can respond via theme signals and which require reparse?
4. **Temporal normalization:** what exact wire contract yields identical timezone behavior across browser,
   server SVG, exports, and public stories?

## 20. Decision log (2026-07-10)

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

---

## Appendix A — Probe verification checklist (living)

Manual verification protocol for the probe. `[x]` = verified (browser or headless, date noted);
`[ ]` = pending. Update as items are checked; anything that fails gets a note + issue.

### A1. Rendering & theming
- [x] JetBrains Mono renders AND measures correctly (2026-07-10 — root-caused: Chakra `@layer reset`
  overrides SVG presentation attributes; fixed via inline-style promotion in `VegaChart`)
- [x] SI number labels by default (`650k`, `2.5M`) (2026-07-10)
- [x] Legend on top, correctly spaced, all items visible at real widths (2026-07-10)
- [x] Axis title clear of tick labels (mono-width `titlePadding`) (2026-07-10)
- [x] Temporal axis multi-scale labels legible (2026-07-10)
- [x] Dark ↔ light toggle recompiles correctly (axis/legend/tooltip colors flip, no stale colors)
- [x] Container resize re-lays-out without clipping (drag panel divider, browser resize)
- [ ] Transparent background — chart inherits card surface in both modes
- [x] A viz-V2 chart and a legacy ECharts chart look like siblings (palette/font parity)
- [ ] Very narrow container (dashboard-tile width) — labels thin gracefully, no overlap
- [ ] Legend with many categories (>8) at narrow width (known: horizontal legends don't wrap;
  agent idiom `legend: {columns: N}`)

### A2. Agent authoring (the probe's core evidence)
- [x] Simple bar/stacked bar from a prompt — clean multi-line JSON, no escaping (2026-07-10)
- [x] Split series via `color` encoding, no SQL pivot (2026-07-10)
- [ ] Dual-axis combo (layers + `resolve: {scale: {y: "independent"}}`)
- [ ] Facet / small multiples
- [ ] Window-transform visual (rolling average) — SQL-vs-transform judgment
- [ ] Heatmap (`rect` mark)
- [ ] Horizontal bar + sort (`y` nominal sorted by value)
- [ ] Custom tooltip field list overriding the automatic one
- [ ] Explicit label formats on request ("show full numbers", "format dates as Jan '25")
- [ ] Convert an existing vizSettings question ("rewrite this in vega") — parity + reversibility
- [ ] Revert to classic ("go back to a normal bar chart") — viz removed, vizSettings restored
- [ ] Recovery from a misspelled field (agent told verbally — does it fix in one step?)
- [ ] Recovery from malformed JSON in `<spec>` (EditFile error loop)
- [ ] JSON-syntax-error rate per EditFile stays ~zero across the session (probe metric)

### A3. Interactions
- [x] Legend click highlights series (others dim to 25%), legend entries dim too (2026-07-10,
  DOM-dispatched click — needs one human click to confirm hit-targets feel right)
- [ ] Shift-click accumulates selection; click-elsewhere clears
- [ ] Injection opt-outs respected: spec with own `params` / own `opacity` / layered spec untouched
- [ ] Tooltips show encoded fields with titles + formats on hover, styled (mono, rounded)

### A4. UI panel (Fields / Settings / Spec)
- [x] Fields tab reads current spec encodings into X/Y/Color zones (2026-07-10)
- [x] Mark-type switch (bar→line) — surgical edit, dirty state appears (2026-07-10)
- [ ] Drag a column chip into a zone — channel reassigned, other channel props (axis/format) survive
- [ ] Remove (×) a zone chip — channel deleted, chart re-renders sensibly
- [ ] Stacked toggle / log-scale toggle round-trip
- [ ] Save persists; reload renders the saved spec; Cancel reverts
- [ ] Spec tab shows live envelope; copy button works
- [ ] Composed (layered) spec: Fields/Settings show the "edit via chat" hint, Spec still works
- [ ] Undo/redo behavior with surgical edits (if the page supports it for content edits)

### A5. Data handling
- [ ] Re-run query (data changes) — chart updates without rebuild/flicker
- [ ] Parameterized query — param change re-executes and chart follows
- [ ] Empty result set — renders empty axes, no crash
- [ ] Nulls in x/y/color columns
- [ ] 10k+ row result — render time acceptable
- [ ] Timezone-sensitive timestamps — axis values match the table view (known wire-format risk)

### A6. Regressions (legacy must be untouched)
- [ ] Every legacy vizSettings type still renders (table, line, bar, row, area, scatter, funnel,
  pie, pivot, trend, waterfall, combo, radar, geo, single_value)
- [ ] Legacy question editing via agent unchanged (vizSettings markup path)
- [ ] Dashboards with legacy charts unaffected
- [x] Full test suite green after every probe commit (2026-07-10, continuous)

### A7. Known gaps (expected to fail — do not file)
- Agent gets no ValidateVisualization feedback in tool results yet (validator built + tested;
  `/api/viz/validate` route + tool wiring pending)
- Vega charts invisible to the agent in follow-up turns (chart→LLM image path pending)
- Dashboards / story embeds / notebook cells do not route `content.viz` (question page only)
- Public/guest story rendering with viz untested (CSP interpreter is in, path unwired)
- Image/CSV export of viz-V2 charts unwired
