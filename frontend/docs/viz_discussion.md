# Viz Architecture Discussion — unhobbling the agent

*Context: the `viz-styles-prop` branch added curated style levers (`styleConfig.background/legend/textColor/...`),
a per-type capabilities matrix (`viz-capabilities.ts`), a style cascade for stories (`viz-style-merge.ts`), and two
escape hatches (`echartsOverrides`, `cssOverrides`). The instinct that this is "reinventing Vega-Lite, but worse"
is correct — this doc lays out why, and what to do instead.*

---

## 1. Diagnosis: the branch is Vega-Lite, piecewise, worse

| Branch machinery | The thing it re-implements |
|---|---|
| `VIZ_CAPABILITIES` (which levers each type honors) | VL's encoding/mark rules, enforced by its compiler for free |
| `viz-style-merge.ts` (chartTheme < question < embed, null-pruning, "arrays replace wholesale") | VL's `config` cascade, with defined merge semantics we don't have to author or test |
| Each curated lever (`smooth`, `legend.position`, `textColor`, …) | One `config` path in VL; here it's a schema field + capability entry + merge block in `finalizeChartOption` + prompt docs + UI panel, forever |
| `echartsOverrides` / `cssOverrides` escape hatches | The spec itself |

The escape hatches are documented as *"may break silently if the renderer changes"* — that's the tell. When the
unhobbled path is a footgun, the core abstraction is wrong.

The underlying question behind all the requirements: **what is the canonical spec for a chart?** Today it's
"VizSettings + a pile of per-type TypeScript option builders", which means the expressiveness ceiling is whatever
we've hand-coded. The agent is hobbled by construction.

## 2. Recommendation: Vega-Lite as the spec layer, widgets stay widgets

Adopt the VL spec as the canonical chart representation, rendered by vega-lite. Not "sprinkle VL ideas in" —
actually use it. How it maps to the requirements:

- **Simple things stay simple** — a VL bar chart is *smaller* than today's VizSettings:
  ```json
  { "mark": "bar", "encoding": { "x": {"field": "month", "type": "temporal"},
                                 "y": {"field": "revenue", "type": "quantitative"} } }
  ```
- **xcol/ycol/splitcol vs ycol1/ycol2 dissolves** — long data → `color: {field: "region"}`; wide data →
  `transform: [{fold: ["revenue", "profit"]}]` or two layers. We stop modeling the distinction at all.
- **Composition is native** — `layer`, `hconcat`, `facet`. Dual-axis combo = two layers with
  `resolve: {scale: {y: "independent"}}`. The whole `combo` type + `dualAxis` config become a spec idiom.
- **No layout code** — the VL compiler does scales, label overlap, legend layout, axis inference. All the
  padding/margin/stack-or-not code: deleted. This is *the* reason grammars of graphics exist.
- **Themes** — VL's `config` object is "theme land": one JSON namespace for everything presentational with native
  merge semantics. Cascade becomes `orgTheme.config < storyTheme.config < spec.config` — one deepMerge of three
  JSON objects. `viz-style-merge.ts`, `pruneNulls`, `PRESENTATION_KEYS`, the `StoryChartTheme` projection: all
  deleted. Weird opacity/color-index options: deleted (colors are `config.range.category` or `scale.range`).
- **New archetypes without code** — a "trendplot-like" chart becomes a saved VL spec template with parameter
  slots — a *file* in the workspace (fits the filesystem-BI philosophy). New chart archetype = the agent or user
  saves a template document. Zero TypeScript.
- **Feedback without enumerating options in our types** — the contract is "Vega-Lite v6", probably the most
  in-distribution chart grammar for LLMs. No 200-line capabilities table in the prompt. Feedback loop, none of it
  code we maintain:
  1. Ajv against the published VL JSON schema → precise path-level errors (we already run Ajv)
  2. VL compile with a captured logger → warnings for dropped/unknown encodings
  3. Headless render to SVG/PNG server-side (we already have `render-chart-svg.ts` and the chart→LLM image
     pipeline) → runtime errors, plus optionally return the rendered image so the agent can *see* what it made
- **Structured contract** — JSON, validated, deterministic, no arbitrary SVG/code execution.
- **SQL stays the transform layer** — bind the query result as `data: {name: "main"}`; document "prefer SQL"
  over VL transforms (though `fold`/`window` work when genuinely presentational).

### What stays outside the grammar

`table`, `pivot`, `single_value`, `trend`, `geo` aren't charts — they're **widgets**. They keep structured config
types. This is the sane version of "set types + 1 yolo type": curated widgets + one grammar type, except the
"yolo" type isn't yolo — it's compiled and validated. (Strategy for styling/extending widgets: §3.)

