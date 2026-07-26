# lib/semantic — the semantic-model tier

## What this module does

Owns the **authored semantic vocabulary** (`SemanticModelV2`: one primary source, N explicit
references, dimensions, metrics), the deterministic `SemanticQuerySpec → QueryIR` compiler, its
reverse (IR → spec detection), and the three-tier validation that gates model authoring.

It explicitly does NOT: generate SQL (`lib/sql/ir-to-sql.ts` does, from the IR this emits),
execute queries (`lib/connections/run-query.ts`), store models (they live on
`ContextVersion.semanticModels`, inherited as `content.fullSemanticModels` by
`lib/data/loaders/context-loader-utils.ts`), or know anything about dialects.

Level ordering: raw tables (context whitelist) → data models/views (`lib/views/`, addressed
`_views.<name>`) → semantic models. Semantic models reference tables and views; **nothing
references a semantic model.**

## Architecture

```
ContextVersion.semanticModels ── loaders ──► content.fullSemanticModels
        │
        ├─ models.server.ts  (nearest context for a path, published version + inherited)
        │     ├─ POST /api/semantic-models ─► models-client.ts ─► lib/hooks/use-semantic-models.ts
        │     │                                                 └─ lib/hooks/use-semantic-compat.ts
        │     └─ RunSemanticQuery (defined in agents/benchmark-analyst/db-tools.server.ts;
        │        in the RemoteAnalystAgent + WebAnalystAgent toolsets)
        ▼
  SemanticQuerySpec (lib/validation/atlas-schemas.ts)  ×  SemanticModelV2
        │ validateSemanticQuery(spec, model)      ← spec-vs-model rules (lives in compile.ts)
        ▼ compileSemanticQuery  (compile.ts)      ← compiles to IR, never dialect SQL
      QueryIR (lib/sql/ir-types.ts)
        │ irToSqlLocal(ir, dialect) → resolveViewsInSql (lib/views/resolve.ts)
        ▼ runQuery
```

Reverse direction: `semanticSpecFromIr` (detect.ts) recovers a spec from parsed IR;
`detect-sql.ts` adds the dialect-aware WASM parse in front of it. Both are gated by
**recompile-and-compare** — a recovered spec must recompile to an equivalent IR.

**Three validation tiers, and where each lives:**

| Tier | What it proves | File | On failure |
|---|---|---|---|
| 1 — static | TypeBox shape gate, names/alias/namespace rules, sources resolve against the exposed schema, metric-SQL lexing | `validate.ts` | blocks |
| 2 — compile | every metric compile-probes through the real compiler | `edit-check.ts` (`compileProbeIssues`) | blocks |
| 3 — dry-run | `SELECT * FROM (…) AS _probe LIMIT 0` against the real engine | `save-gate.server.ts` | bad SQL blocks; infra fails **open** |

`edit-check.ts` holds tiers 1+2 in a **pure** module (no `server-only`, no DB, no connector)
because the agent's EditFile path (`lib/tools/handlers/edit-file.ts`) and the staging path
(`lib/file-state/file-edit.ts`) run in the **browser** and cannot import the server-only gate.
Both sides call the same functions, so the rules cannot drift — but the two browser callers
differ in force: EditFile passes the SAVED content and **rejects the edit atomically** with the
issue list, while `file-edit.ts` passes `saved: undefined` (every model checked) and only
surfaces issues as a non-blocking lint. The gate itself is wired into `lib/data/files.server.ts`
(`saveFile`), so every context UPDATE — editor UI, raw JSON, agent EditFile — passes through it;
`createFile` does not call it, so a freshly created context is only gated on its first save.

**Only the two `*.server.ts` files may import `server-only`.** Compile / validate / metric-sql /
edit-check / derive / infer-join / infer-viz / detect are all browser-reachable (the explorer,
the models editor, `QuestionViewV2`, the EditFile handler), so a `server-only` (or WASM) import
in any of them breaks the client bundle.
Tests: `npx vitest run --project=node lib/semantic`.

Authoring surfaces: `components/context/SemanticModelsEditor.tsx` (drafts from `derive.ts`,
join proposals from `infer-join.ts`, Test button → `models-client.testSemanticModel` →
`save-gate.server.testSemanticModel`), `components/query-builder/SemanticExplorer.tsx`
(compiles client-side, calls `irToSqlLocal` itself), `components/views/QuestionViewV2.tsx`
(`infer-viz` chart defaults), and the agent via `skill_semantic_models` in
`orchestrator/prompts/prompts.yaml`.

