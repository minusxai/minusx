# Benchmark agent V2: core data primitives (additive, opt-in)

## Context

The benchmark data-analyst agent (`frontend/agents/benchmark-analyst/`) has 5 tools:
`ListDBConnections`, `SearchDBSchema`, `ExecuteQuery`, `FuzzyMatch`, `ExploreDataset`.
The recent DataAgentBench run surfaced systemic failures that are **interface**
problems, not model problems:

- **Context pollution** — query results dumped as huge markdown tables, then
  truncated crudely by `compressQueryResult`.
- **Thrashing** — the agent can't cheaply orient (no column stats/profiles), so it
  flails (one run: 96 tool calls, 9 errors).
- **Fragile composition** — `$label.col` string interpolation broke on the model's
  SQL-habit syntax; when it failed, the model brute-forced giant inline ID arrays
  that truncated.
- **Opaque output** — `ExploreDataset` returns prose the caller must re-parse.

The redesign collapses these into **4 sharp primitives** on three principles:
(1) **data by reference** — every query returns a handle; results live outside
context; (2) **progressive disclosure** — schema/stats/profiles are compressed
views, raw rows pulled on demand; (3) **uniform shape** — same
`(queries, prompt?, sequential?)` signature, same `{results:[{preview,handle,stats}], info?}`
output, **no mode enums**.

**Strategy: a parallel, opt-in V2 agent — purely additive.** Rather than mutating
the shared `BenchmarkAnalystAgent` (which production agents extend), we add a new
`V2BenchmarkAnalystAgent` + new tool classes, selected by a `DAB_V2` flag. Nothing
is deleted; no existing tool, agent, or production code path changes behavior. The
old benchmark stays runnable as the A/B baseline.

## Scope — what is and isn't touched

**Verified dependency graph:**
- `RemoteAnalystAgent` & `WebAnalystAgent` (production) **extend `BenchmarkAnalystAgent`**
  but override `tools` + `getSystemPrompt()`. `V2BenchmarkAnalystAgent` also extends
  `BenchmarkAnalystAgent` and overrides the same two — it is a **sibling** of the
  production agents. Changes flow parent→child, so adding V2 cannot affect the
  existing benchmark or production.
- `runner.ts` is fully generic (`runBenchmark({agentClass, registrables, ...})`) —
  **zero changes needed**.
- The `Base*` tool classes, `db-tools.ts`, `db-tools.server.ts`, `benchmark-analyst.ts`,
  `explore-dataset.ts` behavior, `FuzzyMatch`, `ExploreDataset`, `ListDBConnections`,
  `lib/connections/fuzzy-search.ts`, `V2_REGISTRABLES`/`BENCHMARK_TOOL_SWAPS` — **all
  untouched**. **Nothing is deleted.**

**Existing files modified — all additive / refactor-safe:**
- `benchmarks/dataanalystbench.ts` — add a `DAB_V2` branch picking the V2 agent +
  V2 registrables (mirrors the existing `doubleCheck` conditional).
- `lib/config.ts` — declare the `DAB_V2` env var (additive).
- `agents/benchmark-analyst/explore-dataset.ts` — **only** change the import source
  of `interpolateRefs` / `interpolateMongoRefs` / `detectLowLimit` to the new
  `v2/query-refs.ts`, and re-export `interpolateMongoRefs` for its existing test.
  Pure extract-refactor; the existing `explore-dataset.test.ts` green tests guard it
  (Blue→Red→Blue).
- `agents/benchmark-analyst/shared-duckdb.ts` — **if needed**, additive methods only
  (register catalog / handle tables); V2 may instead use a V2-owned DuckDB attach.
  Either way, no existing behavior changes. V2 reuses `getOrCreateBenchmarkConnector`
  read-only.

**Everything else is new files**, under `agents/benchmark-analyst/v2/`.

## The four tools

LLM-facing names stay clean (`SearchDBSchema`, `ExecuteQuery`, `Explore`,
`fetchHandle`); the TS classes are new (`SearchDBSchemaV2`, etc.) — same pattern as
`BaseExecuteQuery` having `schema.name = 'ExecuteQuery'`.

