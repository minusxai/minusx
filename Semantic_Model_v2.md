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

## 1. What already exists (verified in-repo)

Much of the machinery is built. V2 is a **restructure + extension**, not greenfield.

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
  existing SQL match a semantic spec, enabling the Semantic tab), which
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
  path would be dead code. The draft-suggestion engine proposes `references`
  from profiled schema (FK-shaped columns), not from stored relationships.
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
  dimensions: SemanticDimension[]; // { name, source: 'primary' | <ref alias>, column, … }
                                   // (restructures the existing `join?` field into `source`)
  measures: SemanticMeasure[];
  metrics?: SemanticMetric[];
  /** Default time axis. PRIMARY-only: `column` must be a temporal exposed
   *  field of the primary source (mirrors the existing resolveTimeColumn
   *  behavior; joined-table time axes are not supported). Tier-1 validated. */
  timeDimension?: { column: string; label?: string };
}

type SemanticMetric = SemanticRatioMetric   // existing numerator/denominator
                    | SemanticSqlMetric;    // new free-form SQL (§2.5)

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
- `many_to_one` / `one_to_one` are lookup joins — measures aggregate the
  primary, so they can never fan out. `many_to_many` is compiled
  grain-preservingly (§5), never as a naive fan-out join. Pre-aggregating the
  many side into a data model remains a valid alternative authoring pattern.
- `dimensions[].source` must be `'primary'` or a declared reference alias, and
  `column` must be an **exposed field** of that source (whitelist for tables,
  probed output columns for views).
- **Measures stay primary-column-only** (the existing `{name, agg, column}`
  shape, no `source` field) — that's what makes "measures aggregate the
  primary, so they can never fan out" true by construction. Aggregating a
  to-one reference column is what SQL metrics are for (`SUM(costs.total)`).
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
  it's fixed by choosing the primary, and the primary/reference pickers only
  offer sources from that connection — so the validator is a server-side
  backstop for hand-/agent-authored model JSON, not a path UI users hit.

Compiler change is mechanical: `compileSemanticQuery` already emits
`JoinClause`s from `joins`; it re-points at `references` and gains
`FROM _views.<name>` when the primary/reference is a model (views are already
addressable tables at query time).

### 2.4 UI/agent surface: metrics + dimensions only

- The semantic browse/query UI lists each model's **dimensions and metrics
  (incl. measures)** — never raw tables or SQL.
