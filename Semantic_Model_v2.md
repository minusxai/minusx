# Semantic Model v2

Plan for the authored semantic layer: raw tables → data models (views) → semantic
models, with relationships declared **inside** the semantic model (not at
table/model level), validated metrics, and a UI/agent surface that exposes only
metrics + dimensions.

**Delivery: ONE PR.** Everything in this doc — including many_to_many — ships
together in a single large PR. §6 breaks it into six ordered milestones
(M1–M6) — commit stages *within* that PR, each TDD'd and green, not separate
releases — with per-milestone checklists an executing agent follows verbatim.

**Status: derisked by executed experiments (2026-07-21).** The load-bearing
claims below were proven by running code against the real repo (IR generator,
polyglot parser, DuckDB execution on fixture data) — see §4/§5. In particular:
m2m needs **no IR extension** (existing CTE + join support suffices, verified
end-to-end with correct aggregation numbers), and metric-SQL ref extraction is
lexer-based **by decision, verified necessary** (the polyglot parser returns
opaque `raw` for even trivial compound aggregates). The doc states decisions,
not options.

## 0. The levels

| Level | What | Authored as | Queryable by agent |
|---|---|---|---|
| 1. Raw tables | Physical tables from a connection | Schema whitelist + descriptions + exposed fields (existing `context` versions) | Free SQL |
| 2. Data models | SQL views over raw tables and other data models | `ViewDef` (existing `lib/views/`, addressed as `_views.<name>`) | Free SQL |
| 3. Semantic models | Declarative: primary model + referenced models + relationships + metrics | `SemanticModelV2` (stored — §2.3) | **Semantic queries only** (compiled, validated) |

Strict level ordering, enforced at save: views reference tables/views (acyclic —
already enforced by `lib/views/integrity.ts`); semantic models reference
tables/views; nothing references a semantic model. Free SQL against levels 1–2
may use metric definitions as *reference documentation* (unvalidated); semantic
queries against level 3 are fully validated because the compiler — not the LLM —
generates the SQL.

## 1. What already existed (verified in-repo — the pre-PR baseline)

Much of the machinery was built. V2 is a **restructure + extension**, not
greenfield. *(Historical: this section describes `main` as found before the PR;
every "old shape" named here — the old `SemanticModel` with `measures`/`joins`,
`TableRelationship` — has since been removed by M6.)*

- `lib/types/semantic.ts` — `SemanticModel` (base table, `dimensions`,
  `measures`, `joins`, ratio `metrics`), `SemanticJoin` (alias, LEFT/INNER,
  `many_to_one | one_to_one` cardinality, equi-join columns), `SemanticDimension`
  (`join?` alias for joined-table fields).
- `lib/semantic/compile.ts` — `compileSemanticQuery(spec, model)` already
  compiles measures/dimensions/timeGrain/filters + **joins from declared
  relationships** into `QueryIR`; `irToSqlLocal` emits dialect SQL (DuckDB /
  BigQuery / Postgres). Base-column qualification when joins are in play,
  `NULLIF`-guarded ratios, spec validation with human-readable issues
  (`validateSemanticQuery`).
- `lib/semantic/derive.ts` / `models.server.ts` — models are currently
  **derived per-request** from profiled schema + table-level relationships
  (NOT stored; the doc-comment in `semantic.ts` claiming a `semanticModels`
  field on `ContextVersion` is stale).
- `lib/types/semantic.ts` → `TableRelationship` — FK relationships declared
  **per table** on `ContextVersion.relationships`, inherited via
  `fullRelationships`. **This is what v2 removes.**
- `lib/views/` — the data-model tier: `ViewDef` stored on `ContextVersion.views`,
  save-time `LIMIT 0` column probe (`prepare.server.ts`), name-uniqueness across
  the context tree, integrity/impact checks (`save-gate.server.ts`,
  `integrity.ts`).
- `lib/sql/` — the IR layer: `parseSqlToIrLocal` (polyglot WASM parser),
  `irToSqlLocal` (**our own pure-TS generator**, `ir-to-sql.ts` — not the
  WASM `generate()`), `ir-transforms.ts`; used by the params None-handling
  round-trip.
- `SemanticQuerySpec` in `lib/validation/atlas-schemas.ts` (+
  `QuestionContent.semanticQuery`, currently gated).