| Tool | Signature | Purpose |
|---|---|---|
| `SearchDBSchema` | `(queries, prompt?, sequential?)` → `{results, info?}` | SQL over a synthetic **catalog** (structure + stats) |
| `ExecuteQuery` | `(queries, prompt?, sequential?)` → `{results, info?}` | SQL over **data**; handles are queryable tables; fuzzy = SQL, semantic = prompt |
| `Explore` | `(filter, prompt?)` → `{results, info?}` | Cross-table discovery search — "search when you don't know the table" |
| `fetchHandle` | `(handle, offset?, length?)` → `{preview, stats}` | Ergonomic "more rows of what I already have" |

### `SearchDBSchema(queries, prompt?, sequential?)`
- `queries`: `{ query, label? }[]` — SQL against a synthetic catalog (no per-item
  connection; the catalog is one thing).
- Catalog tables: `connections`, `schemas`, `tables`, `columns`, `indexes`,
  `column_stats`. `level` is **emergent** from the SELECT — no `level` enum.
- Catalog holds **structure + stats/profiles only**. Raw sample rows are data →
  `ExecuteQuery`.

### `ExecuteQuery(queries, prompt?, sequential?)`
- `queries`: `QuerySpec[]` = `{ connection, query, label? }` — same shape as
  `ExploreDataset`'s `QuerySpec`.
- `sequential` (default `false`): `false` → independent/parallel; `true` → run in
  order, `$label.col` references resolve via `interpolateRefs`/`interpolateMongoRefs`,
  "2nd+ query must reference an earlier result" validation applies.
- Handles are **queryable as tables**: SQL may do `FROM handle_xyz` (handle rows
  registered as DuckDB tables — works even for Mongo result handles).
- Fuzzy matching = SQL the model writes (`jaro_winkler_similarity()` etc.); semantic
  = the `prompt`. No fuzzy tool.

### `Explore(filter, prompt?)`
- `filter`: `{ connection?, schema?, table?, columns?, match }` — `match` (term) is
  the cheap lexical search; the rest scope where to look.
- Resolves in-scope text columns from the catalog, runs per-dialect lexical/fuzzy
  match, unions results (with `source` + `score` columns), optional `prompt` does a
  semantic re-rank.
- Least-defined of the four; most implementation latitude. Description must be sharp
  about *when* to use it (discovery) vs `ExecuteQuery` (you know the table).

### `fetchHandle(handle, offset?, length?)`
- Pagination over a stored result. Returns `{preview, stats}`. Thin, obviously cheap
  — no SQL, no prompt.

## Shared concepts

**Handles.** Process-lifetime `Map<handleId, QueryResult>` (`v2/handle-store.ts`).
Every query in every tool returns a handle + a bounded inline `preview`. Handle rows
are also registered as queryable DuckDB tables so `ExecuteQuery` can `FROM handle_xyz`.

**Return shape.** `{ results: [{preview, handle, stats}], info? }` — one result per
query; **per-query errors** (`{error}` in place of a result — never all-or-nothing).
`info` is **top-level** (single cross-query synthesis), present only when a `prompt`
ran. `prompt` is **across all queries** in the batch: the lighter model sees every
result set, may re-rank each `preview` (selects/ranks rows it was *given* — never
re-emits row data), and writes one bounded factual `info`.

**`stats`** (per result, per column): `rowCount`, `previewCount`, and per-column —
numeric: `min/max/avg`; text/categorical: `cardinality: 'low'|'high'`, `nDistinct`,
`topValues` (low-cardinality only), `avg/min/maxLength`. The compression that lets
the model "see" all N rows without holding them.

**The catalog.** Tables built lazily once per run from `connector.getSchema()` +
`profileDatabase()` enrichment (`v2/catalog.ts`).