### UI drag-drop: the detach model

Arbitrary VL specs can't round-trip through a drag-drop builder; decompiling them is a tarpit. Clean model:

- A question stores `{ builder: {...} | null, spec: {...} }`. **The spec always renders** — single render path.
- UI-built charts keep a small builder state (type, x, y, split — smaller than today's VizSettings) that
  deterministically *compiles to* the spec on every edit.
- If the agent edits the spec beyond what the builder expresses, `builder` goes null — the chart is **detached**;
  the UI shows the spec (or "customize via agent") instead of drop zones. One-way door, like detaching a
  component in Figma or GUI→SQL in Metabase. No bidirectional-sync bugs.
- Prior art: Deneb (Power BI's VL plugin), Rill, Streamlit.

## 3. Widgets (trend, single_value, …): slots + CSS props, not more levers

The trend widget — big number, green "↑ 12.5%" badge, "vs previous period" caption — is DOM, not a chart. Neither
a custom VL spec nor a custom mark. The strategy is to split **semantics** from **presentation**:

**Semantics stay structured and computed in code.** Which column is the value, `compareMode`
(last-vs-previous, skip-partial-period), the delta math, up/down direction. This is data logic — it belongs in
`TrendConfig` and the widget implementation, exactly as today. The UI edits it; it's stable and tiny.

**Presentation = named slots, each taking an open CSS-properties object.** Every widget declares its slots
(trend: `value`, `delta`, `label`) and styling is:

```json
"slots": {
  "value": { "fontSize": "5rem", "fontWeight": 800 },
  "delta": { "fontSize": "1rem" },
  "label": { "color": "#94a3b8" }
}
```

- One schema shape for ALL widgets: `Record<slotName, CSSProperties>`. "Increase the font" =
  `slots.value.fontSize` — no new lever, ever. This **replaces** `SingleValueConfig`'s enumerated
  `valueSize`/`valueColor`/`valueWeight`/`labelColor` fields (that enumeration is the lever treadmill in
  miniature — today it's font weight, tomorrow letter-spacing, then text-shadow…).
- CSS is maximally in-distribution for the agent, yet the contract stays structured JSON (validated as CSS
  properties, scoped to the slot) — no willy-nilly markup.
- Semantic states are theme tokens: the widget sets `data-direction="up|down"` and the theme maps
  `--mx-positive`/`--mx-negative`; slot styles can override. Org/story themes provide default slot styles under
  the same cascade as chart `config` (e.g. `theme.widgets.trend.slots…`).

**New widget archetypes without code: widget templates.** Same move as VL templates but for the DOM side — a
workspace file holding markup with declared bindings (`{{value}}`, `{{delta}}`, `{{direction}}`) plus scoped CSS
(no JS). The built-in trend is conceptually just a shipped template + its computed bindings. This is consistent
with what stories already do (`AgentHtml`), and it's the opt-in path for genuinely new shapes; the common path
remains built-in widget + slot styles.

## 4. Column renames & formats (esp. dates)

Two rules:

**1. One format vocabulary: d3-format + d3-time-format strings.** (`",.0f"`, `"$,.2f"`, `"%b %Y"`.) This is what
VL uses natively (`format`/`formatType` on encodings and axes), it's heavily in-distribution, and it's far more
expressive than `decimalPoints: 0-4`. The current `ColumnFormatConfig.dateFormat` uses Unicode/date-fns tokens
(`yyyy-MM-dd`) — mechanical to convert (`%Y-%m-%d`). The UI keeps friendly presets ("Currency", "Percent",
"MMM YYYY") that compile to d3 strings; `alias`, `prefix`/`suffix` stay as-is (arbitrary suffixes like
`" units"` aren't d3-expressible).

**2. Renames/formats live where the renderer reads them:**

- **Charts (VL): inline in the spec — it's native.** `title: "Monthly Revenue"` is the rename,
  `axis: {format: "%b %Y"}` / `format` on tooltips is the format. Nothing custom to build; the agent already
  knows this syntax.
- **Widgets (table/pivot/trend/single_value): a per-question `columnMeta` record** — essentially today's
  `columnFormats` (`alias` + `format` + `prefix`/`suffix`), with the format field switched to d3 strings. There's
  no grammar to express it there, so the structured record is right.
- **Builder-backed charts bridge the two:** the builder holds `columnMeta` and compiles it into the VL encoding
  (`title` ← alias, `axis.format` ← format) — the user renames once in the UI and it flows into the spec.
- **Detached charts:** the spec is the truth; the UI "rename column" affordance either does a targeted spec edit
  (set the encoding `title`) or routes through the agent. Honest edge of the detach model.

## 5. Honest costs

- **Renderer migration** — two chart stacks during transition; ~400KB gzipped for vega+vega-lite (lazy-loadable).
  Today's VizSettings is declarative enough that a mechanical VizSettings→VL converter is feasible; bounded
  migration, not an eternal fork.
- **Default VL aesthetics are mediocre** — author one MinusX VL `config` (JetBrains Mono, flat palette). One-time
  design task; much less code than `withMinusXTheme`.
- **Gaps vs ECharts** — no native radar or funnel in VL (waterfall/pie/nested-donut are fine). Keep the ECharts
  versions as legacy widgets or approximate via templates later.
- **Big-data rendering** — weaker than ECharts canvas above ~50k points; fine given result caps.

## 6. Runner-up considered: ECharts-option-as-spec

Keep ECharts, make the raw ECharts option the agent tier (structured yolo). Cheaper — no new renderer — and also
in-distribution. But it fails the two hardest requirements: no layout compiler (back to hand-managing
grids/margins for composition), and ECharts fails *silently* on bad options, so the feedback loop is "stare at a
blank chart". The 80% option.

## 7. Sequencing (each step ships alone)

1. **Add one viz type: `vega`** — content is a VL spec, data bound from the query result, org theme as base
   `config`, validate + compile + render feedback wired into the tool loop. Small PR, touches nothing existing,
   agent maximally unhobbled immediately. *This is the low-commitment probe: let the agent live with it a couple
   of weeks; results decide whether everything converges on it.*
2. **Story theming** — story-level `config` fragment merged under each embed's spec. Delete the branch's cascade
   machinery.
3. **Builder compiles to VL** for the simple cartesian types, with the detach model. Delete per-type ECharts
   builders as each type migrates. Widget slot-styling lands here too (replace `SingleValueConfig` enumerated
   fields with slots).
4. **Template files** (VL templates for charts, widget templates for DOM), legacy-question converter, retire
   the levers/capabilities/escape-hatch layer.

## 8. Cross-check against the Codex recommendation

A second, independent recommendation (Codex) reached ~90% the same architecture: VL as the canonical agent
contract, MinusX owns the envelope/data-binding/themes/validation/security, levers + capability matrix + escape
hatches retired, recipes for archetypes, `config` cascade, validator feedback loop. Convergence is signal. The
genuine deltas:

### Adopt from Codex

- **Field-vs-result-columns validation** — the best idea in their doc. The most common agent failure will be
  wrong field names, which VL renders as a silently-empty chart. Cross-check every `field` in the spec against
  the actual query-result columns and return `E_FIELD_NOT_FOUND at /layer/1/encoding/y/field … Available:
  margin_percentage, revenue, orders`.
- **Full Vega as tier-3 engine** (`engine: "vega"`) — closes the radar/funnel/advanced-geometry gap in the same
  ecosystem, still structured JSON, same validator/renderer. Caveat: full Vega is far less in-distribution and
  brutally verbose; treat it as a validated escape hatch, not a peer tier.
- **Pin Vega/VL versions and vendor the official JSON schemas.**
- **Typed slots on recipes** (`"accepts": ["temporal"]`) — makes recipe instances drop-zone-editable, so they
  stay builder-backed instead of instantly detached.
- **Migration via render-time adapter** — an adapter that renders existing `VizSettings` questions through the
  new pipeline is safer than a one-time data converter; convert later, keep a legacy fallback throughout.

### Push back on

- **Trend as a VL recipe (window/lag + layered text marks)** — the one real disagreement. Recipe wins on
  uniformity; DOM widget wins on typography: no container-relative sizing in VL (today's single_value uses
  `clamp(2rem, 10cqi, 6rem)`), no text selection, fiddly delta-pill layering, and `compareMode: 'previous'`
  (skip partial period) is awkward as transforms. **Decide via the spike**: build the trend KPI both ways.
  Prior: sparkline in VL, big-number card stays DOM.
- **JSON Patch for embed overrides** — right problem (deep merge over `layer`/`transform` arrays is ambiguous —
  exactly the branch's footgun), wrong mechanism: a patch targeting `/layer/1/...` breaks silently when the
  saved question's layers reorder. An override positionally coupled to a file it doesn't own is a time bomb.
  Simpler: embed overrides are **`config`-only** (theme-land, natively mergeable — covers restyling, which is
  what embeds need); anything deeper → the embed **forks the spec** and owns its copy.
- **"UI as a lens" over any spec** — the better end-state, and its cardinal rule (never round-trip a spec
  through a simplified model that drops unknown parts) is the invariant to keep. But partial editing of
  arbitrary specs is a big UI project; ship detach (§2) first, grow toward the lens (path-targeted inspector
  that edits `encoding.x` in place, preserving everything else).

### Codex gaps (covered above)

Column renames/formats (§4); the table/pivot styling story (they reject CSS-selectors-as-API but offer no
replacement — slots/§3 is the replacement); where recipes live and how the agent discovers them (workspace
files + skill docs, §2).

### Codex v2 update — what converged, what's still open

Codex revised its doc and absorbed most of the pushback: probe-first sequencing; the detach model (a `VizSource`
union with one authoritative source per viz, recipes materializable to native specs); versioned immutable recipes
(`trend@1`) with typed bindings + declarative params, no executable templates; a **renderer-neutral `fieldMeta`
layer** applied by the compiler wherever a field appears (native spec wins) — which is *better* than this doc's
"inline for charts, columnMeta for widgets" split and should be adopted; allowlisted CSS properties for DOM slot
styles; a security/limits section; explicit SQL-vs-viz-transform boundary; dual-vocabulary format migration.

Still open after v2:

1. **JSON Patch for embed overrides — unresolved disagreement.** Codex kept it. The fragility objection stands:
   `/layer/1/...` paths silently break when the saved question is edited. Position here remains: embed overrides
   are `config`-only; deeper changes fork the spec. If patches are kept anyway, they need guard semantics
   (JSON Patch `test` ops or anchor-based addressing) — decide in the RFC.
2. **The v2 precedence chain conflates two merge domains.** `MinusX < org < story < recipe defaults < fieldMeta
   < spec/params < embed patch` mixes VL `config` cascade (first three — one deepMerge of config objects, VL
   defines the semantics) with spec-level defaulting (recipe defaults, fieldMeta injection — a compile step we
   own). Implement them as two separate mechanisms or the merge code becomes the branch's cascade all over again.
3. **Trend-as-Vega-recipe is now more credible** — full Vega's width/height signals do give responsive sizing
   (weakening the `clamp(2rem, 10cqi, 6rem)` objection), and `params.valueFontSize` answers agent styling. The
   spike still decides (build it both ways); the residual concern is *semantic*: "skip partial current period"
   as Vega date-boundary expressions is gnarly — consider keeping compare-mode math in SQL or the recipe binding
   layer even if rendering is Vega.
4. **fieldMeta injection into native specs is real code we own** — a field-reference walker over specs. Synergy:
   it's the *same walker* the validator needs for `E_FIELD_NOT_FOUND`; build it once for both.
5. **Still absent from Codex v2** (carry into the RFC): CSP-safe expression evaluation (`vega-interpreter` /
   `ast: true`) for guest-rendered public stories; dark/light mode as two config variants recompiled on switch;
   reserving a story-param → VL `params` binding block in the envelope; lazy-mount/virtualization for dense
   dashboards; timezone-sensitive temporal parsing of JSONL wire data in the spike's parity cases.

### Codex v3 update — convergence reached

The v3 revision resolves the remaining disagreements and adds material we should keep:

- **JSON Patch dropped.** Embed customization is now: story/embed config as *theme defaults* (cannot override
  explicit spec properties) + stable recipe params for supported per-instance changes + **fork the spec** for
  anything structural. This is the §8 position; disagreement closed.
- **CSP interpreter, correctly specified** — including the detail that `ast: true` alone is insufficient (the
  view also needs `expr: vega.expressionInterpreter`), that interpreter mode is CSP-compatibility rather than a
  full security boundary, and that it has a measurable perf cost. Better than this doc's one-liner.
- **Native-Vega theme contract** — light/dark parser configs plus stable `mx*` theme signals
  (`mxForeground`, `mxPositive`, …) that recipes reference. Answers the dark-mode gap for the Vega tier.
- **Param namespaces reserved now** (`dataBindings` / `viewParams` / `interactions.outputs`) with cross-filter
  as a MinusX-owned *typed event*, not raw Vega signals exposed to other questions. Stronger than this doc's
  "reserve a params block".
- **Radar semantic scaling** — their addition, and it's right: the hard radar problem is metrics with different
  units sharing one radial scale, not geometry. Recipe requires an explicit domain strategy; compiler warns.
- **Trend acceptance criteria + expanded spike benchmark list** — makes the DOM-vs-recipe decision and the
  perf/bundle claims empirical instead of asserted. Adopt wholesale.

### Considered by neither doc originally

- **Untrusted-spec execution safety** — Vega expressions are evaluated code; public stories render for guests.
  Use Vega's CSP-safe AST interpreter mode (`ast: true`) from day one.
- **Dark/light mode** — VL config is baked at compile time; mode switch = recompile with the other config
  variant. Must be designed in (two config variants); canvas can't read CSS variables.
- **Param/selection binding** — reserve a `params` binding block in the envelope now (story `:param` → VL
  params; later VL selections → cross-filtering embeds), even if unimplemented in v1.
- **Per-chart runtime cost** — 20 embeds = 20 Vega view instantiations, heavier than ECharts; lazy-mount /
  virtualize from the start.
- **Temporal data over the wire** — JSONL string dates vs VL temporal parsing is the classic migration gotcha;
  the spike's parity cases must include a timezone-sensitive date axis.

## 9. Case study: adding a radar plot

A concrete walkthrough of "how does a new chart type get added" under the proposed architecture. Radar is the
perfect test because Vega-Lite genuinely cannot express it (no polar coordinate system — `arc` covers pie, but
there are no angular axes for line/area marks).

**It is neither a new mark nor a new engine.** Vega has no spec-level plugin API for marks — a "custom mark"
means forking the renderer, the one thing this architecture forbids. And radar doesn't meet the custom-mark bar
(a new geometric primitive that can't be composed): it's line/area marks under trig transforms plus rule marks
for spokes.

**Radar = `radar@1`, a versioned recipe with a full-Vega body.** The Vega example gallery has a canonical radar
spec (solidly in-distribution for the agent). Mechanics: an angular `point` scale mapping categories onto
`[0, 2π]`, a linear radial scale, line/area marks at `x = radial(value) * cos(angular(category))` (sin for y),
grid rings/spokes as rule marks, labels as text marks. Parameterized:

```json
{
  "id": "radar@1",
  "engine": "vega",
  "bindings": {
    "category": { "accepts": ["nominal"] },
    "value":    { "accepts": ["quantitative"] },
    "series":   { "accepts": ["nominal"], "optional": true }
  },
  "params": {
    "fillOpacity": { "type": "number", "default": 0.25, "min": 0, "max": 1 },
    "gridRings":   { "type": "number", "default": 4 },
    "showLabels":  { "type": "boolean", "default": true }
  },
  "spec": { "…parameterized Vega body…" }
}
```

Everything else comes from the platform: the query result injected as the named dataset (long format —
`category, series, value` — is the natural shape, a SQL concern), `fieldMeta` for titles/formats, org/story
theme config for fonts/palette, the field-aware validator, the preview render. The UI derives drop zones from
`bindings` and generic controls from `params` — no radar-specific panel; the chart stays builder-backed. Agent
needs more (log radii, a highlighted band) → materialize to native Vega and edit.

**Effort:** roughly half a day, once, for one JSON file — zero TypeScript. Versus the current architecture's
cost: an ECharts builder path, a `VIZ_CAPABILITIES` entry, lever wiring, panel visibility rules, prompt docs —
and every styling request afterward becoming a new lever.

**Migration:** existing saved radar questions keep rendering through the legacy ECharts adapter until `radar@1`
reaches parity.

**Spike implication — add radar as parity case #7.** Trend tests full-Vega recipes but drags data semantics
(compare mode) with it. Radar is the *pure* test of the recipe contract: geometry-only, expressible entirely as
one parameterized spec. If `radar@1` comes out clean, the recipe abstraction is proven.

## 10. Decision status after Codex v3

Resolved by convergence: probe-first sequencing; embed semantics (config defaults + recipe params + fork — JSON
Patch dropped); the spike case list (Codex's 6 + radar as #7, trend built both ways against explicit acceptance
criteria); format migration (dual vocabulary, versioned, lazy migration); CSP interpreter mode; native-Vega
theme signals; param namespaces.

**Final decisions (Vivek, 2026-07-10):**

1. **Next step: merged RFC first** — both discussion docs fold into `docs/Visualization Arch V2.md`; the probe
   starts from the agreed spec.
2. **The probe ships themed** — the MinusX org VL config is included in step 1.
3. **Leaflet stays** — customers need maps with tile context, so `<MapView>` survives as a frozen-legacy
   renderer for tile-backed maps (3 leaf renderers). Analytic geo (choropleth/points/lines/density) still
   migrates to the grammar per §14; new maps default to the Vega recipes.
4. **`viz-styles-prop` is abandoned, salvage later** — not merged; its test ideas (theme precedence, story
   overrides) get reimplemented against the V2 contract when relevant.

> **This document is superseded by `docs/Visualization Arch V2.md`** (the merged RFC). It is retained as the
> discussion record.

## 11. Answers to the V2 RFC open questions

Positions on Codex's 14 RFC questions — proposed answers to take into the merged plan.

**1. Source of truth (builder vs generated spec).** Persist the compiled spec alongside the builder state,
stamped with a content hash of `(builder state, compiler version, theme version)` — guests and server rendering
read the spec without running the builder compiler; staleness is detectable and regeneration is deterministic.
The builder remains authoritative: every builder edit regenerates the spec. Sync is enforced **at save time in
the content validator** (the same three-layer-defense pattern as permissions, `content-validators.ts`), not in
prompt docs: while `source.kind === 'builder'`, a write that touches the compiled spec without the matching
builder change is rejected; the agent's path to spec freedom is an explicit detach operation that flips `kind`
to `vega-lite` in the same write.

**2. Trend implementation.** Decided by the spike against the v3 acceptance criteria, with a decision rule so it
can't stall: if the Vega recipe passes every criterion, the recipe wins (uniformity is worth real value); a DOM
widget only if the recipe *materially fails* a criterion — ties go to the recipe. `single_value` follows
whatever trend decides. Semantics split regardless of winner: business-specific "is this period complete" rules
live in SQL; generic previous-row comparison lives in the recipe's transforms.

**3. Embed semantics.** Yes — theme defaults only, per v3. One addition: a fork records provenance
(`forkedFrom: {fileId, contentHash}`) so the UI can show "restyled copy of Q123" and offer a *manual* re-sync;
without provenance, forks silently rot.

**4. Field metadata.** All renderers consume `fieldMeta`, **including detached specs** — injection only fills
*absent* `title`/`format`, explicit spec values win. So detached specs do not give up the global rename/format
UI; a UI rename writes `fieldMeta` and takes effect unless the spec explicitly overrides that field. One scope
rule: `fieldMeta` is keyed by *query-result columns only* — fields created inside spec transforms
(`calculate`, `fold` outputs) are styled in-spec, since they don't exist at the envelope layer.

**5. Format migration.** The versioned format object is self-discriminating: presence of `format.kind` = new
vocabulary; legacy `dateFormat`/`decimalPoints` = old. Write-new-only from day one (any edit through the new UI
or agent emits d3 patterns), read-both indefinitely — legacy read support is a small pure function, not a
deadline. No silent bulk rewrite ever.

**6. Recipe identity.** Recipes are **workspace files** (a `recipe` file type), so orgs can author them — the
filesystem-BI win; shipped recipes (`trend@1`, `radar@1`) are seeded via the workspace template like other seed
docs. Version lives in the id; the validator rejects body edits to a published version (edit = publish `@2`).
The dependency problem dissolves by **always materializing**: a recipe *instance* stores the fully materialized
spec plus the recipe ref `{id, version, contentHash}` + bindings/params. The materialized spec is what renders —
recipe deletion breaks nothing, public stories carry no dependency, no runtime resolution. The ref is
provenance + the affordance for re-parameterization and explicit (never automatic) upgrades.

**7. Recipe discovery.** Both: a generated catalog in the visualizations skill (id, one-line description,
bindings summary — the existing live prompt-vars pattern) for in-distribution defaults, and `SearchFiles` for
the long tail. The catalog lists only published org recipes.

**8. Binding mechanism.** Structural substitution at declared slots — never string templating. Field bindings:
the recipe body marks slots as `{"field": {"$binding": "dimension"}}`; materialization replaces exactly those
nodes. Params: each param maps to a **named signal declared in the recipe body**; param values override the
signal's `init` only. Validation: every `$binding` in the body is declared in `bindings`, every param maps to an
existing signal, no other substitution exists. That's the whole language.

**9. Security policy.** One module, one boundary, both tiers: reject external `data.url`/`data.format` (only
the injected named datasets); deny `href`/external image URLs (allowlist own object store if needed); no Vega
extensions or custom expression functions; interpreter mode for **all** agent/user-authored specs client and
server (one code path — not a special guest mode); event config denies window/timer/CSS-selector sources by
default; every view finalized on unmount; limits per Q14. Enforced in the validator + a single view-factory —
never at call sites.

**10. Theme contract.** One MinusX token source (a single TS module) *generates* all four artifacts — VL light
config, VL dark config, Vega parser configs + `mx*` signal defaults — so palettes cannot drift between tiers.
Mode switch = recompile with the alternate config (simple, correct); the signal-update fast path only if the
spike shows recompile jank at ~20 views. Native Vega recipes must reference `mx*` signals for anything themable
— reviewed at recipe publish time.

**11. Parameter contract.** Adopt the v3 namespaces as-is, with sequencing: `dataBindings` binds the *existing*
`:param` system (re-executes the query — no new machinery); `viewParams` = recipe params/named signals, lands
with recipes; `interactions.outputs` = MinusX-owned typed events (`{type: 'filter', field, operator, values}`),
reserved now, implemented with cross-filtering later. Reserved signal prefix `mx` to keep theme/system signals
out of spec-author namespace.

**12. Specialized surfaces.** Table and pivot (one grid renderer, §13) are the only firm long-term specialized
renderers. Geo folds into the grammar (§14): choropleth/points/lines are native Vega-Lite, density is a
full-Vega recipe; Leaflet survives at most for raster street tiles, and is deleted outright if vector basemaps
suffice. **Arbitrary widget templates are explicitly deferred** — dropped from the V2 contract; the allowlisted
slot-CSS idea revives only if the trend spike picks the DOM widget (in which case it applies to
trend/single_value and nothing else).

**13. Legacy strategy.** Per-type flips, each governed by a measurable gate: (a) the builder compiles that type
to VL, (b) the `VizSettings` adapter renders *all* saved instances of that type with visual spot-checks on real
workspace data, (c) a dual-render period shows no legacy fallback hits for that type. Funnel and radar flip
last (they need recipes). The ECharts dependency — and its bundle weight — is removed only when the last type
flips; until then it's adapter-only.

**14. Operational limits.** Don't put invented numbers in the RFC — the spike benchmark exists to produce them.
Ship the probe with deliberately conservative caps (existing result-row cap; ~20k mark instances warn / 100k
error; transform depth 10; server render timeout 5s; concurrent live views bounded by virtualization) and a
note that each is to be calibrated by the spike's measurements under interpreter mode.

## 12. Final items before merging the plans

1. **Don't reproduce Vega/VL in TypeBox.** The envelope (`version`, `source`, `fieldMeta`, param namespaces) is
   TypeBox in `atlas-schemas.ts`; `spec` bodies are `Type.Unknown` there and validated by the vendored official
   JSON schemas + the field-aware pass. Both docs imply this; the merged plan should state it as a rule before
   someone helpfully starts transcribing the VL schema.
2. **Envelope placement needs a decision**: new `content.viz` (v2 envelope) alongside legacy `vizSettings`
   during migration, with the adapter reading old and new — or in-place versioning of `vizSettings`. Lean:
   new key + adapter; never mutate saved legacy content silently.
3. **The shared spec-walker is a named deliverable** (validator `E_FIELD_NOT_FOUND` + `fieldMeta` injection use
   the same field-reference traversal — build once, probe step 1).
4. **Probe follows house TDD**: contracts (envelope schema, validator interface, renderer props) → red tests
   (validation errors, field-aware errors, data binding, theme merge) → implementation → browser-verify with
   the side-chat debug view to confirm what the agent actually receives in the skill/tool result.
5. **Chart→LLM image pipeline** must be in probe scope, not the spike: `buildChartAttachments` needs a Vega
   render path or agent-authored charts will be invisible to the agent in follow-up turns — which would
   contaminate the probe's "does the agent behave well" evidence.
6. **Merge mechanics**: the two documents are now ~one document. Proposal: fold both into a single
   `docs/Visualization Arch V2.md` RFC (contract, cascade, recipes, security, spike protocol with acceptance
   criteria, migration gates, the Q1–Q14 answers above), and retire both discussion docs to an appendix or
   delete them.

## 13. Pivot, and the final component surface

**Pivot folds into the platform and into *table* — not into Vega.** Three layers hide in "pivot":

- **Envelope**: already fully folded — `source.kind: 'pivot'`, `fieldMeta` for value formats/header renames,
  theme tokens for heatmap/striping, save-time validation. Nothing pivot-specific at this layer.
- **Computation**: `aggregatePivotData()` (`lib/chart/pivot-utils.ts`) is already a pure function; it stays TS.
  Vega-Lite's own `pivot` transform covers the *pivot-then-plot* cases (a heatmap becomes a VL `rect`+`text`
  spec), so a slice of today's pivot usage migrates to the grammar naturally.
- **Rendering**: DOM stays. Nested spanning headers, collapsible groups, subtotals, sticky headers, text
  selection, virtualization — all DOM-native; Vega text-mark "tables" are a known anti-pattern (no a11y, no
  selection, no virtualization).

The real consolidation: **pivot is a table with a data transform and a header tree.** `TableV2` and
`PivotTable` unify into one virtualized **grid renderer** taking `(rows, columnTree, cellMeta)` — plain table
passes a flat column tree, pivot passes the cross-tab output. Striping, conditional formats, `fieldMeta`, and
slot styles implemented once, applied uniformly. The `VizSource` union accordingly carries `table` and `pivot`
as two configs over one renderer.

**The final React surface is one public component.** `<VizContainer>` (Redux: query result, theme, color mode)
→ `<Viz>` view routing on `source.kind` to exactly three leaf renderers:

1. `<VegaView>` — the only chart component. All grammar kinds (`builder`, `recipe`, `vega-lite`, `vega`) end at
   the Vega runtime; one component owns compile → parse (`ast` + interpreter) → mount → resize → theme
   recompile → finalize-on-unmount. (Plus a headless sibling for server preview/export and chart→LLM images.)
2. `<GridView>` — table + pivot, unified per the above.
3. `<MapView>` — Leaflet; per §14 likely deletable, surviving at most for raster street tiles.

Every surface that renders a viz — `QuestionVisualization` routing, dashboards, story embeds, notebook cells,
chat detail cards, image attachments — consumes the same `<Viz>`. Today's ~15 per-type renderer components
(`LinePlot`, `BarPlot`, `AreaPlot`, `PiePlot`, `FunnelPlot`, `TrendPlot`, `SingleValue`, `TableV2`,
`PivotTable`, `ChartBuilder`'s switch, …) and their per-type panels collapse into those three. This is the
architecture restated in React terms: **chart types stop being components and become data.** What remains
component-shaped is editor chrome (drop zones, inspector, `params` controls, `fieldMeta` popover) — generated
from bindings/params metadata, not written per chart type. (If the trend spike picks the DOM widget, it adds a
fourth small leaf renderer; if the recipe wins, it doesn't.)

## 14. Geo folds into the grammar too — Leaflet is (almost) an offshoot we can delete

Current geo surface (`GeoConfig`, `atlas-schemas.ts:37-88`): four subtypes — `choropleth` (regionCol/valueCol
against `mapName` GeoJSON), `points` (lat/lng + bubble size via valueCol/minRadius/radiusScale + colorCol),
`lines` (origin→destination pairs), `heatmap` (lat/lng density) — plus `showTiles` (OSM raster layer) and
`pinnedCenter`/`pinnedZoom`. All rendered by Leaflet.

Vega/VL have first-class geographic support: projections, `geoshape` marks, `longitude`/`latitude` encoding
channels, TopoJSON/GeoJSON data, `lookup` joins. The subtype mapping:

| Current subtype | Grammar equivalent | Tier |
|---|---|---|
| `choropleth` | `geoshape` mark + `lookup` transform joining regionCol to boundary features + color encoding | Vega-Lite, native |
| `points` (+ radius/color) | `circle` mark with `longitude`/`latitude` channels; `size` and `color` encodings | Vega-Lite, native |
| `lines` | `rule` mark with `longitude`/`latitude` + `longitude2`/`latitude2` (the canonical VL flight-routes example); great-circle paths via full-Vega `geopath` | Vega-Lite, native |
| `heatmap` (density) | KDE/contour transforms (`kde2d`, `isocontour`) over projected coordinates | full Vega, recipe |

What this buys:

- **The bespoke options die the same death as the chart levers.** `colorScale: 'green'|'blue'|'red-yellow-green'`
  → `scale: {scheme: …}` (every d3 scheme, free); `minRadius`/`radiusScale` → a real `size` scale with domain
  and range; `pinnedCenter`/`pinnedZoom` → projection `center`/`scale` params, with signal-driven pan/zoom (the
  Vega zoomable-map pattern) where interaction is wanted.
- **Boundary data becomes platform-hosted named datasets** (`topo:world`, `topo:us-states`,
  `topo:india-states`, …) injected like query results — which satisfies the no-external-URL security policy
  instead of fighting it. `mapName` becomes a dataset reference; adding a new region = adding a data file, not
  code.
- **Ship the four subtypes as recipes** — `choropleth@1`, `geo-points@1`, `geo-lines@1`, `geo-density@1` — with
  typed bindings (region/value; lat/lng/size/color; origin→dest pairs) and params (projection, center, scale,
  scheme, basemap dataset). The UI gets drop zones from bindings as with radar; the agent materializes for
  anything unusual (bivariate choropleths, labeled flows, small-multiple maps — all reachable in the grammar,
  none reachable in today's `GeoConfig`).

**The irreducible remainder: raster street tiles** (`showTiles`). Slippy-tile UX — inertia pan/zoom, tile
caching, street-level detail — is what Leaflet is actually for. Vega tile hacks exist (XYZ image marks computed
from projection signals) but the UX is worse and external tile URLs violate the security policy. So the
decision compresses to one question: **do our users need street-level tile context, or are analytic vector
basemaps (boundaries + land/water fill) enough?**

- Vector suffices (likely for BI-style maps — worth checking actual `showTiles` usage in saved questions) →
  **delete `<MapView>` entirely; two leaf renderers** (`<VegaView>`, `<GridView>`).
- Tiles genuinely needed → Leaflet survives *only* for tile-backed maps, frozen as legacy; new maps default to
  the Vega recipes.

**Spike implication — add case #8:** a choropleth with a bubble overlay from the `choropleth@1`/`geo-points@1`
recipes over platform TopoJSON, plus a density map in full Vega — proving the geo tier and the named-boundary-
dataset mechanism together.