## Gotchas

- **compile.ts emits IR, but not *only* IR.** Ratio metrics (`… * 1.0 / NULLIF(…, 0)`),
  rewritten SQL metrics, m2m CTE bodies and the EXISTS/NOT EXISTS semi-joins go out as `raw_sql`
  fragments — which is why compile.ts carries its own `formatSqlValue` mirroring `formatValue` in
  `lib/sql/ir-to-sql.ts`. Change escaping in one and the m2m fragments silently diverge.
- **`verified` is server-managed.** `withPreservedStamps` strips any client-sent value. Never
  trust `verified` arriving in content; only tier-3 outcomes or the stored stamp set it.
- **Fail closed on bad SQL, fail open on infrastructure.** `INFRA_ERROR` in
  `save-gate.server.ts` classifies timeouts/connection errors → the save proceeds with
  `verified: false`. A down warehouse must never make a context uneditable. `verified: false`
  metrics are **sticky**: included in every subsequent probe set until they go green.
- **Probe scope has exactly three cases** (`probeScope`): structural change → all metrics;
  metric-text-only → added/changed only (a ratio's *essence* embeds the resolved definitions of
  its aggregation metrics, so changing `Revenue` re-probes its dependent ratios); metadata-only
  → nothing. Diffing uses `sortedJson`, not `JSON.stringify` — stored JSONB does not preserve
  key order and the agent markup round-trip reorders keys, so a naive compare marks every save
  structural.
- **Tier 1 bails right after the shape gate.** Agent/JSON-authored models can be missing
  required fields at runtime; without that early return the remaining rules dereference them and
  throw a bare 500 with no issue list — the one failure an LLM cannot self-correct from.
- **`fieldChecksTrustworthy` deliberately degrades.** Client-side bounded schemas ship tables
  without columns, so field-level tier-1 checks would reject good models; there, only tier 2 runs
  and the server gate is the authority. `changedSemanticModelIssues` never throws (a malformed
  context yields no issues), and skips unchanged models *only when a `saved` content is passed* —
  which is what makes the blocking EditFile path safe: a model merely stale against the warehouse
  must not make an unrelated docs edit un-appliable.
- **Base qualification is all-or-nothing.** The instant any reference is used, every base column
  is qualified with the primary's table name; unqualified names become ambiguous the moment a
  joined source shares them. Detection normalizes all base-qualifier spellings (absent / table
  name / FROM alias) to `''` when comparing.
- **Metric-only join inclusion:** a SQL metric referencing `costs.total` pulls the `costs` join
  in even when no `costs` dimension is selected. Skipping it emits invalid SQL silently.
- **The metric-SQL lexer (`metric-sql.ts`) is deliberately not the polyglot parser** — the
  parser returns an opaque `raw` select column for even `SUM(a) - SUM(b)`, extracting zero refs
  from any compound metric. Quoted identifiers are *rejected*, not lexed. Every bare identifier
  is an error even when no candidate matches; candidate matching is case-INsensitive, so the
  error can still point at the right spelling.
- **m2m compilation is grain-preserving, and each piece is load-bearing:** grouped dimensions →
  a `_m2m_<alias>` DISTINCT bridge CTE projecting one `_pk<k>` per `through.primaryOn` pair,
  joined on **all** of them (a prefix match leaks far values into groups); filter-only aliases →
  correlated `EXISTS` / `NOT EXISTS`. Bridge and far are **always** aliased `_b`/`_f`: when the
  bridge *is* the primary table, an unaliased correlation compiles to `t.pk = t.pk` and silently
  matches every row. Filters on a **grouped** alias live inside its CTE — as outer conditions
  they widen the DISTINCT projection and double-count within a group. Negation rides on
  `EXISTS`; the far-table predicate stays positive. A query may GROUP BY dimensions from at most
  **one** m2m reference (`validateSemanticQuery` rejects two).
- `primaryKey` is required whenever any reference is m2m, and `through.primaryOn` must name
  exactly those columns in order — the compiler keys the bridge join off `primaryOn`, so a
  mismatch compiles at a grain that is not the declared one.