**Dialect hints + system prompt.** A `DIALECT_HINTS` map keyed by dialect (fuzzy
function, Mongo aggregation-pipeline syntax, `SUMMARIZE`, index-awareness), rendered
into the V2 agent's system prompt **only for dialects present** in the connection
set. The prompt also explains the handle model, the catalog, and sequential batches.

## Reused — do not reimplement

- `interpolateRefs`, `interpolateMongoRefs`, `detectLowLimit` — **extracted** from
  `explore-dataset.ts` into `v2/query-refs.ts` (existing tests migrate / guard it).
- `enforceQueryLimit`, `enforceMongoLimit` — row caps.
- `compressQueryResult`, `TOOL_MAX_LIMIT_CHARS` — building `preview`.
- `clampQueryTimeoutSeconds` — timeout handling.
- `getOrCreateBenchmarkConnector`, `BenchmarkSharedDuckdb` — connectors, catalog &
  handle tables (read-only reuse; additive methods only if extended).
- `profileDatabase` (`statistics-engine.ts`) + `classifyColumn` — catalog stats and
  result `stats`.
- `exploreModel` / `setExploreModel` / `orchestrator.callLLM` — the `prompt` pass.
- The `RemoteAnalystAgent` pattern (`extends BenchmarkAnalystAgent`, override
  `tools`/`getSystemPrompt`/`schema`/`model`) — the template for `V2BenchmarkAnalystAgent`.

## TDD — establish the full spec first

Write **all** of these RED before implementation — they *are* the spec. Component
E2E style per CLAUDE.md; reuse `test-utils.ts` + faux provider. All under
`agents/benchmark-analyst/v2/__tests__/`.

| Test file | Asserts |
|---|---|
| `query-refs.test.ts` | migrated `interpolateRefs` / `interpolateMongoRefs` / `detectLowLimit` tests |
| `handle-store.test.ts` | store/fetch, unique ids, handle rows registered as a queryable DuckDB table |
| `result-stats.test.ts` | `computeResultStats()` — numeric vs text/categorical, low vs high cardinality, lengths, counts |
| `catalog.test.ts` | `buildCatalog()` produces the 6 tables; rows match connectors' schemas; `column_stats` populated via `profileDatabase()` |
| `fetch-handle.test.ts` | offset/length pagination, stats included |
| `search-db-schema.test.ts` | catalog SQL, multi-query, `{results,handle,stats}`, prompt → `info` |
| `execute-query.test.ts` | `QuerySpec[]` cross-connection, parallel default, `sequential` + label interpolation, `FROM handle_xyz`, per-query errors, prompt-across-queries |
| `explore.test.ts` | filter scoping, lexical `match`, optional prompt re-rank, `source`/`score` columns |
| `v2-agent.test.ts` | `V2BenchmarkAnalystAgent` advertises exactly the 4 tools; system prompt renders `DIALECT_HINTS` only for present dialects; distinct `schema.name` |

## Implementation order (bottom-up, to green)

1. `v2/query-refs.ts` — extract helpers from `explore-dataset.ts`; update
   `explore-dataset.ts` import + re-export; confirm `explore-dataset.test.ts` stays green.
2. `v2/handle-store.ts` — the Map + register-as-DuckDB-table.
3. `v2/result-stats.ts` — `computeResultStats()`.
4. `v2/catalog.ts` — `buildCatalog()` calling `profileDatabase()`.
5. `v2/dialect-hints.ts` — `DIALECT_HINTS` map + present-dialects renderer.
6. `fetchHandle` tool.
7. `SearchDBSchemaV2` tool.
8. `ExecuteQueryV2` tool — QuerySpec[], sequential/labels, handles-as-tables,
   prompt-across-queries, per-query errors.
9. `Explore` tool.
10. `V2BenchmarkAnalystAgent` (`v2/v2-agent.ts`) — extends `BenchmarkAnalystAgent`,
    overrides `tools` (the 4), `getSystemPrompt()` (dialect hints + handle/catalog
    explanation), `schema` (distinct name), `model`.
11. `DAB_V2` flag in `lib/config.ts` + the `DAB_V2` branch in
    `benchmarks/dataanalystbench.ts` (V2 agent + V2 registrables list).