- **Live derived-model query surface (verified):**
  `components/query-builder/SemanticExplorer.tsx` is rendered by
  `QuestionViewV2.tsx` today — it consumes old-shape DERIVED models via
  `lib/hooks/use-semantic-models.ts` / `use-semantic-compat.ts` /
  `lib/semantic/models-client.ts` / `POST /api/semantic-models`
  (`app/api/semantic-models/route.ts`) and calls `compileSemanticQuery`
  client-side. The same family includes the **detection path** —
  `lib/semantic/detect.ts` / `detect-sql.ts` (recompile-and-compare: does
  existing SQL match a semantic spec, enabling the question editor's Semantic
  mode tab — distinct from any context-editor tab; see §2.0 item 5), which
  consumes the old shape (`model.joins`, `dimension.join`) and feeds
  `use-semantic-compat.ts` / `QueryModeSelector.tsx` / `SqlEditor.tsx`.
  UI tests: `semantic-autorun.ui.test.tsx`, `viz-type-lock.ui.test.tsx`,
  `create-question-modal.ui.test.tsx`, AND
  `components/query-builder/__tests__/{SemanticExplorer,QueryModeSelector}.ui.test.tsx`
  (22 + 5 tests — the largest and most directly relevant suites); node tests:
  `lib/semantic/__tests__/{compile,detect,infer-viz}.test.ts` (these never
  mention `TableRelationship`, so the §2.2 removal grep does NOT size them —
  they're M2 blast radius, not M6). This surface must keep working at every
  milestone boundary — its staged handover is §2.7.

## 2. V2 changes

### 2.0 V2.1 — simplification (landed post-M6: `8e77e10b`, plus `fa0f4458`)

After M6 the shipped shape was simplified in place. The doc below is written to
the **V2.1 state**; where a milestone checklist recorded the pre-simplification
behavior, the item carries a "(superseded in V2.1: …)" note. The changes:

1. **Measures are gone as a concept.** `SemanticModelV2.measures` and
   `SemanticModelV2.timeDimension` no longer exist. `metrics` is a REQUIRED
   array of `SemanticMetricV2` — a union discriminated on `type` with three
   members: `aggregation` (COUNT/SUM/AVG/MIN/MAX/COUNT_DISTINCT over a
   primary-source column; `column` omitted for COUNT(*)), `ratio`
   (numerator/denominator naming aggregation metrics of the same model), and
   `sql` (unchanged rules). Rationale: ONE user-facing quantitative concept —
   what other semantic layers (MetricFlow, LookML) call a "measure" is simply
   the aggregation metric type here.
2. **The time axis is implicit.** A dimension with `temporal: true` is a time
   dimension; the FIRST primary temporal dimension is the model's default axis
   (`spec.timeColumn` may name any primary temporal dimension's column). Tier 1
   validates a temporal-flagged dimension's column type when the type is known.
3. **`SemanticQuerySpec.measures` renamed to `metrics`.**
4. **Probe scope (tier 3) refined:** a changed/added metric probes itself,
   where a ratio metric's essence EMBEDS the resolved definitions of its
   aggregation metrics — so changing an aggregation metric re-probes it plus
   its dependent ratios, but NOT unrelated metrics (§2.5 has the full rules).
5. **UI moved and unified:** no "Semantic" tab in the context editor and no
   separate catalog mode — semantic models render PER-CONNECTION inside the
   Databases tab, above Data Models, as ONE card layout serving both read and
   edit modes (§6 M5b has the details).
6. **Join inference:** new pure module `lib/semantic/infer-join.ts` proposes
   join columns when the author picks a reference source or m2m bridge; joins
   are displayed as real column equalities, never "bridge/primary/referenced"
   jargon.
7. **Composite-key m2m is fully supported**, including the grouped
   dedup-bridge CTE, which projects one `_pk<k>` per primaryKey column and
   joins on ALL of them (`fa0f4458` fixed a prefix-match leak).

### 2.1 Semantic models become authored + stored

Replace per-request derivation as the source of truth. Models are **authored**
(by user or agent), stored on `ContextVersion.semanticModels:
SemanticModelV2[]` — same versioned/inherited pattern as `views`, `metrics`,
`annotations`. (The stale doc-comment becomes true.) Derivation survives only as a *suggestion*
engine: "create a semantic model from this table" pre-fills a draft.

Why context-version storage over a new file type: it matches how `ViewDef` and
`MetricDef` already live, inherits scoping/permissions for free, and avoids the
~10-file new-file-type surface (`FILE_TYPE_METADATA`, create menu, tiles,
access rules). A dedicated `/semantic-models` editor UI can still exist without
a new file type.

### 2.2 Relationships move INTO the semantic model (and out of tables)

- **Delete `TableRelationship`** and `ContextVersion.relationships` /
  `fullRelationships`. Relationship declaration at table/model level is gone.
- The semantic model is the only place join semantics live. Rationale: the same
  two models can relate differently in different semantic contexts; a global FK
  registry forces one interpretation and creates spooky action at a distance.
- **Migration rule (precise): no stored data is rewritten, no readers kept.**
  Context versions are immutable history — the migration does NOT touch stored
  `relationships` arrays on existing versions; the field simply goes inert.
  All code read/write paths are removed (`lib/types/context.ts` types,
  loaders, `fullRelationships`,
  whitelist UI, `app/api/relationships/verify`, `EDITABLE_VERSION_FIELDS` in
  `context-agent-view.ts`) — including any fallback reader: **no existing
  workspace has declared relationships or authored models**
  (operator-confirmed, 2026-07-21; the seed template also contains zero —
  verified), so inert data is vacuously absent and a fallback/suggester read
  path would be dead code. The draft-suggestion engine proposes a single-table
  draft (temporal-first dimensions, aggregation metrics, inferred grain) from
  profiled schema, not from stored relationships; **references are always authored explicitly** — nothing
  infers them.
- **Real removal surface (verified by grep, 21 files = 16 source + 5 test):**
  source — `lib/types/semantic.ts` + `lib/types/context.ts` + `lib/types.ts`,
  `lib/semantic/{derive,models.server,verify.server}.ts`,
  `lib/context/context-agent-view.ts`, `lib/data/loaders/context-loader{,-utils}.ts`,
  `app/api/relationships/verify/route.ts` (route deleted),
  `components/context/{ContextEditorV2,DatabasesTabContent,TableRelationshipsEditor}.tsx`,
  `components/containers/ContextContainerV2.tsx`,
  `components/schema-browser/SchemaTree{View,SchemaRow}.tsx`; test —
  `components/context/__tests__/table-relationships-editor.ui.test.tsx`
  (whole file deleted with its component) and
  `lib/semantic/__tests__/{compile-execute,derive,models-server,verify-server}.test.ts`
  (updated/replaced across M2–M6 as their subjects change). M6 is sized
  against this list.
- **Free-SQL join hints are preserved, not regressed:** today
  `context-agent-view.ts` feeds table relationships into the agent's free-SQL
  context docs. After the move, the same channel is fed by **projecting each
  authored semantic model's `references`** (primary, alias, cardinality, join
  columns) into the context docs alongside the metric definitions of §2.4 —
  semantic models become the single source of join documentation for levels
  1–2 as well. Where no semantic model exists yet, there are no hints — and
  this is NOT a regression for anyone: no existing workspace has declared
  relationships today (operator-confirmed), so the old channel currently
  emits nothing anywhere.

### 2.3 Model shape: primary + references (with per-reference exposure)

Restructure `SemanticModel` around the user's design — one **primary**, N
**references**, each reference declaring its relationship to the primary.
Fields of the primary and of references are exposed by naming them as
`dimensions` (there is no separate per-reference field list — a dimension's
`source` says where its column lives):

```ts
interface SemanticModelV2 {
  name: string;                    // unique per context tree (like view names)
  description?: string;
  connection: string;
  primary: SemanticSource;         // ONE table or data model (view)
  /** PK column(s) of the primary — the model's grain. Declared ONCE here
   *  (not per-reference, so two m2m references can never disagree).
   *  Always allowed; REQUIRED when any reference is many_to_many. */
  primaryKey?: string[];
  references?: SemanticReference[];
  dimensions: SemanticDimensionV2[]; // { name, source: 'primary' | <ref alias>, column,
                                     //   temporal?, … } — `temporal: true` marks a time
                                     //   dimension; the FIRST primary temporal dimension
                                     //   is the model's default time axis (no separate
                                     //   timeDimension field — V2.1)
  metrics: SemanticMetricV2[];       // REQUIRED — the one quantitative concept
}

// Discriminated on `type` (V2.1 — no separate "measures"):
type SemanticMetricV2 =
  | { name; type: 'aggregation';     // COUNT|SUM|AVG|MIN|MAX|COUNT_DISTINCT
      agg; column?;                  // primary-source only; column omitted for COUNT(*)
      description?; verified? }
  | { name; type: 'ratio';           // numerator/denominator name AGGREGATION
      numerator; denominator;        // metrics of the same model
      description?; verified? }
  | { name; type: 'sql'; sql;        // free-form aggregate SQL (§2.5)
      description?; verified? };

type SemanticSource =
  | { kind: 'table'; schema?: string; table: string }
  | { kind: 'model'; view: string };          // a ViewDef → FROM _views.<name>

// Discriminated on `relationship`: to-one references join directly via `on`;
// many_to_many references join through a bridge (full shape in §5).
type SemanticReference = SemanticReferenceToOne | SemanticReferenceM2M;

interface SemanticReferenceToOne {
  source: SemanticSource;
  alias: string;                   // unique within the model; dims/metrics refer to it
  relationship: 'many_to_one' | 'one_to_one';
  joinType?: 'LEFT' | 'INNER';     // default LEFT
  on: { primaryColumn: string; referencedColumn: string }[];  // composite keys OK
}
```

Rules (save-time validated):
- Every reference MUST declare its `relationship` and its join columns (`on`
  for to-one, `through` for m2m — §5). No reference without a declared
  relationship — this replaces the removed table-level FKs.
- `many_to_one` / `one_to_one` are lookup joins — aggregation metrics
  aggregate the primary, so they can never fan out. `many_to_many` is compiled
  grain-preservingly (§5), never as a naive fan-out join. Pre-aggregating the
  many side into a data model remains a valid alternative authoring pattern.
- `dimensions[].source` must be `'primary'` or a declared reference alias, and
  `column` must be an **exposed field** of that source (whitelist for tables,
  probed output columns for views).
- **Aggregation metrics stay primary-column-only** (`{name, type:
  'aggregation', agg, column?}` — no `source` field) — that's what makes
  "aggregation metrics aggregate the primary, so they can never fan out" true
  by construction. Aggregating a to-one reference column is what SQL metrics
  are for (`SUM(costs.total)`).
- **Time axis is implicit (V2.1):** dimensions flagged `temporal: true` are
  the model's time dimensions; the FIRST primary temporal dimension is the
  default axis, and `spec.timeColumn` may select any primary temporal
  dimension's column instead. Tier 1 validates a temporal flag against the
  column's type when the type is known (unprofiled → check skipped); a bad
  axis then surfaces when a query first requests a `timeGrain` and the
  compiled `DATE_TRUNC` fails in the engine — accepted behavior.
- A view used as primary/reference must exist in the context tree (name
  resolution via existing view lookup); levels stay acyclic by construction
  (semantic models are not referenceable).
- **Reserved aliases:** a reference `alias` may not be `primary` (it would make
  every qualified metric ref ambiguous) nor match generated-name patterns
  (`_m2m_*`, `_views`, `_probe`, plus `_grain` reserved for future compiler
  use — nothing emits it today) — rejected at tier 1.
- **Model names share ONE namespace with view names** per context tree: a
  semantic model may not take an existing view's name and vice versa
  (references address views by bare name, and one catalog name meaning two
  things is exactly the ambiguity this doc exists to kill). Rejected at save,
  both directions (model save checks views; view save checks models).
- **Connection consistency:** the primary and every reference source (tables
  AND views, incl. m2m bridge sources) must resolve on the model's single
  `connection` — cross-connection joins cannot compile, so a mismatch is
  rejected at save with a pointing error rather than surfacing as a confusing
  tier-3 engine failure. `connection` here follows the exact
  `ViewDef.connection` pattern (flat field on the artifact; the UI groups
  models under their connection, same as views under `_views`): in the editor
  the connection is implied by the per-database Databases-tab section the
  model lives in (V2.1 — there is no connection picker), and the
  primary/reference pickers only offer sources from that connection — so the
  validator is a server-side backstop for hand-/agent-authored model JSON,
  not a path UI users hit.

Compiler change is mechanical: `compileSemanticQuery` already emits
`JoinClause`s from `joins`; it re-points at `references` and gains
`FROM _views.<name>` when the primary/reference is a model (views are already
addressable tables at query time).

### 2.4 UI/agent surface: metrics + dimensions only

- The semantic browse/query UI lists each model's **dimensions and metrics** —
  never raw tables or SQL.
- The agent's semantic tool (`RunSemanticQuery(model, metrics[], dimensions[],
  filters[], timeGrain, ...)` — the `SemanticQuerySpec` path; its `measures`
  field was renamed `metrics` in V2.1) takes business names; the compiler
  resolves them. The agent cannot write an invalid join by construction.
- Free-SQL contexts get metric definitions injected as documentation ("metric
  `revenue` on model `Orders` = `SUM(orders.amount) - SUM(orders.refund)`") —
  unvalidated reference material, alongside the reference/join-docs projection
  of §2.2 (both land in M5). Improves raw-SQL answers as soon as models
  exist, independent of anyone adopting semantic queries.

### 2.5 SQL metrics + validation

Free-form SQL metrics are the third member of the `SemanticMetricV2` union,
alongside aggregation and ratio metrics (§2.3):

```ts
interface SemanticSqlMetric {
  name: string;
  type: 'sql';
  sql: string;        // aggregate expression, e.g. "SUM(primary.amount) - SUM(ref_costs.total)"
  description?: string;
  verified?: boolean; // tier-3 stamp, server-managed (all three metric types carry it)
}
```

**Reference syntax:** column refs in metric SQL MUST be qualified as
`primary.<column>` or `<referenceAlias>.<column>`. Unqualified refs are a
validation error listing candidates ("`amount` is ambiguous: primary.amount,
refunds.amount"). This kills definition-time ambiguity outright and makes the
compiler's alias rewrite trivial (`primary` → the primary table/view name).

**Three validation tiers** (the "right feedback when editing", for both the
editor UI and the agent's EditFile path):

1. **Static (sync):** name uniqueness (one namespace per model across
   dimensions+metrics; enforced case-insensitively on
   `semanticAlias(name)` slugs so display names can't collide post-slug);
   reference aliases valid; every qualified column ref resolves to an exposed
   field of primary or a declared **to-one** reference — refs to a
   `many_to_many` alias are REJECTED ("metric SQL cannot reference m2m
   reference `tags`: aggregating across a many-side fans out; pre-aggregate it
   in a data model instead"). Metrics always aggregate at the primary's grain;
   letting `SUM(tags.weight)` through would reintroduce exactly the
   double-counting §5 exists to prevent. Column-ref extraction is a
   **qualified-identifier lexer** (`(alias).(ident)` over a comment/string-aware
   token stream) — NOT the polyglot parser. *Verified: the parser returns an
   opaque `type: 'raw'` select column for even `SUM(a) - SUM(b)`, so it
   extracts zero structured refs from any compound metric expression; the lexer
   is the mechanism, not a fallback.* **Quoted identifiers are rejected**, not
   lexed: metric SQL containing `"…"` / backtick identifiers fails tier 1 with
   a pointing error that states the consequence explicitly ("quoted
   identifiers aren't supported in metric SQL — a column that needs quoting,
   e.g. `Order Total`, must be renamed via a data model before it can be
   referenced") — silently mis-lexing them would be worse than refusing, and
   exposed-field names are already author-controlled at levels 2–3. Full semantic checking
   is tier 3's job.
2. **Compile (sync):** metric SQL compiles by alias-rewrite (`primary.` /
   `<refAlias>.` → real table/alias qualifiers) into a `type: 'raw'` select
   column, injected into a probe `SemanticQuerySpec` through
   `compileSemanticQuery` → `irToSqlLocal`. Catches join-alias resolution and
   structural issues. *Verified: `raw_sql` select columns (incl. CASE
   expressions) survive IR → SQL generation and execute correctly on DuckDB.*
3. **Dry-run (async, authoritative):** execute the compiled probe as
   `SELECT * FROM (<compiled>) AS _probe LIMIT 0` via `runQuery` — the exact
   pattern `prepareView` already uses; works on every connector today with
   zero connector changes. The probe always carries a GROUP BY (see "Probe
   shape" below) so a non-aggregate metric expression fails GROUP BY
   validation in the engine.
   Catches type errors, dialect issues, bad function names. (BigQuery
   `dryRun` / `EXPLAIN` connector methods are explicitly OUT of this PR — the
   `LIMIT 0` probe is the mechanism.)

Tiers 1–2 run synchronously on save/edit; tier 3 runs in the save gate
server-side (like `prepareView`) and returns structured errors to the editor
and to the agent tool result. **Blocking policy (decided):**

- Tiers 1–2 failures block the save unconditionally (they're pure/local).
- Tier 3 scope — exactly THREE cases, nothing else:
  (1) **metric-text-only** — the save adds/edits/deletes entries in `metrics`
  and touches nothing else: probe just the added/changed metrics (a pure
  deletion probes nothing) — so one pre-existing broken metric can never
  hold the whole model hostage while you fix something else. Change is
  judged on each metric's **essence** (definition minus `description` and
  the server `verified` stamp), and a ratio metric's essence EMBEDS the
  resolved definitions of the aggregation metrics it names — so changing
  `Revenue` from `SUM(total)` to `SUM(delivered)` re-probes Revenue AND
  every ratio built on it, but NOT unrelated metrics;
  (2) **metadata-only** — see the carve-out below: probe nothing;
  (3) **everything else is structural** — `primary`, `primaryKey`,
  `references`, `dimensions` (incl. `temporal` flags), `name`,
  `connection` — and probes ALL metrics: structural edits can break
  textually-unchanged metrics that tier 1 still resolves (swapping a
  reference's source view type-breaks `SUM(costs.total)`; a dimension
  rename breaks specs that name it).
- Tier 3 distinguishes **validation errors** (the engine rejected the SQL —
  blocks the save) from **infrastructure errors** (connection unreachable,
  timeout — save proceeds, the metric is stamped `verified: false` with the
  error surfaced). Fail closed on bad SQL, fail open on a down warehouse: a
  warehouse outage must not make models uneditable. No general draft state
  beyond this flag.
- Re-probe rule for `verified: false`: those metrics are ALWAYS included in
  the probe set of every subsequent save of the model (regardless of scope
  case), until they verify. No query-time re-probing — saves are the only
  probe trigger, so the whole policy lives in one place (M4).
- Probe shape: the probe query is the metric plus a GROUP BY in every case —
  the model's **first non-m2m-sourced dimension** when one exists (an m2m probe
  dimension would drag a bridge CTE into a probe that only needs to validate the
  metric, so a model whose dimensions are all m2m-sourced takes the
  zero-dimension path); with zero dimensions,
  group by the **first exposed column of the primary** (plain-column
  grouping — standard SQL everywhere; execution-verified on DuckDB and real
  Postgres/PGLite, incl. that a non-aggregate metric correctly fails).
  Either way a non-aggregate metric expression fails GROUP BY validation in
  the engine itself — no tier-1 aggregate-token list to maintain, and
  dialect-specific aggregates (`MEDIAN`, `APPROX_COUNT_DISTINCT`, …) work
  without a whitelist. Last resort ONLY when no exposed column is known:
  constant grouping (`SELECT 1 AS _probe_dim … GROUP BY 1` —
  DuckDB+Postgres-verified; unverified on BigQuery, deliberately: that edge
  is unreachable on BQ, whose schemas always load from
  `INFORMATION_SCHEMA`, so an exposed column always exists there).
- Metadata-only carve-out: edits touching ONLY `description` fields (model,
  dimension, or metric descriptions) cannot affect compiled SQL and probe
  NOTHING.
- Renames, precisely (they'd otherwise straddle two cases): **dimension and
  reference-alias renames are structural** — other definitions reference
  them by name (metric SQL names aliases; specs name dimensions), so a
  rename can break a textually-unchanged metric. **A METRIC rename stays
  case (1)** and probes the renamed metric under its new name only — an
  aggregation-metric rename included: a ratio metric still naming the OLD
  name fails tier 1 first ("not a declared aggregation metric"), so tier 3
  never sees the dangling reference.
- Probe execution policy (decided, so M4 doesn't improvise): probes for one
  save run in **parallel, capped at 4 concurrent**, each bounded by the
  existing `QUERY_SERVER_TIMEOUT_MS`; a per-probe timeout or connector error
  classifies as INFRASTRUCTURE for that metric (`verified: false`) and the
  remaining probes continue — one slow metric never aborts the rest, and the
  save response aggregates all per-metric outcomes.

**Can we validate metrics against exposed fields of primary + referenced
models?** Yes — tier 1 does exactly that, and tier 3 proves it end-to-end
against the real engine. Verified feasible with existing infra.

### 2.6 Ambiguity resolution (summary of the rules)

- **Definition-time (metric SQL):** qualified refs mandatory (`primary.x`,
  `alias.x`); unqualified → error with candidates.
- **Model-time (names):** dimensions and metrics share ONE namespace per
  model, unique on slug; reference aliases unique per model; model names
  unique per context tree AND sharing one namespace with view names (§2.3 —
  rejected in both save directions). Referenced fields are exposed *as
  dimensions with explicit names* — so `customers.name` becomes dimension
  `customer_name` (or whatever the author picks), never a bare collision-prone
  `name`.
- **Query/UI-time:** the semantic model is the namespace. The tool takes the
  model name; metrics/dimensions resolve within it. No global uniqueness
  needed across models.

### 2.7 SemanticExplorer handover (the live derived-model surface)

`SemanticExplorer` live-queries *derived* models today, which contradicts the
v2 contract ("semantic queries only against authored models"). Decision —
**convert, then switch, then strip**, so the surface works at every milestone
boundary:

- **M2 (convert):** `derive.ts` emits **V2-shaped** models (mechanical map:
  `TableRelationship` → `SemanticReferenceToOne`, `SemanticDimension.join` →
  `source`), so `compileSemanticQuery` stays V2-only with no dual-shape
  support. The full old-shape consumer set converts in the same milestone:
  `SemanticExplorer`, the two hooks, `models-client.ts`, `models.server.ts`,
  the API route, AND the detection path (`detect.ts`/`detect-sql.ts` —
  join-matching moves from `model.joins` to `references`), plus their tests
  (three UI tests + `compile`/`detect`/`derive`/`models-server`/`infer-viz`
  node tests) — the existing tests act as the characterization suite.
- **M5 (switch):** `/api/semantic-models` and `SemanticExplorer` serve/consume
  **authored** models (`fullSemanticModels`) only — and the detection path
  detects against authored models only (no authored models → the question
  editor's Semantic mode tab simply doesn't light up); derived models stop feeding
  live querying and become draft suggestions in the model editor. With no
  authored models yet, the explorer shows an empty state pointing at "create a
  semantic model" — acceptable: no existing workspace has models or
  relationships (§2.2), so nobody loses working queries.
- **M6 (strip):** `derive.ts` drops its relationship input entirely
  (profiled-schema-only suggestion engine, per §2.2).

`QuestionContent.semanticQuery` (gated) follows the same line: from M5 the
spec's `model` resolves against authored models only. No stored content
back-compat needed — the field is gated and no workspace has semantic content.

**QA-safe (verified):** no `test/qa/*.spec.ts` references the question
editor's Semantic mode tab,
detection, or semantic models — the M5 switch to authored-only cannot break
the QA flows gate. Between M5a and M6 the context docs briefly carry both the
old relationship hints channel and the new references projection — deliberate
and vacuously harmless (the old channel emits nothing anywhere, §2.2), and M6
removes it.

## 3. Feedback loop for the agent

- `EditFile`/model-editing tool calls run tiers 1–3 and return the issue list
  as structured tool errors (existing `SemanticCompileError.issues` shape) —
  the agent self-corrects in-loop, same pattern as the story rubric/ReviewFile
  flow. The agent learns the `SemanticModelV2` format from
  `skill_semantic_models` in `prompts.yaml` (M5a) — the standard per-type
  skill pattern.
- `RunSemanticQuery` re-validates the spec against the stored model on every
  call (`validateSemanticQuery` already returns per-issue messages).

## 4. Derisk findings — verified; no open unknowns

(⚠️ below means "large but fully mapped work", not an unknown.)

Verified by **executed experiments** (scratch Vitest run against the real
`irToSqlLocal`, `parseSqlToIrLocal`, and in-memory DuckDB with m2m fixture
data; 8/8 green, 2026-07-21) plus code reading:

| Concern | Verdict | Evidence |
|---|---|---|
| Compile semantic query w/ declared joins → dialect SQL | ✅ already built | `lib/semantic/compile.ts` + `irToSqlLocal` (DuckDB/BQ/PG) |
| Views tier as "data models" incl. save-time column probe | ✅ already built | `lib/views/prepare.server.ts` `LIMIT 0` probe, integrity checks |
| Cheap per-connector SQL validation | ✅ works today | `LIMIT 0` via `runQuery` (prepareView precedent) |
| Metric-SQL ref extraction | ✅ decided: lexer | **Executed:** parser returns opaque `raw` even for `SUM(a)-SUM(b)` — lexer is the sole mechanism (§2.5) |
| Metric-SQL compilation via `raw` select columns | ✅ executed | CASE-expression metric round-tripped IR→SQL and returned correct result on DuckDB |
| many_to_many compilation | ✅ **no IR change needed** | **Executed:** existing `ctes[{name, raw_sql}]` + `JoinClause` render in all 3 dialects AND return correct per-group numbers on DuckDB where the naive join double-counts (§5) |
| Filter-only m2m semi-join | ✅ executed | `raw_column` + `IN` + `raw_value` FilterCondition emits `pk IN (SELECT …)`; correct result on DuckDB (derisk-era form — shipped as a correlated `EXISTS`, §5) |
| `irToSqlLocal` is our own pure-TS generator | ✅ read | `lib/sql/ir-to-sql.ts` — not the polyglot WASM `generate()`; fully extendable if ever needed |
| Storage/versioning/inheritance for authored models | ✅ pattern exists | `ContextVersion.views`/`metrics`; add `semanticModels` |
| Removing table-level relationships | ⚠️ wide but mapped | 21 files: 16 source + 5 test (verified by grep — full list in §2.2), incl. `app/api/relationships/verify`, schema-browser/whitelist UI, context loaders, and `context-agent-view.ts` (free-SQL join hints — replaced by projecting semantic-model references into context docs, §2.2) |

The scratch experiment file was deleted after validation; its scenarios get
re-authored as the real red-first tests of M2 (raw-metric IR→SQL
round-trip) and M3 (per-tag revenue correctness, naive-join wrongness
assertion, semi-join filters, NULL-group behavior).

**Accepted by reasoning, not execution** (stated so "no open unknowns" stays
honest — both have named safety nets, neither warrants pre-work):

- The M2 conversion mapping (`TableRelationship` → `SemanticReferenceToOne`,
  `join` → `source`) and `detect.ts` join-matching move are read-verified
  only. Safety net: the characterization baseline verified blue on `main`
  (261 node + 8 UI tests) — a semantics slip turns red in M2 itself.
- The zero-dimension probe's plain-column GROUP BY was executed on DuckDB +
  real Postgres (PGLite) but not BigQuery (no credentials exist locally —
  verified). Accepted on standard-SQL grounds plus the `prepareView`
  precedent, which already runs identical `LIMIT 0` probes against real BQ
  connections in production.
- BigQuery m2m execution overall is golden-SQL-only (DuckDB is the
  execution engine for M3's fixtures). **Post-merge check (named so the
  residual doesn't become "assumed forever"): run one m2m semantic query —
  a dimension grouping AND a semi-join filter — against a real BQ
  connection in a deployed environment.** This is the ONLY remaining
  deferral, and it is environmental: no BigQuery credentials exist in this
  workspace (verified — no env vars, no gcloud ADC, no BQ connection), so it
  cannot be executed here at any effort level. Risk is low: the emitted SQL
  uses only `WITH` + `LEFT/INNER JOIN` + `SELECT DISTINCT` + correlated
  `EXISTS`, all standard on BQ, and `prepareView` already runs equivalent
  `LIMIT 0` probes against real BQ connections in production.

## 5. many_to_many — in scope, same PR

**Declaration** — the m2m variant of the `SemanticReference` union (§2.3):
instead of a direct `on`, it always joins through an explicit bridge
(junction) source. No `joinType` field — the join semantics are fixed by the
compilation below (LEFT to the dedup-bridge CTE):

```ts
interface SemanticReferenceM2M {
  source: SemanticSource;          // the far table/model, e.g. tags
  alias: string;
  relationship: 'many_to_many';
  through: {
    source: SemanticSource;        // bridge, e.g. order_tags
    primaryOn: { primaryColumn: string; bridgeColumn: string }[];
    referencedOn: { bridgeColumn: string; referencedColumn: string }[];
  };
  // NOTE: the preserved grain comes from the MODEL-level `primaryKey`
  // (§2.3) — declared once, REQUIRED when any m2m reference exists.
}
```

**Composite keys are supported** (the `EXISTS` lift landed rather than being
deferred). The semi-join compiles to a CORRELATED `EXISTS (SELECT 1 … WHERE
bridge.k = primary.k AND …)`, one correlation term per key column, so a
composite grain works on every dialect — the earlier restriction existed only
because an uncorrelated `pk IN (SELECT …)` cannot carry multiple columns on
BigQuery. The dedup-bridge CTE projects one `_pkN` per key column and joins on
all of them, so a composite grain can never match on a prefix. The validator
still requires `through.primaryOn` to name exactly the model's `primaryKey`
columns, in order.

**Correctness strategy — grain-preserving compilation, not naive joins.** A
naive `primary JOIN bridge JOIN far` duplicates primary rows and inflates every
`SUM`/`COUNT` (verified: 250 vs the correct 150 on the fixture below).
Symmetric aggregates (Looker-style distinct-hash tricks) and forced-DISTINCT
aggregations were considered and rejected — dialect-fragile / semantics-changing.
**Chosen and verified:** compile through the IR's **existing CTE support**
(`ctes: [{name, raw_sql}]` — no IR change; `irToSqlLocal` is our own pure-TS
generator, `lib/sql/ir-to-sql.ts`):

- **m2m filters** (the common case, "orders tagged vip") → semi-join: a
  CORRELATED `EXISTS (SELECT 1 FROM bridge JOIN far ON … WHERE bridge.k =
  primary.k AND …)` — one correlation term per key column — emitted via the
  existing `FilterCondition` raw-SQL passthrough. (The original
  `pk IN (SELECT …)` form was lifted to `EXISTS` for composite keys and
  NULL-safe negation — see the composite-keys paragraph above.) Never fans
  out. **Executed on DuckDB: correct.**
- **m2m dimensions** (GROUP BY a many-side field — fan-out across groups is
  semantically intended: a 2-tag order appears in both tag groups, but each
  metric counts it once per group) → compile a deduplicated bridge CTE
  `_m2m_<alias> AS (SELECT DISTINCT <one _pk<k> per primaryKey column>, <GROUPED dim cols only> …)`,
  join the primary to it on ALL the `_pk<k>` columns (the model's
  `primaryKey` — a composite grain never matches on a prefix), aggregate
  metrics in the outer query grouped by the m2m dim. One row per (pk, dim value) by
  construction — no within-group double counting, all aggregate types
  (`SUM`/`AVG`/`COUNT_DISTINCT`/…) work unchanged. **Executed on DuckDB with
  the CTE+join form: per-tag revenue exactly right (promo=100, vip=150) where
  the naive join inflates.** Renders correctly in all three dialects.
  **NULL-group semantics (decided):** the join to the bridge CTE is `LEFT` —
  consistent with the lookup-join default — so unmatched primary rows (e.g.
  untagged orders) appear once under a `NULL` dimension group rather than
  silently vanishing from the result; covered by a dedicated fixture test.
  **Negation is supported**: a negated filter compiles to `NOT EXISTS` over the
  same correlated subquery, which is NULL-safe (unlike `NOT IN`). `!=` means
  "has no related row matching the positive condition" — so the negation rides
  on `EXISTS`, and the far-table predicate inside stays positive. `IS NULL` /
  `IS NOT NULL` on an m2m dimension mean has-no-related-row / has-one and carry
  no far-table predicate at all.
  **Filters on a GROUPED alias live INSIDE its CTE** (found by review, proven
  on DuckDB): as an outer condition, the filter's column is dragged into the
  DISTINCT projection and widens the grain from `(pk, groupedCol)` to
  `(pk, groupedCol, filterCol)` — two far rows sharing the grouped value then
  double-count one primary row *inside* its group (revenue 200 for a 100 order).
  Filtering inside the CTE keeps the projection, and therefore the grain,
  independent of what is filtered. A filtered alias joins **INNER** (the filter
  restricts the primary set, matching filter-only semi-join semantics); an
  unfiltered one joins LEFT and keeps the NULL group.

**Constraint (validated rule, enforced at query time):** a semantic query may
GROUP BY dimensions from at most **one** m2m reference (filters from any
number are fine — semi-joins compose). Two m2m dimension sources in one query
cross-multiply bridges and re-inflate metrics within groups; the validator
rejects it with a pointing error ("split into two queries or model a combined
bridge view"). `many_to_one`/`one_to_one` dimensions combine freely with the
one m2m dimension source.

Note on GUI SQL: `validateSqlForGui` keeps rejecting subqueries for
*user-authored* GUI SQL; the m2m compiler *generates* IR directly and never
passes through that parse gate (generation ≠ parsing — separate code paths,
verified).

## 6. Execution plan — ONE PR, six milestones

> **Status (2026-07-22):** all six milestones landed on `feature/semantic-models-v2`
> (PR #638, CI green incl. QA Flows) — M1 `4afd7fc6`, M2 `e45a79d4`, M3 `6b50dbce`,
> M4 `7c6a8b13`, M5 `a13d5a6b`, M6 `9e902ffc`, plus follow-ups `4a12ce96` / `ed21cfac`,
> the composite-m2m CTE fix `fa0f4458`, and the **V2.1 simplification `8e77e10b`**
> (§2.0). Every box is ticked against committed HEAD. Checklist items whose original
> wording described pre-V2.1 behavior keep their tick (the work happened) but carry a
> "(superseded in V2.1: …)" note stating the current behavior — read those notes, not
> the original wording, as the truth (§4 has the derisk findings; the PR body is empty
> by repo rule, so it is NOT the place to look).

### Global rules (read before every milestone)

- Branch: `semantic-model-v2` off `main`. One PR at the end of M1
  (draft is fine), **empty body** (`gh pr create --body ""` — repo rule).
  Every milestone = one commit (or small group) pushed to that branch.
- Work from `frontend/`. Validate with `npm run validate` — NEVER
  `npm run build`.
- **TDD, strictly:** write the contract (types/signatures) → write tests →
  RUN them and see them FAIL → implement → see them pass. A test that was
  never red doesn't count. Refactors are Blue→Red→Blue.
- Tests: semantic/compiler/validator tests are `node`-project Vitest under
  `lib/semantic/__tests__/`; run with
  `npx vitest run --project=node lib/semantic`. UI tests are `*.ui.test.tsx`
  (jsdom), locate elements by `getByLabelText` ONLY (add `aria-label` to
  components that lack one).
- Invariant (the real rule, not a file lock): **old `TableRelationship`
  read/write behavior keeps working until M6.** Milestones may edit files on
  the §2.2 removal list where their checklists say so — but must not delete
  or break relationship behavior early.
- **Every milestone's Done-when includes the FULL suite (`npm test`)** — not
  just `lib/semantic`. M2's blast radius (compiler + explorer/detection
  conversion) reaches store e2e and question-flow tests that a scoped run
  would miss. `npm run test:qa` (prod build, slower) additionally gates M2
  (live question UI touched), M5, and M6.
- If a milestone's Done-when fails, fix before moving on — the branch is
  always green at milestone boundaries.

### M1 — Schemas, storage, tier-1 validator

Goal: `SemanticModelV2` exists as a stored, validated artifact. No compiler
changes yet.

- [x] Contracts — **TypeBox is the single source of truth** (repo rule):
      define the §2.3/§5 shapes (`SemanticModelV2`, `SemanticSource`,
      `SemanticReference` union, `SemanticReferenceM2M`,
      `SemanticMetric = ratio | sql` — superseded in V2.1:
      `SemanticMetricV2 = aggregation | ratio | sql`, with `measures` and
      `timeDimension` folded away per §2.0) as TypeBox schemas in
      `lib/validation/atlas-schemas.ts` (following the `CtxMetricDef`
      precedent), with `Static<typeof …>` types; `lib/types/semantic.ts`
      RE-EXPORTS those Static types — no hand-written duplicate interfaces
      (the TS blocks in §2.3/§5 are illustrative shape, not a second
      source). The tier-1 validator uses the schema as its shape gate for
      agent-authored JSON. Keep the OLD
      `SemanticModel`/`SemanticJoin`/`TableRelationship` types exported and
      untouched (M6 deletes them); fix the stale doc-comment on the old type.
- [x] Add `semanticModels?: SemanticModelV2[]` to `ContextVersion`
      (`lib/types/context.ts` — plain TS interface; `ContextVersion` itself
      has no TypeBox schema and gets none). Do NOT set
      `additionalProperties: false` anywhere at the `ContextVersion` level.
- [x] Inheritance: wire `fullSemanticModels` through the context loaders
      (`lib/data/loaders/context-loader*.ts`) and `context-agent-view.ts`,
      copying the `fullViews` inheritance flow. (Agent WRITE access —
      `semanticModels` into `EDITABLE_VERSION_FIELDS` — deliberately waits
      for M5a, when the skill and tier-2/3 gates exist; until then agents
      couldn't author models safely anyway.)
- [x] Red tests, then implement `lib/semantic/validate.ts` — tier-1
      `validateSemanticModel(model, ctx): string[]` covering, each with its
      own test: name-slug uniqueness across dims+metrics (superseded in
      V2.1: was dims+measures+metrics) (`semanticAlias`, case-insensitive);
      reference aliases unique; reserved
      aliases rejected (`primary`, `_m2m_*`, `_grain`, `_views`, `_probe`);
      connection consistency (§2.3); model name not colliding with any view
      name, both directions (§2.3); dimension `source`/`column` resolve to
      exposed fields; temporal-flagged dimensions have a date/time column
      type when the type is known (superseded in V2.1: was a
      `timeDimension.column` check — the field no longer exists, §2.0);
      `primaryKey` required when any m2m ref exists (allowed
      always); m2m `through.primaryOn` names exactly the model's
      `primaryKey` columns, in order (superseded: the original
      "single-column keys only" restriction was lifted — composite keys
      fully supported, §5); metric-SQL qualified-ref
      lexer (comment/string-aware; unqualified ref → error listing candidates;
      quoted identifier → rejection with §2.5's message; m2m alias ref →
      rejection); ratio metrics' `numerator`/`denominator` resolve to
      declared aggregation metrics of the same model (superseded in V2.1:
      was "declared measures"). No aggregate-token check — aggregate-ness is
      tier 3's job via the always-GROUP-BY probe (§2.5). The `ctx` argument
      of `validateSemanticModel(model, ctx)` = the context's `fullSchema` +
      `fullViews` (exposed fields + column types); when a table is
      unprofiled and a column's type is unknown, the temporal-type check is
      SKIPPED. The safety net for a bad time axis is
      then QUERY time, not the save gate: the tier-3 probe (metric + first
      dimension) never exercises the time axis, so a non-temporal axis
      surfaces when a semantic query first requests a `timeGrain` and the
      compiled `DATE_TRUNC` fails in the engine. Do NOT add a time-axis
      probe to the save gate to change this — accepted behavior.
- [x] Reverse namespace check: the VIEW save path also rejects a view name
      that collides with a semantic model name (§2.3 — both directions).
      This lands in the views name-uniqueness seam
      (`lib/views/prepare.server.ts` / `save-gate.server.ts`) — those files
      are NOT on the §2.2 removal list; touching them here is safe and
      intended.
- [x] Wire tier-1 into the context save path (same seam `prepareView` /
      view save-gating uses) so an invalid model blocks the version save.
- [x] No migration work of any kind (per §2.2 — nothing stored, nothing to
      convert).

Done-when: new tests red-first then green · `npm run validate` clean ·
`npm test` green · commit + push.

### M2 — Compiler re-point + tier-2

Goal: `compileSemanticQuery` compiles V2 models (to-one refs only; m2m
compiles in M3 — until then the compiler throws a clear "m2m not yet
compiled" error).

- [x] Red tests first: golden-SQL tests per dialect (duckdb/bigquery/postgres)
      for: primary=table, primary=view (`FROM _views.<name>`), to-one
      reference joins from `references[].on`, dimensions with
      `source: <alias>`, base-qualification when joins are in play (existing
      behavior, keep), ratio metrics (existing), and SQL metrics.
      *(`lib/semantic/__tests__/compile-v2.test.ts` — one golden per shape, with
      the cross-dialect assertions concentrated where the dialects actually
      diverge (DATE_TRUNC; plus M3's m2m goldens across all three); the
      remaining shapes are dialect-invariant.)*
- [x] Re-point `lib/semantic/compile.ts` from the old `joins`/`SemanticJoin`
      shape to `references` (accept `SemanticModelV2`).
- [x] SQL metrics: alias-rewrite `primary.` / `<refAlias>.` → real
      table/view/alias qualifiers, emit as `{ type: 'raw', raw_sql }` select
      column (§2.5 tier-2, verified pattern).
- [x] **Metric-only join inclusion** (easy to miss, silently emits invalid
      SQL if skipped): a SQL metric referencing a to-one alias that appears
      in NO selected dimension (e.g. `SUM(costs.total)` with only primary
      dimensions) must still pull that reference's JoinClause into the
      compiled query — join usage is computed from dimensions/filters PLUS
      the tier-1 lexer's extracted metric refs. Dedicated golden test.
- [x] Extend `validateSemanticQuery` for V2 (unknown metric/dimension/join
      errors keep their existing human-readable format;
      `SemanticCompileError.issues` shape unchanged; in V2.1 the spec field
      the tool and UI fill is `SemanticQuerySpec.metrics` — renamed from
      `measures`, §2.0).
- [x] Wire the tier-2 compile check into the SAME save gate tier 1 uses
      (M1's seam): every metric compile-probes on save from this milestone
      on; failures block the save (§2.5 — tier 2 is save-blocking, not just
      an EditFile-time courtesy).
- [x] **SemanticExplorer + detection conversion (§2.7):** `derive.ts` emits
      V2-shaped models (`TableRelationship` → `SemanticReferenceToOne`,
      `join` → `source`); update `SemanticExplorer.tsx`,
      `use-semantic-models.ts`, `use-semantic-compat.ts`,
      `models-client.ts`, `models.server.ts`,
      `app/api/semantic-models/route.ts`, AND the detection path —
      `detect.ts` / `detect-sql.ts` (join-matching moves from `model.joins`
      to `references`; the recompile-and-compare check keeps its exact
      semantics). Characterization suites, run before AND after
      (Blue→Red→Blue): FIVE UI test files (`semantic-autorun`,
      `viz-type-lock`, `create-question-modal`,
      `query-builder/__tests__/SemanticExplorer`,
      `query-builder/__tests__/QueryModeSelector`) and the node tests
      `lib/semantic/__tests__/{compile,detect,derive,models-server,infer-viz}.test.ts`.
      Baseline ALREADY verified blue on `main` (2026-07-21): all 7
      `lib/semantic` node files (261 tests) and all five UI files (35 tests)
      pass — any red after conversion is a real regression, not a
      pre-existing failure.
      *(`use-semantic-compat.ts` needed no edit — it traffics in
      `SemanticQuerySpec`s, not model shapes, so the conversion passed under it.)*

Done-when: same as M1 (`npm run validate` + full `npm test`, characterization
suites having stayed green) · `npm run test:qa` green (question UI surface
touched) · commit + push.

### M3 — m2m compilation

Goal: §5 exactly — semi-join filters + dedup-bridge-CTE dimensions.

- [x] Red tests first, in-memory DuckDB fixtures (`@duckdb/node-api`,
      orders/tags/order_tags with one double-tagged order — §4's scenarios):
      (a) per-group totals correct (promo=100, vip=150 shape); (b) an
      explicit test that the NAIVE join gives the wrong total (documents why
      the CTE exists); (c) filter-only semi-join total correct; (d) LEFT
      NULL-group row present for untagged primary rows; (e) golden SQL for
      all three dialects.
- [x] Implement in `compile.ts`: m2m filter → semi-join FilterCondition
      (superseded: initially `raw_column`/`raw_value` `pk IN (SELECT …)`,
      later lifted to a correlated `EXISTS` raw-SQL condition for composite
      keys + NULL-safe negation, §5); m2m dimension → `_m2m_<alias>`
      dedup CTE (`ctes: [{ name, raw_sql }]`) + LEFT join on `primaryKey`
      (since `fa0f4458` the CTE projects one `_pk<k>` per primaryKey column
      and the join maps them ALL — composite grains never match on a
      prefix, §5).
- [x] Query-time validator rules (in `validateSemanticQuery`): ≤1 m2m
      dimension source per query, with §5's pointing error, tested.
      (Superseded: the initial "m2m filter negation rejected" rule was
      lifted — negation now compiles to a NULL-safe correlated `NOT EXISTS`,
      and `IS NULL`/`IS NOT NULL` mean has-no-related-row / has-one, per §5.)

Done-when: same as M1 (incl. the DuckDB execution tests) · commit + push.

### M4 — Tier-3 dry-run save gate

Goal: §2.5 blocking policy live end-to-end.

- [x] Red tests first (node project, real route/save path + test DB per
      `store/__tests__/test-utils.ts` patterns): bad-SQL metric blocks save
      with structured issues; infra failure saves with `verified: false`;
      metric-text-only edit probes only changed metrics; a PURE metric
      deletion probes nothing (the easy-to-get-wrong case — a naive
      "diff the metrics array" probes on deletion); ANY structural edit
      (incl. a dimension edit) probes all — superseded in V2.1: with
      measures folded into `metrics`, editing an aggregation metric is a
      metric-text-only change that re-probes it plus its dependent ratio
      metrics via essence-embedding, NOT all metrics (§2.5 case 1);
      a `verified: false`
      metric is included in every subsequent save's probe set until it
      verifies (§2.5 — saves are the ONLY probe trigger); a dimension rename
      probes all while a metric rename probes only itself under its new
      name (§2.5 rename rules — superseded in V2.1: the original "measure
      rename probes all" case no longer exists; an aggregation-metric
      rename probes it under the new name only, a ratio naming the old name
      failing tier 1 first); parallel probing (cap 4) with one timing-out metric marked
      `verified: false` while the rest complete (§2.5 execution policy).
      *(All in `lib/semantic/__tests__/tier3.test.ts`. The last two — rename
      scope and probe concurrency/isolation — were missed by the M4 commit and
      written afterwards as regression locks on the shipped behavior; they were
      green on first run, which is expected for a lock rather than a red-first
      test.)*
- [x] Implement: probe = compiled `SemanticQuerySpec` per §2.5's probe shape
      (metric + first dimension; zero dimensions → group by first exposed
      primary column; constant `GROUP BY 1` ONLY as the no-known-columns
      last resort) wrapped
      `SELECT * FROM (…) AS _probe LIMIT 0`, executed via
      `runQuery` (copy `lib/views/prepare.server.ts`); classify
      validation-vs-infrastructure errors; stamp `verified` per §2.5.
- [x] Metadata-only edits (`description` fields only; V2.1 removed the
      `timeDimension.label` case with the field itself) probe nothing
      (§2.5 carve-out) — tested.
- [x] Zero-dimension probe per §2.5's decided shape: first exposed primary
      column (constant grouping only as the no-known-columns last resort —
      no BigQuery verification needed; that edge is unreachable on BQ).
- [x] Surface tier-1+2+3 issues as structured errors through the context
      save API response AND the agent EditFile tool-result path (§3).
      *(Save API: `SemanticModelSaveError.issues` → newline-joined
      `UserFacingError`, recovered client-side as a list. EditFile: returns
      `semanticIssues` as a structured list in the tool result — deliberately
      tiers 1–2 only, since tier 3 needs a live connector + server credentials;
      tier-3 issues reach the agent via the save/publish gate, which stays the
      authority. Documented inline in `lib/tools/handlers/edit-file.ts`.)*

Done-when: same as M1 (`npm run validate` + full `npm test`) · commit + push.

### M5 — Surfaces (two commit groups: M5a pipes, M5b editor UI)

Goal: users see only metrics+dimensions; agent gets `RunSemanticQuery` AND
can author models; free SQL gets model docs. MUST land before M6 (§2.2
ordering). Split so the well-specified pipes aren't hostage to UI iteration.

**M5a — agent tool, docs projection, explorer switch, authoring skill:**

- [x] `RunSemanticQuery` server tool under `agents/**` (MXTool + TypeBox
      params = `SemanticQuerySpec` + model name), registered in BOTH
      `REGISTRABLES` and `HEADLESS_REGISTRABLES`
      (`lib/chat/orchestration-core.server.ts` — it's a server tool, so
      Slack/headless runs get it too); re-validates spec per §3. **Result
      presentation (decided): returns rows exactly like `ExecuteQuery`
      (same result shape) and reuses its chat display path — a
      `tool-config.ts` entry mirroring ExecuteQuery's compact/DetailCard
      routing, no new display components.** Test via faux-LLM e2e pattern
      (`fauxAssistantMessage`/`fauxToolCall`, see `slack.e2e.test.ts` /
      `stream-turns.test.ts` reference patterns).
- [x] **Agent authoring:** add `semanticModels` to
      `EDITABLE_VERSION_FIELDS` in `context-agent-view.ts` (unlike `views`,
      which is deliberately absent there — §3 requires agent edits;
      deferred from M1 so it lands together with the skill and gates), and
      add `skill_semantic_models` to `orchestrator/prompts/prompts.yaml`
      (the per-type skill pattern — `skill_questions`, `skill_dashboards`,
      …) documenting the `SemanticModelV2` format: primary/references
      (incl. m2m `through`), dimensions & metrics, qualified-ref
      metric SQL rules, and the tier-1/2/3 error feedback loop. Without the
      skill, agents would guess JSON against a TypeBox gate. (Rewritten in
      V2.1 to match §2.0: dimensions-&-metrics section, temporal-first
      implicit time axis, composite m2m supported.)
- [x] **SemanticExplorer switch (§2.7):** `/api/semantic-models` and
      `SemanticExplorer` serve/consume authored models
      (`fullSemanticModels`) only; empty state points at model creation;
      derived models demoted to draft suggestions.
      `QuestionContent.semanticQuery` specs resolve against authored models
      only from here on.
      *(Done in `a903d905`: an authored-model picker replaced the raw-table
      browser, models load unscoped so a fresh question can pick one, and
      `showSemanticTab` gates on authored models.)*
- [x] Docs projection into `context-agent-view.ts`: per model — name,
      references (alias, cardinality, join columns), dimensions, and metric
      definitions ("metric `revenue` on `Orders` = `SUM(…)`"). Unit-test the
      projected text. *(Lives in `lib/sql/context-docs.ts` — the schema-notes
      projection the agent actually reads — not literally in
      `context-agent-view.ts`; unit-tested in `lib/sql/__tests__/schema-notes.test.ts`.)*

**M5b — editor UI (minimal contract; reshaped by V2.1 — §2.0 items 5–6):**

- [x] Semantic-model editor, **form-based** (not raw JSON), shipped in
      `components/context/SemanticModelsEditor.tsx`. (Superseded in V2.1:
      originally specced as a new tab/section beside views with a connection
      fixed by picking the primary — there is now NO "Semantic" tab; models
      render PER-CONNECTION inside the **Databases tab**, in a section ABOVE
      Data Models (views) in each database's collapsible, so the model's
      connection is implied by its section and there is no connection
      picker.) ONE card layout serves read and edit modes: read mode shows
      full definitions as text (`Revenue = SUM(total)`,
      `AOV = Revenue ÷ Order Count`, dimension `Customer Name ←
      customer.name`, joins as real equalities
      `orders.customer_id = customers.id`); edit mode swaps the same cells
      for inputs. Sections per card: References / Time Dimensions /
      Dimensions / Metrics, each heading with a compact `+`. Source pickers
      (primary/reference/bridge) list the section's connection's tables +
      views; m2m authoring INCLUDED (the editor speaks "via <table>" plus a
      join line of real column equalities — the old
      "bridge/primary/referenced" pickers appear only when inference fails
      or the author expands them). Join columns are PROPOSED on
      source/via pick by the pure module `lib/semantic/infer-join.ts`
      (`inferToOneOn`, `inferM2MThrough`, `inferPrimaryKey`, `singularize`);
      a reference's alias auto-fills as the singularized table name. Metric
      SQL edits in a plain code input; tier-1/2/3 errors render inline per
      §2.5 (recovered from the save error and attributed to the model /
      metric row each names); a new model PREPENDS at the top, and picking a
      primary on an empty model auto-prefills draft vocabulary via
      `deriveSemanticModels` (temporal dims first, Count/Total/Avg
      aggregation metrics, inferred grain, name from the table). Explicitly
      NEED-NOT: drag-drop, live previews, diagram views.
- [x] Browse surface: each model's dimensions + metrics only (no
      tables/SQL), grouped under the model's connection. (Superseded in
      V2.1: no separate catalog mode — the read-mode cards in the Databases
      tab ARE the browse surface.)
- [x] UI tests as `*.ui.test.tsx` (jsdom, `getByLabelText` only — add
      `aria-label` to every interactive element).
- [x] Browser-verify on the dev server: author a model over tutorial data
      (incl. one m2m reference), break a metric and see the tier errors,
      run a semantic query via chat and read the debug message (exact LLM
      request/response) to confirm the tool schema + docs projection +
      skill look right. *(Walked on the dev server, tutorial mode, 2026-07-22: authored the
      Orders model over mxfood incl. an m2m reference (products THROUGH
      order_items, primaryKey order_id) — saved clean through all three
      tiers; broke a metric to `SUM(primary.not_a_real_column)` and the
      tier-1 error rendered INLINE under that metric row as well as in the
      banner; ran `RunSemanticQuery` in chat for Revenue by Product (the m2m
      dimension → dedup-bridge CTE) and got real per-product revenue; and
      confirmed the agent can now AUTHOR a model — it added a metric via
      EditFile, which was impossible until `semanticModels` reached
      `ContextAgentContent`.)*

Done-when: `npm run validate` + full `npm test` green · `npm run test:qa`
green · browser verification done (say so honestly) · commit + push (one
commit per group).

### M6 — Removal sweep + final green

Goal: `TableRelationship` and every reader/writer gone; suite + QA green.

- [x] Re-run the surface greps first and treat the UNION of results as the
      checklist. Two passes, because the type-name grep alone misses plain
      field readers (`version.relationships`, UI prop names):
      `grep -rln 'TableRelationship\|fullRelationships' --include='*.ts' --include='*.tsx' lib app components agents store orchestrator`
      then a review pass over
      `grep -rn '\brelationships\b' --include='*.ts' --include='*.tsx' lib app components agents store orchestrator`
      (manually skip true-negative hits, e.g. unrelated English in comments).
- [x] Delete: `TableRelationship` type + `ContextVersion.relationships` +
      `fullRelationships` (types, both context loaders, agent-view field
      lists — including the one-token removal of `'relationships'` from
      `EDITABLE_VERSION_FIELDS`, easy to miss), **the old
      `SemanticModel`/`SemanticJoin` shapes** (dead code after M2's V2
      conversion — kept exported until now per M1),
      `app/api/relationships/verify/route.ts` (whole route),
      `TableRelationshipsEditor.tsx` + its usage in `DatabasesTabContent.tsx`
      / `ContextEditorV2.tsx` / `ContextContainerV2.tsx`, relationship
      rendering in `SchemaTreeView.tsx` / `SchemaTreeSchemaRow.tsx`, and
      relationship-based derivation in
      `lib/semantic/{derive,models.server,verify.server}.ts` (derivation
      becomes draft-suggestion from profiled schema — NO reader of stored
      `relationships`, per §2.2/§2.7 strip step; `models-client.ts` and the
      hooks stay, serving authored models per M5).
- [x] Blue→Red→Blue where old tests cover removed behavior: delete/replace
      those tests deliberately, never weaken assertions to keep them passing.
      Includes deleting `table-relationships-editor.ui.test.tsx` with its
      component, and settling whatever remains of the §2.2 test-file five
      (`lib/semantic/__tests__/*`) that M2–M5 haven't already rewritten.
- [x] Final check: grep for
      `TableRelationship|fullRelationships|SemanticJoin` returns ZERO hits
      outside this doc; the old `SemanticModel` interface is gone from
      `lib/types/semantic.ts` (the name may live on only if V2 adopts it as
      its export name — either way, one shape exists); and the
      `\brelationships\b` review pass shows no remaining live reader of the
      stored field.
- [x] `npm run validate` · `npm test` · `npm run test:qa` all green.
- [x] Mark the PR ready for review (body stays empty).

Done-when: all of the above checked · push.