- **Aggregation metrics are primary-column only** — that is what makes "metrics can never fan
  out" true by construction. Reference columns need a `sql` metric; m2m aliases in metric SQL
  are rejected outright.
- **`detect.ts` must stay WASM-free** (it ships to the browser). `detect-sql.ts` is the only file
  in this module that pulls the WASM parser (`@/lib/sql/sql-to-ir`) and is therefore
  server/test-only; browser callers parse via `CompletionsAPI.sqlToIR` and hand the IR to
  `semanticSpecFromIr` (see `lib/hooks/use-semantic-compat.ts`). Detection yields false negatives,
  never false positives; ORDER BY / LIMIT are compared loosely, so "open in Semantic" may
  normalize row order.
- **Time axis:** the *first* `temporal: true` primary dimension is the default; `spec.timeColumn`
  names a COLUMN (not a dimension) and may select any other primary temporal one. Tier 1 checks
  the column type only when it is known, and tier 3 never probes with a `timeGrain` — a bad axis
  surfaces at query time when `DATE_TRUNC` fails. That is accepted; do not add a time-axis probe.
- **DERIVED models are never stored on context content** — a large workspace derives multi-MB of
  vocabulary that would ship on every context load, the exact payload class schema bounding
  exists to prevent. (Authored models DO live on `ContextVersion.semanticModels`.) `derive.ts` is
  a *draft-suggestion* engine only: its one production consumer is `SemanticModelsEditor`
  pre-filling a draft — it feeds no querying, search, or detection. (Its own module docstring
  claims `models.server.ts` derives models per request; that is stale — `models.server.ts` serves
  authored models only.)
- **Model names share ONE namespace with view names, both directions.**
  `semanticModelNames` (save-gate.server.ts) is called by `lib/views/save-gate.server.ts` for
  the reverse check. Reserved reference aliases: `primary`, `_grain`, `_views`, `_probe`,
  `_m2m_*`. `semanticAlias` suffixes `_` on BigQuery reserved words ("Rows" → `rows_`).
- **ESLint:** module-level `new Map()`/`new Set()` are restricted (`no-restricted-syntax` in
  `eslint.config.mjs`, `Program > VariableDeclaration` only). Use `immutableMap`/`immutableSet`
  from `lib/utils/immutable-collections` for constants (`RESERVED_ALIAS`, `SQL_KEYWORDS`);
  a mutable server-side cache needs a per-request scope key plus a justified disable (see
  `dialectCache`, keyed `mode|connection`).
- `SemanticModelSaveError.issues` crosses `files.server.ts` **newline-joined**, not `; `-joined,
  so the editor can attach each issue to its own model/metric row.
- Round-trip tests cannot catch **binder** errors (ambiguous columns, bad qualifiers) — nothing
  binds against a real schema. That is why `__tests__/compile-execute.test.ts` runs against real
  DuckDB with deliberately colliding column names, and `m2m.test.ts` / `m2m-postgres.test.ts`
  execute the m2m shapes on DuckDB and real Postgres (PGLite). Keep new compiler shapes covered
  by an executing test, not just a golden.

## Code pointers

| Task | File |
|---|---|
| spec → IR compilation, alias slugs, m2m CTE/EXISTS, `validateSemanticQuery` | `compile.ts` |
| tier-1 static model rules (shape gate, names, sources, temporal, metric rules) | `validate.ts` |
| tiers 1+2 shared with the browser EditFile path; probe spec; `sortedJson` | `edit-check.ts` |
| tier-3 dry-run, probe scoping, `verified` stamping, editor Test button | `save-gate.server.ts` |
| metric-SQL lexing, `primary.` → base-qualifier rewrite | `metric-sql.ts` |
| IR → spec detection + equivalence gate (pure, browser-safe) | `detect.ts` |
| SQL-string detection (pulls the WASM parser; server/test only) | `detect-sql.ts` |
| serving authored models by path, field search, server-side detection | `models.server.ts` |
| browser fetch + per-page cache, Test-button transport | `models-client.ts` |
| editor draft models pre-filled from the profiled schema | `derive.ts` |
| join-column / primary-key proposals (name heuristics, no FK metadata) | `infer-join.ts` |
| default + recommended chart types from a spec's shape | `infer-viz.ts` |