**Tool descriptions** (steps 6–9) must each fully cover: SearchDBSchema → the 6
catalog table names + columns; ExecuteQuery → `QuerySpec` shape, `sequential` + label
semantics, `FROM handle_xyz`, fuzzy-is-SQL; Explore → `filter` shape + when to use it;
fetchHandle → pagination.

## Critical files

**New** (all under `frontend/agents/benchmark-analyst/v2/`):
`query-refs.ts`, `handle-store.ts`, `result-stats.ts`, `catalog.ts`,
`dialect-hints.ts`, the 4 tool files, `v2-agent.ts`, and `__tests__/*`.

**Modified (additive / refactor-safe only):**
- `frontend/benchmarks/dataanalystbench.ts` — `DAB_V2` branch.
- `frontend/lib/config.ts` — `DAB_V2` env var.
- `frontend/agents/benchmark-analyst/explore-dataset.ts` — import-source change for the
  3 extracted helpers.
- `frontend/agents/benchmark-analyst/shared-duckdb.ts` — additive methods *only if
  needed* for catalog/handle tables.

## Verification — remote session (self-contained)

Everything here runs from this repo alone — no external datasets needed. A remote
Claude Code session should complete all of steps 1–3 and stop here, then hand back.

1. `cd frontend && npm run validate` — TS + ESLint clean.
2. `npm test -- agents/benchmark-analyst lib/connections/__tests__` — full suite green
   (existing benchmark tests must still pass — proves the additive approach).
3. `MEASURE_PROMPT=1 npx jest promptMeasure --no-coverage --verbose` — prompt size impact.

## Verification — run locally only (needs DataAgentBench datasets)

These require the DataAgentBench datasets (`DAB_BENCH_BASE_DIR` → the DAB
`mxdatasets/` directory) and the separate `DataAgentBench` repo for `eval_output.py`.
**A remote session cannot run these** — they're done locally after the remote
session finishes steps 1–3.

4. A/B run on `agnews,yelp`:
   - Old agent baseline (fresh, single-run for clean comparison):
     `DAB_BENCH_DATASETS=agnews,yelp DAB_BENCH_RERUN=1 npm run benchmark:dab`
   - V2 agent: `DAB_V2=1 DAB_BENCH_DATASETS=agnews,yelp DAB_BENCH_RERUN=1 npm run benchmark:dab`
   - `uv run mxscripts/eval_output.py agnews yelp --file ~/Downloads/output.jsonl` on each.
   Watch for: handles used instead of inline ID arrays, no `$ref` syntax errors,
   `stats` driving fewer exploratory queries.
5. SQL regression: `DAB_V2=1 DAB_BENCH_DATASETS=stockindex` — confirm SQL path works.

## Follow-ups (not in this change)

- **V2 double-check agent.** `DAB_DOUBLE_CHECK` spawns `BenchmarkAnalystAgent`
  sub-agents; a `V2DoubleCheckBenchmarkAgent` (or parameterizing the existing one)
  would let `DAB_V2 + DAB_DOUBLE_CHECK` run together. Not needed for the initial A/B.
- **v2-chat viewing.** Viewing/resuming V2 benchmark conversations in the chat UI
  would need `V2BenchmarkAnalystAgent` + its tools registered in `V2_REGISTRABLES`.
  Deferred — the benchmark *runs* via the CLI, not v2-chat.
- **Production migration.** Once V2 proves out, the production tool variants
  (`db-tools.server.ts`) can adopt the same 4-primitive shape — a real follow-up
  (different seams: `runQuery`/`loadConnectionSchema`, the 24h connection-document
  schema cache, FilesAPI-backed config, multi-tenant/permission concerns — the
  catalog must respect `getEffectiveUser`). **Add a Tasks.md entry** capturing this.
- **Old-agent retirement.** If V2 wins decisively, fold it back into the default
  benchmark path and retire the old 5-tool set — a separate, deliberate cleanup.