- The agent's semantic tool (`RunSemanticQuery(model, measures[], dimensions[],
  filters[], timeGrain, ...)` — extend the existing `SemanticQuerySpec` path)
  takes business names; the compiler resolves them. The agent cannot write an
  invalid join by construction.
- Free-SQL contexts get metric definitions injected as documentation ("metric
  `revenue` on model `Orders` = `SUM(orders.amount) - SUM(orders.refund)`") —
  unvalidated reference material, alongside the reference/join-docs projection
  of §2.2 (both land in M5). Improves raw-SQL answers as soon as models
  exist, independent of anyone adopting semantic queries.

### 2.5 SQL metrics + validation

Add free-form SQL metrics alongside existing agg measures and ratio metrics:

```ts
interface SemanticSqlMetric {
  name: string;
  type: 'sql';
  sql: string;        // aggregate expression, e.g. "SUM(primary.amount) - SUM(ref_costs.total)"
  description?: string;
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
   dimensions+measures+metrics; enforced case-insensitively on
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
  hold the whole model hostage while you fix something else;
  (2) **metadata-only** — see the carve-out below: probe nothing;
  (3) **everything else is structural** — `primary`, `primaryKey`,
  `references`, `measures`, `dimensions`, `timeDimension`, `connection` —
  and probes ALL metrics: structural edits can break textually-unchanged metrics that tier 1
  still resolves (swapping a reference's source view type-breaks
  `SUM(costs.total)`; editing a measure's column breaks a ratio metric that
  names it).
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
  the model's **first dimension** when one exists; with zero dimensions,
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
- Metadata-only carve-out: edits touching ONLY `description`/`label` fields
  (model, dimension, measure, or metric descriptions; `timeDimension.label`)
  cannot affect compiled SQL and probe NOTHING.
- Renames, precisely (they'd otherwise straddle two cases): **measure,
  dimension, and reference-alias renames are structural** — other
  definitions reference them by name (ratio metrics name measures; metric
  SQL names aliases; specs name dimensions), so a rename can break a
  textually-unchanged metric. **A METRIC rename stays case (1)** — nothing
  compiled references a metric by name — and probes the renamed metric as an
  edited entry.
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
- **Model-time (names):** dimensions/measures/metrics share ONE namespace per
  model, unique on slug; reference aliases unique per model; model names
  unique per context tree AND sharing one namespace with view names (§2.3 —
  rejected in both save directions). Referenced fields are exposed *as
  dimensions with explicit names* — so `customers.name` becomes dimension
  `customer_name` (or whatever the author picks), never a bare collision-prone
  `name`.
- **Query/UI-time:** the semantic model is the namespace. The tool takes the
  model name; measures/dimensions resolve within it. No global uniqueness
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
  detects against authored models only (no authored models → Semantic tab
  simply doesn't light up); derived models stop feeding
  live querying and become draft suggestions in the model editor. With no
  authored models yet, the explorer shows an empty state pointing at "create a
  semantic model" — acceptable: no existing workspace has models or
  relationships (§2.2), so nobody loses working queries.
- **M6 (strip):** `derive.ts` drops its relationship input entirely
  (profiled-schema-only suggestion engine, per §2.2).

`QuestionContent.semanticQuery` (gated) follows the same line: from M5 the
spec's `model` resolves against authored models only. No stored content
back-compat needed — the field is gated and no workspace has semantic content.

**QA-safe (verified):** no `test/qa/*.spec.ts` references the Semantic tab,
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
| Filter-only m2m semi-join | ✅ executed | `raw_column` + `IN` + `raw_value` FilterCondition emits `pk IN (SELECT …)`; correct result on DuckDB |
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
  connection in a deployed environment.**

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

**Single-column keys only for m2m (decided):** when any m2m reference exists,
`primaryKey`, `through.primaryOn`, and `through.referencedOn` must each be a
single column — the validator rejects composite keys with a pointing error
("composite-key m2m is not supported; add a surrogate key or a concatenated
key column in a data model"). Reason: the semi-join compiles to
`pk IN (SELECT …)`, and BigQuery has no multi-column `IN (subquery)` (the
row-value syntax DuckDB/Postgres accept doesn't port); an `EXISTS`
compilation is the eventual lift and is deferred like negation. Composite
`on` keys remain fully supported for to-one references — those compile to
real JOINs, which all dialects handle.

**Correctness strategy — grain-preserving compilation, not naive joins.** A
naive `primary JOIN bridge JOIN far` duplicates primary rows and inflates every
`SUM`/`COUNT` (verified: 250 vs the correct 150 on the fixture below).
Symmetric aggregates (Looker-style distinct-hash tricks) and forced-DISTINCT
measures were considered and rejected — dialect-fragile / semantics-changing.
**Chosen and verified:** compile through the IR's **existing CTE support**
(`ctes: [{name, raw_sql}]` — no IR change; `irToSqlLocal` is our own pure-TS
generator, `lib/sql/ir-to-sql.ts`):

- **m2m filters** (the common case, "orders tagged vip") → semi-join:
  `WHERE primary.pk IN (SELECT bridgeCol FROM bridge JOIN far WHERE …)`, via
  the existing `FilterCondition` `raw_column`/`raw_value` passthrough. Never
  fans out. **Executed on DuckDB: correct.**
- **m2m dimensions** (GROUP BY a many-side field — fan-out across groups is
  semantically intended: a 2-tag order appears in both tag groups, but each
  measure counts it once per group) → compile a deduplicated bridge CTE
  `_m2m_<alias> AS (SELECT DISTINCT <bridgeCol> AS pk, <far dim cols> …)`,
  join the primary to it on the model's `primaryKey`, aggregate measures in
  the outer query grouped by the m2m dim. One row per (pk, dim value) by
  construction — no within-group double counting, all aggregate types
  (`SUM`/`AVG`/`COUNT_DISTINCT`/…) work unchanged. **Executed on DuckDB with
  the CTE+join form: per-tag revenue exactly right (promo=100, vip=150) where
  the naive join inflates.** Renders correctly in all three dialects.
  **NULL-group semantics (decided):** the join to the bridge CTE is `LEFT` —
  consistent with the lookup-join default — so unmatched primary rows (e.g.
  untagged orders) appear once under a `NULL` dimension group rather than
  silently vanishing from the result; covered by a dedicated fixture test.
  **Negation is out of scope for m2m filters in this PR:** filters express
  positive membership only ("tagged vip"); "NOT tagged vip" (a `NOT EXISTS`
  compilation with NULL hazards) is rejected by the validator with a pointing
  error and deferred.

**Constraint (validated rule, enforced at query time):** a semantic query may
GROUP BY dimensions from at most **one** m2m reference (filters from any
number are fine — semi-joins compose). Two m2m dimension sources in one query
cross-multiply bridges and re-inflate measures within groups; the validator
rejects it with a pointing error ("split into two queries or model a combined
bridge view"). `many_to_one`/`one_to_one` dimensions combine freely with the
one m2m dimension source.

Note on GUI SQL: `validateSqlForGui` keeps rejecting subqueries for
*user-authored* GUI SQL; the m2m compiler *generates* IR directly and never
passes through that parse gate (generation ≠ parsing — separate code paths,
verified).

## 6. Execution plan — ONE PR, six milestones

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

- [ ] Contracts — **TypeBox is the single source of truth** (repo rule):
      define the §2.3/§5 shapes (`SemanticModelV2`, `SemanticSource`,
      `SemanticReference` union, `SemanticReferenceM2M`,
      `SemanticMetric = ratio | sql`) as TypeBox schemas in
      `lib/validation/atlas-schemas.ts` (following the `CtxMetricDef`
      precedent), with `Static<typeof …>` types; `lib/types/semantic.ts`
      RE-EXPORTS those Static types — no hand-written duplicate interfaces
      (the TS blocks in §2.3/§5 are illustrative shape, not a second
      source). The tier-1 validator uses the schema as its shape gate for
      agent-authored JSON. Keep the OLD
      `SemanticModel`/`SemanticJoin`/`TableRelationship` types exported and
      untouched (M6 deletes them); fix the stale doc-comment on the old type.
- [ ] Add `semanticModels?: SemanticModelV2[]` to `ContextVersion`
      (`lib/types/context.ts` — plain TS interface; `ContextVersion` itself
      has no TypeBox schema and gets none). Do NOT set
      `additionalProperties: false` anywhere at the `ContextVersion` level.
- [ ] Inheritance: wire `fullSemanticModels` through the context loaders
      (`lib/data/loaders/context-loader*.ts`) and `context-agent-view.ts`,
      copying the `fullViews` inheritance flow. (Agent WRITE access —
      `semanticModels` into `EDITABLE_VERSION_FIELDS` — deliberately waits
      for M5a, when the skill and tier-2/3 gates exist; until then agents
      couldn't author models safely anyway.)
- [ ] Red tests, then implement `lib/semantic/validate.ts` — tier-1
      `validateSemanticModel(model, ctx): string[]` covering, each with its
      own test: name-slug uniqueness across dims+measures+metrics
      (`semanticAlias`, case-insensitive); reference aliases unique; reserved
      aliases rejected (`primary`, `_m2m_*`, `_grain`, `_views`, `_probe`);
      connection consistency (§2.3); model name not colliding with any view
      name, both directions (§2.3); dimension `source`/`column` resolve to
      exposed fields; `timeDimension.column` is a temporal exposed field of
      the primary; `primaryKey` required when any m2m ref exists (allowed
      always); m2m single-column keys only (§5); metric-SQL qualified-ref
      lexer (comment/string-aware; unqualified ref → error listing candidates;
      quoted identifier → rejection with §2.5's message; m2m alias ref →
      rejection); ratio metrics' `numerator`/`denominator` resolve to
      declared measures. No aggregate-token check — aggregate-ness is
      tier 3's job via the always-GROUP-BY probe (§2.5). The `ctx` argument
      of `validateSemanticModel(model, ctx)` = the context's `fullSchema` +
      `fullViews` (exposed fields + column types); when a table is
      unprofiled and a column's type is unknown, the `timeDimension`
      temporal-type check is SKIPPED. The safety net for a bad time axis is
      then QUERY time, not the save gate: the tier-3 probe (metric + first
      dimension) never exercises `timeDimension`, so a non-temporal axis
      surfaces when a semantic query first requests a `timeGrain` and the
      compiled `DATE_TRUNC` fails in the engine. Do NOT add `timeDimension`
      to the save probe to change this — accepted behavior.
- [ ] Reverse namespace check: the VIEW save path also rejects a view name
      that collides with a semantic model name (§2.3 — both directions).
      This lands in the views name-uniqueness seam
      (`lib/views/prepare.server.ts` / `save-gate.server.ts`) — those files
      are NOT on the §2.2 removal list; touching them here is safe and
      intended.
- [ ] Wire tier-1 into the context save path (same seam `prepareView` /
      view save-gating uses) so an invalid model blocks the version save.
- [ ] No migration work of any kind (per §2.2 — nothing stored, nothing to
      convert).

Done-when: new tests red-first then green · `npm run validate` clean ·
`npm test` green · commit + push.

### M2 — Compiler re-point + tier-2

Goal: `compileSemanticQuery` compiles V2 models (to-one refs only; m2m
compiles in M3 — until then the compiler throws a clear "m2m not yet
compiled" error).

- [ ] Red tests first: golden-SQL tests per dialect (duckdb/bigquery/postgres)
      for: primary=table, primary=view (`FROM _views.<name>`), to-one
      reference joins from `references[].on`, dimensions with
      `source: <alias>`, base-qualification when joins are in play (existing
      behavior, keep), ratio metrics (existing), and SQL metrics.
- [ ] Re-point `lib/semantic/compile.ts` from the old `joins`/`SemanticJoin`
      shape to `references` (accept `SemanticModelV2`).
- [ ] SQL metrics: alias-rewrite `primary.` / `<refAlias>.` → real
      table/view/alias qualifiers, emit as `{ type: 'raw', raw_sql }` select
      column (§2.5 tier-2, verified pattern).
- [ ] **Metric-only join inclusion** (easy to miss, silently emits invalid
      SQL if skipped): a SQL metric referencing a to-one alias that appears
      in NO selected dimension (e.g. `SUM(costs.total)` with only primary
      dimensions) must still pull that reference's JoinClause into the
      compiled query — join usage is computed from dimensions/filters PLUS
      the tier-1 lexer's extracted metric refs. Dedicated golden test.
- [ ] Extend `validateSemanticQuery` for V2 (unknown measure/dimension/join
      errors keep their existing human-readable format;
      `SemanticCompileError.issues` shape unchanged).
- [ ] Wire the tier-2 compile check into the SAME save gate tier 1 uses
      (M1's seam): every metric compile-probes on save from this milestone
      on; failures block the save (§2.5 — tier 2 is save-blocking, not just
      an EditFile-time courtesy).
- [ ] **SemanticExplorer + detection conversion (§2.7):** `derive.ts` emits
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

Done-when: same as M1 (`npm run validate` + full `npm test`, characterization
suites having stayed green) · `npm run test:qa` green (question UI surface
touched) · commit + push.

### M3 — m2m compilation

Goal: §5 exactly — semi-join filters + dedup-bridge-CTE dimensions.

- [ ] Red tests first, in-memory DuckDB fixtures (`@duckdb/node-api`,
      orders/tags/order_tags with one double-tagged order — §4's scenarios):
      (a) per-group totals correct (promo=100, vip=150 shape); (b) an
      explicit test that the NAIVE join gives the wrong total (documents why
      the CTE exists); (c) filter-only semi-join total correct; (d) LEFT
      NULL-group row present for untagged primary rows; (e) golden SQL for
      all three dialects.
- [ ] Implement in `compile.ts`: m2m filter → `raw_column`/`raw_value`
      `pk IN (SELECT …)` FilterCondition; m2m dimension → `_m2m_<alias>`
      dedup CTE (`ctes: [{ name, raw_sql }]`) + LEFT join on `primaryKey`.
- [ ] Query-time validator rules (in `validateSemanticQuery`): ≤1 m2m
      dimension source per query; m2m filter negation rejected — both with
      §5's pointing errors, both tested.

Done-when: same as M1 (incl. the DuckDB execution tests) · commit + push.

### M4 — Tier-3 dry-run save gate

Goal: §2.5 blocking policy live end-to-end.

- [ ] Red tests first (node project, real route/save path + test DB per
      `store/__tests__/test-utils.ts` patterns): bad-SQL metric blocks save
      with structured issues; infra failure saves with `verified: false`;
      metric-text-only edit probes only changed metrics; a PURE metric
      deletion probes nothing (the easy-to-get-wrong case — a naive
      "diff the metrics array" probes on deletion); ANY other edit
      (incl. a measure or dimension edit) probes all; a `verified: false`
      metric is included in every subsequent save's probe set until it
      verifies (§2.5 — saves are the ONLY probe trigger); a measure rename
      probes all while a metric rename probes only itself (§2.5 rename
      rules); parallel probing (cap 4) with one timing-out metric marked
      `verified: false` while the rest complete (§2.5 execution policy).
- [ ] Implement: probe = compiled `SemanticQuerySpec` per §2.5's probe shape
      (metric + first dimension; zero dimensions → group by first exposed
      primary column; constant `GROUP BY 1` ONLY as the no-known-columns
      last resort) wrapped
      `SELECT * FROM (…) AS _probe LIMIT 0`, executed via
      `runQuery` (copy `lib/views/prepare.server.ts`); classify
      validation-vs-infrastructure errors; stamp `verified` per §2.5.
- [ ] Metadata-only edits (`description`/`label` fields only) probe nothing
      (§2.5 carve-out) — tested.
- [ ] Zero-dimension probe per §2.5's decided shape: first exposed primary
      column (constant grouping only as the no-known-columns last resort —
      no BigQuery verification needed; that edge is unreachable on BQ).
- [ ] Surface tier-1+2+3 issues as structured errors through the context
      save API response AND the agent EditFile tool-result path (§3).

Done-when: same as M1 (`npm run validate` + full `npm test`) · commit + push.

### M5 — Surfaces (two commit groups: M5a pipes, M5b editor UI)

Goal: users see only metrics+dimensions; agent gets `RunSemanticQuery` AND
can author models; free SQL gets model docs. MUST land before M6 (§2.2
ordering). Split so the well-specified pipes aren't hostage to UI iteration.

**M5a — agent tool, docs projection, explorer switch, authoring skill:**

- [ ] `RunSemanticQuery` server tool under `agents/**` (MXTool + TypeBox
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
- [ ] **Agent authoring:** add `semanticModels` to
      `EDITABLE_VERSION_FIELDS` in `context-agent-view.ts` (unlike `views`,
      which is deliberately absent there — §3 requires agent edits;
      deferred from M1 so it lands together with the skill and gates), and
      add `skill_semantic_models` to `orchestrator/prompts/prompts.yaml`
      (the per-type skill pattern — `skill_questions`, `skill_dashboards`,
      …) documenting the `SemanticModelV2` format: primary/references
      (incl. m2m `through`), dimensions/measures/metrics, qualified-ref
      metric SQL rules, and the tier-1/2/3 error feedback loop. Without the
      skill, agents would guess JSON against a TypeBox gate.
- [ ] **SemanticExplorer switch (§2.7):** `/api/semantic-models` and
      `SemanticExplorer` serve/consume authored models
      (`fullSemanticModels`) only; empty state points at model creation;
      derived models demoted to draft suggestions.
      `QuestionContent.semanticQuery` specs resolve against authored models
      only from here on.
- [ ] Docs projection into `context-agent-view.ts`: per model — name,
      references (alias, cardinality, join columns), dimensions, and metric
      definitions ("metric `revenue` on `Orders` = `SUM(…)`"). Unit-test the
      projected text.

**M5b — editor + catalog UI (minimal contract, decided):**

- [ ] Semantic-model editor in the context editor (new tab/section beside
      views), **form-based** (not raw JSON): connection fixed by picking the
      primary; source pickers (primary/reference/bridge) scoped to that
      connection listing tables + views; per-reference relationship selector
      + join-column pickers; m2m authoring INCLUDED (bridge + `through`
      columns per §5 — m2m is a headline feature of this PR, it gets UI);
      dimensions/measures/metrics as editable lists (metric SQL in a plain
      code textarea); tier-1/2/3 errors inline per §2.5; a "prefill from
      table" action using the draft-suggestion engine. Explicitly NEED-NOT:
      drag-drop, live previews, diagram views — lists and pickers suffice.
- [ ] Catalog/browse surface listing each model's dimensions + metrics only
      (no tables/SQL), grouped under the model's connection (§2.3).
- [ ] UI tests as `*.ui.test.tsx` (jsdom, `getByLabelText` only — add
      `aria-label` to every interactive element).
- [ ] Browser-verify on the dev server: author a model over tutorial data
      (incl. one m2m reference), break a metric and see the tier errors,
      run a semantic query via chat and read the debug message (exact LLM
      request/response) to confirm the tool schema + docs projection +
      skill look right.

Done-when: `npm run validate` + full `npm test` green · `npm run test:qa`
green · browser verification done (say so honestly) · commit + push (one
commit per group).

### M6 — Removal sweep + final green

Goal: `TableRelationship` and every reader/writer gone; suite + QA green.

- [ ] Re-run the surface greps first and treat the UNION of results as the
      checklist. Two passes, because the type-name grep alone misses plain
      field readers (`version.relationships`, UI prop names):
      `grep -rln 'TableRelationship\|fullRelationships' --include='*.ts' --include='*.tsx' lib app components agents store orchestrator`
      then a review pass over
      `grep -rn '\brelationships\b' --include='*.ts' --include='*.tsx' lib app components agents store orchestrator`
      (manually skip true-negative hits, e.g. unrelated English in comments).
- [ ] Delete: `TableRelationship` type + `ContextVersion.relationships` +
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
- [ ] Blue→Red→Blue where old tests cover removed behavior: delete/replace
      those tests deliberately, never weaken assertions to keep them passing.
      Includes deleting `table-relationships-editor.ui.test.tsx` with its
      component, and settling whatever remains of the §2.2 test-file five
      (`lib/semantic/__tests__/*`) that M2–M5 haven't already rewritten.
- [ ] Final check: grep for
      `TableRelationship|fullRelationships|SemanticJoin` returns ZERO hits
      outside this doc; the old `SemanticModel` interface is gone from
      `lib/types/semantic.ts` (the name may live on only if V2 adopts it as
      its export name — either way, one shape exists); and the
      `\brelationships\b` review pass shows no remaining live reader of the
      stored field.
- [ ] `npm run validate` · `npm test` · `npm run test:qa` all green.
- [ ] Mark the PR ready for review (body stays empty).

Done-when: all of the above checked · push.
