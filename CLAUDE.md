# MinusX

MinusX is an open-source agentic business intelligence platform: a file-system-shaped BI tool
whose questions, dashboards, stories, reports and alerts are documents an AI agent can read and
write directly.

This file is the authoritative description of the project — architecture, every module, how modules
interact, and the development philosophy that governs how work is done here. It documents the code
**as it is today**. There is no plan narrative, no migration history, and no changelog; that is what
git is for.

**Eight deep modules carry their own `CLAUDE.md`.** They hold implementation detail behind a narrow
interface, and their doc auto-loads when you work inside them. This file keeps an orientation
paragraph and a link for each, so nothing is invisible from the outside:

| Module | Doc | Why it has one |
|---|---|---|
| `frontend/orchestrator` | `frontend/orchestrator/CLAUDE.md` | The `MXTool`/`MXAgent` contract every agent implements |
| `frontend/agents` | `frontend/agents/CLAUDE.md` | The agent hierarchy, and why `benchmark-analyst` is production |
| `frontend/lib/chat` | `frontend/lib/chat/CLAUDE.md` | The turn pipeline and conversation storage |
| `frontend/lib/connections` | `frontend/lib/connections/CLAUDE.md` | Nine connectors behind one interface, plus the cache |
| `frontend/lib/sql` | `frontend/lib/sql/CLAUDE.md` | SQL ↔ IR; the subtlest correctness traps in the repo |
| `frontend/lib/database` | `frontend/lib/database/CLAUDE.md` | Highest fan-in and churn in the repo |
| `frontend/lib/viz` | `frontend/lib/viz/CLAUDE.md` | The largest single body of logic |
| `frontend/lib/tools` | `frontend/lib/tools/CLAUDE.md` | The narrowest interface in the repo |

Everything else — the semantic layer, the query cache, render surfaces, auth, routes, components,
infrastructure — is documented in full **in this file**. A module without its own doc is not a module
without documentation.

## Shape of the system

There is **one deployable application**: a Next.js app under `frontend/`. There is no separate
backend service. AI chat and agent orchestration run in-process inside it, and analytics queries
run in Node.js connectors inside it. A second, entirely separate app under `docs/` builds the
public documentation site.

```
                        ┌──────────────────────── frontend/ (Next.js) ────────────────────────┐
  browser ──HTTP/SSE──▶ │  app/            route handlers + pages                             │
                        │  components/     containers (Redux) → views (pure presentation)     │
                        │  store/          Redux + listener middleware (drives chat & tools)  │
                        │                                                                     │
                        │  orchestrator/   the engine: append-only log, step loop, tool tiers │
                        │  agents/         agent + tool definitions (analyst, slack, eval, …) │
                        │                                                                     │
                        │  lib/            the substance — see the module map below           │
                        └──────────┬───────────────────────────────┬──────────────────────────┘
                                   │                               │
                       document DB │                               │ analytics engines
                  (PGLite/Postgres)│                               │ (DuckDB, BigQuery, Postgres,
                   files, contexts,│                               │  SQLite, Athena, Mongo,
              conversations, users │                               │  ClickHouse, CSV, Sheets)
```

**Two data planes, deliberately separate.** The *document DB* stores the BI artefacts themselves —
files, contexts, conversations, users, connections — as JSON content addressed by integer id. The
*analytics engines* are the customer's own warehouses, reached through connectors, and MinusX never
stores their data except as cached query results.

## Module map

| Area | Lives in | Owns |
|---|---|---|
| Chat engine | `frontend/orchestrator`, `frontend/agents` | The orchestration loop and every agent/tool definition |
| Chat serving | `frontend/lib/chat`, `lib/llm`, `lib/projection` | Turning an HTTP request into a run, and streaming it back |
| Query data plane | `frontend/lib/connections`, `lib/query-cache`, `lib/sql` | Executing SQL: connectors, caching, and the SQL↔IR layer |
| Semantic layer | `frontend/lib/semantic`, `lib/context`, `lib/views`, `lib/validation` | Authored semantic models, schema whitelisting, content schemas |
| Storage | `frontend/lib/data`, `lib/database`, `lib/object-store` | The document DB, `FilesAPI`, migrations, blobs |
| Client state | `frontend/store`, `frontend/lib/file-state`, `lib/hooks` | Redux, the listener middleware, and all browser file/query operations |
| Visualization | `frontend/lib/viz`, `lib/chart`, `components/viz`, `components/plotx` | Vega rendering, the DOM table/pivot tier, chart config |
| Render surfaces | `frontend/lib/story-ui`, `lib/story-surface`, `lib/screenshot` | Rendered documents and serialization-based capture |
| Auth & access | `frontend/lib/auth`, `lib/http`, `lib/mode`, `lib/namespace`, `lib/rubric` | Sessions, permissions, mode and namespace isolation, file-health scoring |
| Tools & integrations | `frontend/lib/tools`, `lib/jobs`, `lib/integrations`, `lib/analytics` | Browser-bridged tools, scheduled jobs, Slack/MCP, telemetry |
| Routes | `frontend/app` | Every API endpoint and page |
| Components | `frontend/components` | The UI |
| Infrastructure | `frontend/scripts`, `frontend/test`, `.github`, `docs` | Build, tests, CI, and the docs site |

Areas without their own module doc are documented in full below; the eight listed above
keep an orientation paragraph here and their detail in the module.

---

## Chat Engine — `frontend/orchestrator/` + `frontend/agents/`

The in-process agent runtime behind **all** chat: browser, Slack, scheduled reports, evals,
micro-tasks, remote sessions and the benchmark CLI. Two trees with a hard boundary:

- **`orchestrator/`** — the generic engine. The conversation log, the step loop, the tool tiers, the
  single LLM call site. Owns no app concepts.
- **`agents/`** — every concrete agent and tool, and the app-specific context shapes.

→ **`frontend/orchestrator/CLAUDE.md`** for the `MXTool`/`MXAgent` contract and the registration rule.
→ **`frontend/agents/CLAUDE.md`** for the agent hierarchy — including why `benchmark-analyst` is the
base of the production analyst chain despite its name.

## Chat serving

What happens between an HTTP request and a streamed answer: turn orchestration, the registrables hub,
agent-args resolution, conversation storage (dedicated tables + LISTEN/NOTIFY) and the streaming bus.

→ **`frontend/lib/chat/CLAUDE.md`** for the turn pipeline, what each module owns, and the gotchas.

## Query data plane — `lib/connections`, `lib/query-cache`, `lib/sql`

Everything between "a user or agent has a query string" and "rows exist". Three modules with a strict
layering: `lib/sql` is pure text/AST work with no I/O, `lib/connections` owns driver contact,
`lib/query-cache` wraps execution in a durable SWR + lease + blob cache.

### What each module owns

**`lib/connections`** owns the `NodeConnector` contract and one implementation per engine (DuckDB,
SQLite, Postgres, BigQuery, Athena, ClickHouse, Mongo, CSV/Google-Sheets, internal_db), plus
connection resolution and the row-cap seam (`run-query.ts`), schema introspection, and column
profiling (`statistics-engine.ts`). It does **not** own connection *documents* — those are files,
loaded via `ConnectionsAPI` / `connectionLoader` in `lib/data`. It does not own SQL parsing (it calls
`lib/sql`), the result cache (it is called by `lib/query-cache`), or credentials (it receives an
already-resolved config; `resolveConnectionSecrets` is called by `run-query.ts` immediately before
handing config to the factory).

**`lib/query-cache`** owns the control plane (`query_cache` table access, the execution lease, SWR
classification), the data plane (gzipped-JSONL blobs in the object store), the JSONL codec that is
both the wire format and the at-rest format, and the guest-share authorization gate. It does **not**
decide *what* to execute — the caller supplies an `execute: () => Promise<QueryStream>` thunk — and
it does not own the `query_cache` DDL (that lives in `lib/database/postgres-schema.ts`).

**`lib/sql`** owns everything textual/structural about SQL: the polyglot-WASM parse/generate wrappers
(`sql-to-ir.ts` / `ir-to-sql.ts` / `ir-types.ts` / `ir-transforms.ts`), LIMIT enforcement, None-param
resolution, `:param` extraction and value assembly, table-whitelist validation, whitelist→schema
filtering, autocomplete, column inference, and context-doc/Schema-Notes rendering. It does **not**
execute anything, has no `server-only` guard except `whitelist-resolver.server.ts`, and owns no
state.

→ **`frontend/lib/connections/CLAUDE.md`** — the execution pipeline and every connector.

→ **`frontend/lib/sql/CLAUDE.md`** — SQL ↔ `QueryIR` round-tripping, parameters and the None
semantics. The subtlest correctness traps in the repo live there.

`lib/query-cache` has no module doc of its own — it is small, and its behaviour is inseparable from
the two modules above — so it is documented here, in full:

### The cache

The key is `${mode}:${getQueryHash(query, params, connection)}`, optionally suffixed with a hash of
`parameterTypes` when any are declared. **Mode-scoped, not user-scoped** — identical SQL+params in the
same mode shares one blob across all users and guests, which is safe because authorization happens
before the cache is touched. `parameterTypes` are folded in because they change how a value binds at
the warehouse (a BigQuery `date` param binds as a real `DATE`), and the fold is canonicalized so map
order does not fork the key.

`classifyCacheRow` (`swr.ts`) is pure: `miss` (no row or no blob) / `fresh` (`now < revalidateAt`) /
`stale` (`now < expireAt`, serve + background revalidate) / `expired`. Windows come from
`resolveCachePolicy` — per-file `content.cachePolicy` overriding `QUERY_CACHE_REVALIDATE_MS` (20 min)
and `QUERY_CACHE_EXPIRY_MS` (1 hr), with expiry clamped to at least revalidate.

The lease is an `INSERT … ON CONFLICT DO UPDATE … WHERE lease_expires_at < now` in `store.server.ts`:
the winner executes, losers `waitForReady` and read the winner's blob, and a crashed holder's lease is
steal-able. The winner heartbeats at `QUERY_CACHE_LEASE_MS / 3` so a long query never lapses its own
lease. A claim never clears `blob_ref`, so a stale row keeps serving while it is refreshed. Hard-expired
rows plus their blobs are swept opportunistically from the hot path (`maybeSweepExpired`, throttled to
once per 10 min) — there is no cron.

Failure contract: **execution** errors propagate (the route turns them into 400); **cache-infra**
errors degrade to a direct materialized execution that serves data uncached. A blob that vanished
between index read and blob read also re-executes.

`guest-query.server.ts` is the boundary that makes public shares safe: an anonymous viewer's
`(query, connection)` pair must literally appear in the file at `filePath` — inline queries via
`extractInlineFileQueries`, saved ones via the file's `references` column — matched after whitespace
normalization. Param values are coerced to `string | number | null` and params whose *name* is not
identifier-shaped are dropped.


### Boundaries with other areas

| Other area | Direction | Contract |
|---|---|---|
| `app/api/query/route.ts` | calls in | The only browser entry. Guest gate → whitelist validation → dialect → view inlining → `getCachedJsonlStream`. Returns `application/x-ndjson` with `X-Cache`/`X-Cached-At`/`X-Row-Count`. |
| `lib/file-state/query-results.ts` | calls in | Builds the request body, dedupes by `getQueryHash`, gates concurrency on `querySemaphore`, and decodes the JSONL with `decodeJsonl`. It calls `response.text()`, so the client buffers even though the server streams. |
| `lib/data/connections.server.ts` | called by | `ConnectionsAPI.getRawByName` is the hot-path lookup — it returns raw config including credential refs and, unlike `FilesAPI.loadFile`, never triggers schema profiling. |
| `lib/secrets/connection-secrets.server.ts` | called by | `resolveConnectionSecrets` turns `@SECRETS/…` refs into credentials inside `runQueryStream`; resolved values never leave the server. |
| `lib/data/loaders/connection-loader.ts` | calls in | Calls `connector.getSchema()` then `profileDatabase()` at schema-refresh time and stores the enriched schema on the connection document. Every later schema read (`load-schema.ts`, `SearchDBSchema`, `fuzzy-match-tool.ts`) is an O(1) document read, never live introspection. |
| `agents/benchmark-analyst/db-tools.server.ts` | calls in | `getCachedResultBounded` (char-budgeted agent reads), `executeFuzzyMatch`, and `irToSqlLocal` for compiled semantic queries. |
| `lib/mcp/server.ts` | calls in | `executeQuery` (`execute-query.server.ts`) → `runQuery`. **Bypasses the cache entirely.** |
| `lib/file-state/file-state.server.ts` | calls in | `executeQueriesForFile` uses `applyNoneParams` + `runQueryBounded` so headless file reads match the route's param semantics. |
| `lib/views/resolve.ts` | calls in | Round-trips SQL through the IR to rewrite `_views.x` into CTEs. Runs after whitelist validation and before the cache key. |
| `lib/semantic/{compile,save-gate,detect-sql}.ts` | calls in | The semantic compiler emits `QueryIR` directly (including `FilterCondition.raw_sql` for correlated `EXISTS`), then `irToSqlLocal`. |
| `lib/chat/agent-args.server.ts`, `lib/hooks/useContext.ts` | call in | `getWhitelistedSchemaForUser` (`schema-filter.ts`) and `resolveContextDocs` / `formatContextDocsSection` (`context-docs.ts`) build the schema + Schema-Notes blocks handed to agents and the right sidebar. |
| `lib/object-store` | called by | `blob-store.ts` streams gzipped JSONL through `putStream`/`getStream`. `createQueryCacheBlobStore()` is async and defaults to `await createObjectStore()`, so blob keys are namespaced by construction — the injectable factory that used to let one deployment opt in is gone. |
| `lib/app-event-registry` | called by route | Exactly one `AppEvents.QUERY_EXECUTED` per request, built from `CachedMeta` so hits and misses are both recorded. |

### Gotchas

- **Whitelist validation runs before the cache serve, not after.** The cache key has no `filePath`, so
  validating after a cache hit would let a user replay a query authorized under one file's context from
  a file where it is now denied.
- **View inlining runs before the cache key is computed.** Editing a view's body changes the resolved
  SQL and therefore the key, invalidating stale results for free. Non-view queries take a byte-identical
  fast path and are never parsed.
- **The client's `getQueryHash` and the server's cache key are not the same key.** The client hashes the
  raw query; the server hashes the post-view-resolution query and adds `getUserKey(user)` — the
  namespace's mode level, `mx/org`, not the bare mode — and a
  `parameterTypes` fold. `getQueryHash` uses `JSON.stringify(params)`, so the key is param-insertion-
  order-sensitive by construction — in practice `buildQueryParamValues` emits keys in declaration
  order, which is what keeps it stable.
- **`validateQueryTables` always parses as `duckdb`**, whatever the connection type. Parse failures
  allow the query through — the execution layer surfaces the syntax error instead.
- **`getWhitelistForPath` never throws.** Any lookup failure returns `null`, which means *unrestricted*.
  A chain of `'*'` whitelists also returns `null` rather than enumerating a possibly-stale cached schema.
- **`applyNoneParams` only round-trips when at least one param is None.** With no None params the SQL is
  passed through verbatim, which is why the IR losses above are invisible most of the time.
- **`runQuery` abandons, it does not cancel.** `QUERY_SERVER_TIMEOUT_MS` (180 s) races the
  materialization so callers and their semaphore slots are freed; the warehouse query may still be
  running. Only DuckDB/SQLite (`conn.interrupt()`) and Mongo (`maxTimeMS`) actually cancel.
- **DuckDB is sandboxed at instance creation**: `SET allowed_paths = [<db file>]` then
  `SET enable_external_access = false`, applied once per instance and inherited by every later
  connection. `lib/connections/__tests__/duckdb-security.test.ts` pins that `read_csv_auto`, `ATTACH`,
  and `glob` on arbitrary paths are blocked. A corrupt WAL is deleted and the open retried.
- **`enforceQueryLimit` is applied inside `runQueryStream`, not at the route.** `/api/query`, MCP, and
  headless reads inherit the cap without doing anything. Benchmark agent tools
  (`agents/benchmark-analyst/db-tools.ts`, `explore-dataset.ts`) call it themselves before dispatch —
  applying it twice is harmless — and skip it for Mongo, since it is a SQL parser.
- **`meta.rowCount` stays authoritative under bounded reads.** `getCachedResultBounded` returns few rows
  but reports the true total from the cache row / JSONL header, so an agent is told the real size.
- **`forceRefresh` is refused for guests**, so a public share cannot be used to hammer the warehouse.
- **`inlineSqlParams` output (`QueryResult.finalQuery`) is for display only.** The engine received a
  prepared statement; the inlined string can drift on edge cases (backslashes are deliberately left
  as-is because Postgres/DuckDB/SQLite/BigQuery all treat them literally in single-quoted strings).

### Key files

| Task | File |
|---|---|
| Add a connector | `lib/connections/base.ts` + the ten registration points listed above |
| The connector contract, streaming + bounded drains | `lib/connections/base.ts` |
| Connection resolution, secrets, row cap, timeout | `lib/connections/run-query.ts` |
| DuckDB sandboxing / instance reuse | `lib/connections/duckdb-registry.ts` |
| Chunked DuckDB streaming (DuckDB, SQLite, CSV) | `lib/connections/duckdb-stream.ts` |
| `:name` rewrite grammar (all dialects) | `lib/connections/named-to-positional.ts` |
| Column profiling / `ColumnMeta` | `lib/connections/statistics-engine.ts` |
| Cached execution, SWR, lease, degrade paths | `lib/query-cache/execute.server.ts` |
| `query_cache` row access + lease SQL | `lib/query-cache/store.server.ts` |
| Blob read/write, bounded blob decode | `lib/query-cache/blob-store.ts` |
| Wire/at-rest format | `lib/query-cache/jsonl.ts` (pure), `jsonl-stream.server.ts` (Node) |
| Public-share query authorization | `lib/query-cache/guest-query.server.ts` |
| SQL → IR (and the GUI-compat gate) | `lib/sql/sql-to-ir.ts` |
| IR → SQL | `lib/sql/ir-to-sql.ts` |
| None-param semantics | `lib/sql/none-params.ts`, `lib/sql/ir-transforms.ts` |
| Param extraction + value assembly | `lib/sql/sql-params.ts` |
| Row caps | `lib/sql/limit-enforcer.ts` (SQL), `lib/connections/mongo-connector.ts` (Mongo) |
| Table allowlisting | `lib/sql/validate-query-tables.ts`, `lib/sql/whitelist-resolver.server.ts` |
| Whitelist → exposed schema | `lib/sql/schema-filter.ts` |
| Editor autocomplete | `lib/sql/autocomplete.ts`, `lib/sql/mention-completions.ts` |
| Agent-facing Schema Notes / context docs | `lib/sql/context-docs.ts`, `lib/sql/annotation-notes.ts` |

**Why JSONL, and why one codec for both directions.** The connector row-stream is JSONL-encoded exactly once and tee'd — gzip → object store, and → the HTTP response body — so the at-rest format and the wire format *cannot* diverge: a body is a metadata header line (`{columns, types, finalQuery}`, plus `rowCount` when it is already known) followed by one JSON object per row. Errors stay non-200 JSON in the existing envelope rather than riding the stream. Arrow was rejected deliberately: only DuckDB and BigQuery are Arrow-native, so every other connector would need encoding work anyway, and it would cost a client-side `apache-arrow` dependency plus a type-mapping layer. JSONL is trivial to emit from any connector, needs no client dependency, and preserves the `{columns, types, rows}` shape the browser already consumes.

**Row/byte budgets bound reads, never the write.** On a miss, `getCachedResultBounded` still executes and stores the *complete* result through `putStream` and only then reads it back under the budget — bounding the write instead would persist a truncated blob that every later reader is served as if it were complete. Only the degrade path (cache infra down, or a blob that vanished between index read and blob read) drains bounded, and it stores nothing. The same rule is why there is no in-process result map on the server — not even an LRU: peak server RAM on the write path is one chunk, and anything that materializes a whole result server-side to hold onto it is outside the design.

**The execution lease is a row lease, not a Postgres advisory lock, and it is taken only for execution.** Advisory locks are neither pool-safe (the lock follows the connection, not the request) nor available on PGLite, so the claim is a single `INSERT … ON CONFLICT … DO UPDATE … WHERE lease_expires_at < now()` against `query_cache`. Fresh serves and the immediate half of a stale serve take no lease at all — only a miss, an expired entry, a `forceRefresh`, and a background revalidation do; a read never blocks behind a writer. `lease_expires_at` is mandatory rather than an optimization: without a steal-able expiry, a winner that crashes mid-execution hangs every waiter forever. On PGLite (single writer) the whole mechanism is a graceful no-op that costs one cheap round-trip; it earns its keep only on multi-instance Postgres.

**Adding a connector touches three layers and ten enumerated registration points.** Implement the abstract `NodeConnector` (`lib/connections/base.ts`) — `testConnection(includeSchema?)`, `query`/`queryStream`, `getSchema()` — then register the new type string everywhere it is enumerated. The two failure modes are not symmetric: **missing a type union is a TypeScript error that `npm run validate` catches; missing a `switch` arm or map entry is a silent fallthrough to the default branch.**

1. `lib/connections/<newdb>-connector.ts` — the connector itself. Import its driver at the top of the file; inline `await import()` is banned repo-wide.
2. `lib/connections/index.ts` — import, re-export, and add a `getNodeConnector()` branch.
3. `lib/types/connections.ts` — the `DatabaseConnection.type` string-literal union **and** the `connectionTypeToDialect()` map.
4. `lib/data/connections.interface.ts` — `CreateConnectionInput.type` and the update interface.
5. `lib/data/helpers/connections.ts` — a `getSafeConfig` branch.
6. `lib/connections/statistics-engine.ts` — a `profileDatabase()` case.
7. `lib/ui/connection-type-options.ts` — the `CONNECTION_TYPES` entry (and its type union).
8. `components/views/connection-configs/<NewDb>Config.tsx` plus its `index.ts` export.
9. `components/views/ConnectionFormV2.tsx` — every per-type branch: the redaction builder, `isFormValidForTest()`, `handleTypeChange`, `handleTest()`, `handleSaveClick()`, the JSX render block, and the inline union cast.
10. `frontend/package.json` for the driver dependency, and `public/logos/<newdb>.svg`.

`app/api/connections/test/route.ts` needs no change — it dispatches through `getNodeConnector`. Start from the closest existing connector rather than a blank file: server DB with host/port/user/password → `postgres-connector.ts`; cloud warehouse with a JSON key → `bigquery-connector.ts`; AWS service → `athena-connector.ts`; local file engine → `duckdb-`/`sqlite-connector.ts`; document store → `mongo-connector.ts`.

**`getSafeConfig` is required, not optional.** Its default branch returns `{}`, which hides *everything* — the client then receives no config at all and the connection view/edit form silently breaks. Return only non-secret fields, mirroring the postgres branch (host, port, database; never username or password).

**`connectionTypeToDialect` is the one source of truth for a connection's dialect string.** Its fallback is `?? 'duckdb'`, so an omitted entry does not fail — it silently parses the new engine's SQL as DuckDB. That string feeds the SQL↔IR round-trip (None-param resolution, the GUI-compat gate), so it must be a dialect the parser recognizes, and it is not always the connector's own name: Athena maps to `presto`.

**`DEV_ONLY_CONNECTION_TYPES` is only for local file engines.** `validateConnectionType` (`lib/data/helpers/connections.ts`) rejects `duckdb`/`sqlite` outside dev. A real server or warehouse connector must not be added to that list.

**Column classification is substring keyword matching.** `classifyColumn` (`statistics-engine.ts`) lowercases the driver's type string and looks for `bool`, the temporal family (`date`/`timestamp`/`time`/`datetime`/`interval`), `uuid`, the string family (`text`/`varchar`/`character`/`string`/`char`), and the numeric family. An engine whose type names contain none of those keywords falls through to the distinct-ratio heuristics and is classified wrongly — extend the function rather than accepting the default.

---

## Semantic models, contexts, views, and Atlas schemas

Four cooperating modules under `frontend/lib/`: `validation/` (TypeBox schemas — the single source of truth for file content shapes), `context/` (knowledge-base plumbing: whitelists, versions, budgets, the agent's flat view), `views/` (curated SQL exposed as virtual tables), and `semantic/` (business vocabulary compiled to IR). `types/` is a barrel plus domain modules; the semantic and views types are re-exports of TypeBox statics, not hand-written duplicates.

### What each module owns

**`lib/validation/`** owns the shape of Atlas file content. `atlas-schemas.ts` is authored in TypeBox: each `export const X = Type.Object(...)` is simultaneously a runtime JSON Schema and a static type via the colocated `export type X = Static<typeof X>`. `atlas-json-schemas.ts` rebuilds the plain-JSON artifacts at module load (`JSON.parse(JSON.stringify(...))` strips TypeBox's `Symbol(Kind)` metadata so Ajv accepts them) and additionally renders per-file-type schema text for skill prompts (`SCHEMA_TEMPLATE_VARS` → `{schema_question}`, `{schema_context}`, …). `content-validators.ts` compiles four Ajv validators at module load. It does **not** own: viz spec grammars (Vega-Lite/Vega bodies are opaque `Type.Record`s here and validated in `lib/viz/validate.ts`), context content (see gotchas), or form-input validation (`validators.ts` is unrelated workspace-name/email/password helpers).

**`lib/context/`** owns everything about a context *document* except its schema resolution: whitelist merging and legacy-format coercion (`context-utils.ts`), nearest-context lookup, published-version selection, the name whitelist for inherited views/models (`name-whitelist.ts`), the editor's version fold (`version-edit.ts`), the agent's flattened read/write projection (`context-agent-view.ts`), memory bounding of computed schemas (`schema-bounding.ts`), and every prompt/UI char budget (`context-budgets.ts`).
`skill-utils.ts` and `agent-utils.ts` are the naming pair for user-authored skills and custom agents: a
canonical key (`canonicalizeUserSkillName` / `canonicalizeUserAgentName` — lowercase, non-`[a-z0-9_]`
collapsed to `_`), a collision-free variant (`unique*Name`), and a `get*DisplayName` that humanizes the
key for entries predating `displayName`. The key is what prompts, `LoadSkill` and the `custom_agent`
pointer address; the display name is UI-only, so renaming the label can never break a saved
reference. It does **not** own schema *computation* or inheritance — that is `lib/data/loaders/context-loader.ts` + `context-loader-utils.ts`, which import from here.

**`lib/views/`** owns virtual views end to end: SQL→IR→CTE inlining (`resolve.ts`), the dependency/security graph (`integrity.ts`), the context-save gate (`save-gate.server.ts`), and column snapshotting/promotion (`prepare.server.ts`). It does **not** own where views are stored (a `ContextVersion.views` array) or how they reach a child context (the context loader).

**`lib/semantic/`** owns the semantic tier: spec→IR compilation (`compile.ts`), the reverse mapping (`detect.ts`/`detect-sql.ts`), the three validation tiers (`validate.ts` tier 1, `edit-check.ts` tier 2 + the shared EditFile entry point, `save-gate.server.ts` tier 3), scoped serving (`models.server.ts`/`models-client.ts`), and pure editor helpers (`infer-join.ts`, `infer-viz.ts`, `derive.ts`). It generates **no SQL** — only `QueryIR`; dialect correctness lives entirely in `lib/sql/`.

### Architecture

#### Context read path

```
FilesAPI.loadFile(context)
  → context-loader.ts
      computeSchemaFromWhitelist()          (context-loader-utils.ts)
        parent's fullSchema × parent whitelist(childPaths, contextDir) = parentSchema
        parentSchema × own whitelist                                   = fullSchema
        inheritedBy(childPaths) then applyNameWhitelist(...)  → parentViews/fullViews,
                                                                parentSemanticModels/fullSemanticModels
      injectViewsAsTables()   → each view becomes a table under the `_views` schema
      boundFullSchema(fullSchema)  → names-only when > CONTEXT_BUDGETS.contextParentSchemaChars, NEVER drops a table
      boundSchema(parentSchema)    → may additionally cap the table list (it is only the editor menu)
```

Inheritance has two halves, applied in this order at every level: `childPaths` on the view/model (the parent choosing who is offered it) and `viewWhitelist`/`semanticModelWhitelist` on the child version (the child's selection out of that; absent = `'*'` = take everything including future additions). Whatever survives both is what cascades further down. Views the ancestor's own loader disabled (`viewProblems`) are never passed on — that is what makes the security guarantee recursive without a global crawl.

#### Context write path — the two save gates

Every context write (view dialog, raw JSON editor, agent EditFile) lands in `FilesAPI.saveFile` (`lib/data/files.server.ts`), which for `type === 'context'` runs, in order:

```
validateFileStateServer()                       → structural (no-op for contexts)
stampAndValidateViews()      views/save-gate    → recompute reads, boundary, integrity, cycles
validateSemanticModelsGate() semantic/save-gate → tiers 1–3, stamp `verified`
```

The two gates are mutually dependent by design: `views/save-gate.server.ts` imports `semanticModelNames` from `semantic/save-gate.server.ts`, and the semantic gate imports `resolveViewsInSql` from `views/resolve.ts`. Views and semantic models share **one** name namespace (a semantic reference addresses a view by bare name), enforced from both directions.

Errors cross the boundary differently and that is a contract: `ViewSaveError` is one `;`-joined message; `SemanticModelSaveError.issues` is `\n`-joined so `SemanticModelsEditor` can attribute each issue to the model/metric row that caused it.

#### Semantic compile

```
SemanticQuerySpec + SemanticModelV2
  → validateSemanticQuery()   (names resolve; ≤1 grouped m2m reference)
  → compileSemanticQuery()    → QueryIR
  → irToSqlLocal(ir, dialect) → SQL          (lib/sql)
  → resolveViewsInSql()       → SQL with `_views.*` inlined as CTEs
```

Compilation rules: `FROM` is `model.primary` (a table, or a data model addressed as `_views.<name>`); aggregation metrics become aggregate select columns aliased by `semanticAlias(name)`; ratio metrics become a raw `num * 1.0 / NULLIF(den, 0)`; SQL metrics pass through `rewriteMetricSql`, which rewrites only the `primary.` qualifier (reference aliases already *are* the compiled join aliases). Every used to-one reference contributes a `JoinClause` — including metric-only joins, discovered by lexing the metric SQL. `timeGrain` `DATE_TRUNC`s `spec.timeColumn` or the model's first primary temporal dimension. ORDER BY is time ASC when present, else first metric DESC; `limit` defaults to 1000.

Many-to-many compiles grain-preservingly and never through a plain join: a **grouped** m2m reference becomes a `SELECT DISTINCT` dedup-bridge CTE named `_m2m_<alias>` joined on every primary-key column (`_pk0.._pkN`), while a **filter-only** m2m becomes a correlated `EXISTS` / `NOT EXISTS`. Bridge and far sources are always aliased `_b`/`_f` inside the subquery — without that, a bridge that *is* the primary table makes the correlation a tautology that matches every row. Filters on an m2m alias never become outer conditions; a grouped alias filters inside its CTE (an outer condition would widen the CTE's `DISTINCT` grain and double-count).

#### Detection (the reverse)

`semanticSpecFromIr(ir, models)` recovers a spec from parsed IR, then **recompiles it and compares**: `irEquivalent` canonicalizes select/group/join/filter alias-insensitively and order-insensitively. If the recompile does not reproduce the input, the result is discarded. Detection therefore yields false negatives, never false positives. `detect.ts` is pure (safe for client bundles); `detect-sql.ts` adds the WASM parser and is server/test-only — the browser calls `CompletionsAPI.sqlToIR` and then the pure detector (`lib/hooks/use-semantic-compat.ts`).

#### View resolution at query time

`app/api/query/route.ts` calls `mentionsViews(query)`; if false the SQL is returned **byte-identical** and never parsed (existing queries keep their exact text, cache keys, and any exotic SQL the parser cannot handle). Otherwise `getViewsForPath` resolves the nearest context, and `resolveViewsInSql` does a depth-first walk of the `reads.views` graph (cycles and unknown views are hard errors), emits one CTE per view in topological order, and rewrites `_views.x` table refs — including inside the user's own CTE bodies, whose SQL the IR stores raw. A view's `whitelistedColumns` is enforced by **projection**: the body is wrapped so a deselected column ceases to exist; an explicit empty list renders a `WHERE 1 = 0` stub relation.

### Interactions with other areas

| Boundary | Direction | Contract |
|---|---|---|
| `lib/data/files.server.ts` | calls in | `saveFile` runs both gates on every context write and converts gate errors to `UserFacingError`; `batchSaveFiles` routes through it, so it inherits them. `createFile` does not (see gotchas). |
| `lib/data/loaders/context-loader*.ts` | calls in | Uses `context-utils` (published version, skill merge), `name-whitelist`, `schema-bounding`, and `views/integrity` (`checkViewAvailability` at LOAD fails **open**; the gate passes `strictUnknownSchema` to fail **closed**). |
| `app/api/query/route.ts` | calls in | `mentionsViews` → `getViewsForPath` → `resolveViewsInSql` before execution. Guests reach this only by file id (`lib/query-cache/guest-query.server.ts`), never with raw SQL. |
| `app/api/semantic-models/route.ts` | calls in | One POST endpoint, four modes keyed by body shape: `testModel` (gate tiers 1–3, no save), `sql` (server-side detection), `q` (field search), else `tables` (scoped models; `[]` = unscoped, capped at 32 tables). |
| `lib/tools/handlers/edit-file.ts` | calls in | Agent EditFile on a context: `foldContextAgentView` → `changedSemanticModelIssues(next, saved)`; a non-empty result **rejects the edit wholesale** with per-issue feedback. `contextEditWithinBounds` is the safety net that a fold touched nothing else. |
| `lib/file-state/file-edit.ts` | calls in | Same check with `saved: undefined` — advisory, every model, never blocking. |
| `components/query-builder/SemanticExplorer.tsx` | calls in | `compileSemanticQuery` → `irToSqlLocal` in the browser; emits `(spec, sql, viz)` where the viz default comes from `infer-viz.ts` while `vizSettings.typeLocked` is falsy. |
| `components/context/SemanticModelsEditor.tsx` | calls in | The only consumer of `derive.ts` (draft pre-fill) and `infer-join.ts` (proposed join columns); runs `edit-check` locally and `models-client.testSemanticModel` for the Test button. |
| `agents/benchmark-analyst/db-tools.server.ts` | calls in | Headless mirror of the production path: `compileSemanticQuery` → `irToSqlLocal` → `resolveViewsInSql` → the real query executor. |
| `lib/sql/` | calls out | `sql-to-ir` / `ir-to-sql` / `ir-types` are the only dialect-aware layer; `schema-filter.ts` owns `applyWhitelistToConnections`. |
| `lib/connections/run-query.ts` | calls out | Tier-3 probes and view column snapshots execute through it (`SELECT * FROM (…) LIMIT 0`). |
| `orchestrator/prompts/prompts.yaml` | consumes | `skill_semantic_models` teaches the authoring format; `SCHEMA_TEMPLATE_VARS` injects the live content schemas so the prompt cannot drift from validation. |

### Gotchas

- **`verified` is server-managed.** `withPreservedStamps` destructures any client-sent `verified` away unconditionally. Tier 3 then behaves three ways: a clean probe stamps `true`; an error matching `INFRA_ERROR` (timeout/ECONNREFUSED/fetch failed/…) fails **open** — the save proceeds with `verified: false` and `probeScope` keeps that metric in every future probe set until it goes green; any other engine error **blocks** the save. A down warehouse must never make models uneditable.
- **Probe scope is a three-case diff.** Structural change (anything outside metric text and descriptions) → probe all metrics; metric-text-only → probe added/changed metrics (a pure deletion probes nothing); metadata-only → probe nothing. A ratio metric's "essence" resolves its aggregation metrics rather than naming them, so editing `Revenue` re-probes every ratio built on it. Comparison uses `sortedJson` (recursively key-sorted) because JSONB does not preserve key order and the agent's markup round-trip reorders keys.
- **A names-only schema makes every column look missing.** `boundFullSchema` strips columns from large schemas, and `content.fullSchema` reaching the browser is the bounded copy. `findTableFields` then returns an empty field map and tier 1 reports `column "x" is not an exposed field` for a perfectly good model (verified by running it). The guard is `fieldChecksTrustworthy` in `edit-check.ts`: when the client-side menu is bounded or absent, the EditFile path degrades to tier 2 only. The save gate is unaffected — it recomputes an unbounded schema from the whitelist.
- **Tier 1 opens with a shape gate.** `validateSemanticModel` runs TypeBox `Errors()` first (max 10, prefixed `malformed model — fix its shape first`) and returns immediately, because every rule below dereferences `primary`/`dimensions`/`references[].on` unguarded. Without it an LLM-authored model missing a field is a raw `TypeError` → HTTP 500 with no issue list.
- **The gates are on the update path only.** `FilesAPI.createFile` runs `validateFileState` and nothing else. In practice contexts are created empty (`makeDefaultContextContent`, fired automatically for every new folder), so there is normally nothing to gate — but a direct `POST /api/files` with `type: 'context'` and pre-populated `views`/`semanticModels` reaches the DB ungated. The next save through any path re-gates the whole document.
- **Context content is not Ajv-validated.** `validators` covers question/dashboard/story/notebook only; `validateFileState` handles config and connection by hand and returns `null` for everything else. Contexts are guarded by the two save gates instead.
- **`atlasSchema.$defs.ContextContent` is `ContextAgentContent`**, the agent's *flattened* view (live version's docs/metrics/annotations/semanticModels + content-level skills/evals) — not the stored version-based `ContextContent` in `lib/types/context.ts`. It exists in `$defs` for markup `$ref` resolution and the `schema_context` skill var, and is deliberately absent from the validation `oneOf`. The whitelist is absent from the agent's view entirely: any whitelist change fails `contextEditWithinBounds`.
- **m2m grain is enforced, not assumed.** `through.primaryOn` must join the primary on exactly `model.primaryKey` — same columns, same order — because the compiler keys the bridge join off `primaryOn`; a mismatch would silently compile at a different grain. `primaryKey` is required as soon as any reference is `many_to_many`.
- **Reserved names.** Reference aliases may not be `primary`, `_grain`, `_views`, `_probe`, or start with `_m2m_`. `semanticAlias` appends `_` to slugs on a BigQuery-superset reserved-word list, so a metric named "Rows" cannot emit `AS rows`.
- **Metric SQL is lexed, not parsed.** Every column reference must be qualified (`primary.x` / `<alias>.x`); bare identifiers, quoted identifiers, and references to an m2m alias are all tier-1 errors. The lexer is comment/string-aware, so parens and refs inside literals do not count — deliberately not the polyglot parser, which returns opaque `raw` columns for compound aggregates.
- **`mentionsViews` is a substring gate, not a parse.** `SELECT '_views.x'` trips it and takes the parse path needlessly; it can never miss a genuine reference.
- **Views must be re-checked on inheritance, not just at save.** A parent narrowing its whitelist later DISABLES the dependent child view with a reason (`viewProblems`) rather than silently escalating it; `resolveViewsForContext` filters disabled views out so the query fails loudly.
- **`lib/context/dashboard-publish-highlights.tsx`** is a React `createContext` for dashboard publish highlighting — unrelated to knowledge-base contexts, sharing only the directory name.

### Key files

| Task | File |
|---|---|
| Add/change a file content field | `lib/validation/atlas-schemas.ts` (everything else re-derives on next module load) |
| Change what the LLM is told a file's content looks like | `lib/validation/atlas-json-schemas.ts` (`stripVizDeep`, `SCHEMA_TEMPLATE_VARS`) |
| Debug a "Invalid file content" save error | `lib/validation/content-validators.ts` (`formatErrors`, cross-field checks) |
| Understand spec → SQL | `lib/semantic/compile.ts` |
| Understand SQL → spec ("why isn't the Semantic tab lighting up?") | `lib/semantic/detect.ts` (recompile-and-compare gate) |
| Add a model authoring rule | `lib/semantic/validate.ts` (tier 1) or `lib/semantic/edit-check.ts` (tier 2 + EditFile entry) |
| Change what blocks a context save | `lib/semantic/save-gate.server.ts`, `lib/views/save-gate.server.ts` |
| Change how a view becomes SQL | `lib/views/resolve.ts` |
| Change the view security boundary | `lib/views/integrity.ts` (`computeViewReads`, `checkViewAvailability`) |
| Change what the agent sees/edits on a context | `lib/context/context-agent-view.ts` |
| Change inheritance selection | `lib/context/name-whitelist.ts`, `lib/types/context.ts` (`NameWhitelist`) |
| Tune prompt/schema size | `lib/context/context-budgets.ts`, `lib/context/schema-bounding.ts` |
| Find a domain type | `lib/types.ts` (barrel) → `lib/types/{context,views,semantic}.ts` |

**The tier-3 probe always carries a `GROUP BY`, and that is the entire aggregate-checking strategy.** With a grouping present, a non-aggregate metric expression is rejected by the engine's own GROUP BY validation — so there is no tier-1 aggregate-token whitelist to maintain, and dialect-specific aggregates (`MEDIAN`, `APPROX_COUNT_DISTINCT`, …) work without ever being listed. `probeSpec` (`lib/semantic/edit-check.ts`) supplies the model's first **non-m2m-sourced** dimension; an m2m probe dimension would drag a bridge CTE into a probe that only needs to validate one metric. When the model exposes no usable dimension, `runProbe` injects the grouping post-compile: the first exposed primary column, and as a last resort a constant (`SELECT 1 AS _probe_dim … GROUP BY 1`) for a view whose columns have not been snapshotted yet. Dropping the grouping in that last case would let a non-aggregate metric be stamped `verified` and fail at query time instead.

Probes for one save run through a worker pool of `PROBE_CONCURRENCY = 4` (`lib/semantic/save-gate.server.ts`), each bounded by the normal query timeout. A timeout or connector error is classified per metric against `INFRA_ERROR` and the remaining probes keep going, so one slow metric never aborts the rest and the save response aggregates every per-metric outcome.

A filter-only m2m compiles to a **correlated** `EXISTS`, not `pk IN (SELECT …)`, for two reasons: `IN` cannot carry multiple columns on BigQuery, so a composite primary key has no uncorrelated form, and `NOT EXISTS` is NULL-safe where `NOT IN` is not. Negation rides on the outside — a negated filter renders its operator **positively** inside the subquery (`!=` becomes `=`) and flips `EXISTS` to `NOT EXISTS`, so `!=` means *has no related row matching the positive condition*; `IS NULL` / `IS NOT NULL` on an m2m dimension mean has-no-related-row / has-one and emit no far-table predicate at all. Join type for a grouped m2m follows the same logic: an alias carrying filters joins `INNER` (the filter restricts the primary set, matching filter-only semi-join semantics), an unfiltered alias joins `LEFT` so unmatched primary rows appear once under a `NULL` dimension group rather than silently vanishing.

#### The agent's surface

Agents reach the semantic tier through one tool, `RunSemanticQuery` (defined in `agents/benchmark-analyst/db-tools.server.ts`, re-exported by `agents/analyst/analyst-agent.ts` and advertised alongside `ExecuteQuery`). It takes a model name plus metrics, dimensions, filters, `timeGrain`/`timeColumn` and `limit` — never SQL, never a join — so an invalid join is unwritable by construction. It resolves models from the nearest context for the user's home folder (the same anchor chat uses), re-runs `validateSemanticQuery` against the *stored* model on **every** call so issues come back as structured tool errors the agent fixes in-loop, then compiles, inlines `_views.*` and executes through the same path as `ExecuteQuery`, returning that payload shape with `finalQuery` set to the compiled SQL. An unknown model name returns the list of available model names rather than a bare error.

Authored models are additionally projected into free-SQL prompt context as compact **unvalidated reference documentation** — primary source, references with their join columns, dimensions, and metric definitions (`semanticModelToNote` in `lib/sql/context-docs.ts`, reaching agents via `formatContextDocsSection`). Nothing there is validated or executed; it improves raw-SQL answers as soon as models exist, independently of whether anyone runs a semantic query.

- **Connection consistency is checked at save, not discovered at runtime.** The primary and every reference source — tables and data models alike, including an m2m bridge source — must resolve on the model's single `connection`; cross-connection joins cannot compile at all, so tier 1 rejects a mismatch with a pointing error (`lib/semantic/validate.ts`) instead of letting it surface as a confusing engine failure in tier 3. In the editor the connection is implied by the per-database section, so this is mainly a server-side backstop for hand- and agent-authored model JSON.

The three levels stay acyclic by construction rather than by a cycle check: `SemanticSource` is `{kind:'table'}` or `{kind:'model', view}` and nothing else. Data models reference tables and other data models; semantic models reference tables and data models; **nothing can reference a semantic model.** That is why the semantic tier needs no dependency graph of its own while `lib/views/` does.

---

## Storage & Data Layer

The DOCUMENT plane: the `files` table and its siblings, the schema declared as data, the
PGLite/Postgres adapters, migrations, the data-version gate, secrets and the object store. Distinct
from the analytics plane (`frontend/lib/connections/`), which never touches these tables.

→ **`frontend/lib/database/CLAUDE.md`** for the schema declaration, the migration and gate rules,
and the storage gotchas.

## Client State: Redux store, file-state, hooks, navigation

Four directories own everything the browser knows: `frontend/store/` (the Redux store, its slices and two listener middlewares), `frontend/lib/file-state/` (the only place file and query I/O logic lives), `frontend/lib/hooks/` (the React surface over both), and `frontend/lib/navigation/` (route params, the unsaved-changes guard, and the navigation-churn deferral queue).

### What each module owns

**`store/`** owns the shape of client state and the *reactions* to it. `store/store.ts` composes ten reducers (`auth`, `ui`, `files`, `queryResults`, `configs`, `chat`, `recordings`, `jobRuns`, `navigation`, `users`) plus three middlewares — `navigationListenerMiddleware` and `chatListenerMiddleware` prepended, `analyticsMiddleware` (`lib/analytics/middleware.ts`) concatenated. It exports a per-request store on the server and a module singleton in the browser; `getStore()` is the non-React accessor that `lib/file-state/*` and tool handlers use.

It does **not** own network calls. No slice fetches anything: every reducer is a pure state transition, and all I/O lives in `lib/file-state/`, `lib/data/*`, or the two listeners.

- `filesSlice.ts` — the file cache and the change-tracking model (`content` / `persistableChanges` / `ephemeralChanges` / `metadataChanges`, plus `pathIndex` path→id). It also holds dirty-file classification (`selectDirtyFiles`, `selectSaveClassification`) and a path→context resolver (`selectContextFromPath`).
- `queryResultsSlice.ts` — query results keyed by `getQueryHash(query, params, database)` (`lib/utils/query-hash.ts`), capped at `MAX_CACHED_RESULTS = 256` with newest-first LRU eviction.
- `chatSlice.ts` — one `Conversation` record per id: messages, `pending_tool_calls`, ephemeral streaming buffers, the queued-message list, fork links, and the `remoteSession` flag.
- `chatListener.ts` — the engine of chat: it runs v3 turns, executes frontend-bridged tools, observes remote agent sessions, flushes the message queue, and re-renders from the durable log.
- `uiSlice.ts` — everything view-local and mostly localStorage-mirrored (sidebars, colour mode, dev mode, per-file edit/view mode, the question view stack, chat attachments).
- `appStateSelector.ts` — derives the `AppState` blob sent to the LLM from `navigation` + `files` + `queryResults` + `ui.viewStack`. It exists as its own file purely to break the cycle `navigationSlice → file-state → store → navigationSlice`.
- `conversation-log-cache.ts`, `conversation-stream-client.ts`, `tool-watchdog.ts`, `api-url.ts`, `id-generator.ts`, `color-mode-override.ts` — transport and plumbing described below.

**`lib/file-state/`** owns every file and query operation in the browser. `file-state.ts` is a pure barrel; the implementation is split by verb: `file-read.ts` (`loadFiles`, `loadFileByPath`, `readFiles`, `readFilesByCriteria`, `readFolder`), `file-edit.ts` (`editFile`, `editFileStr`, `replaceFileState`, `applyJsonContentEdit`, `applyStoryHtmlEdit`, `buildCurrentFileStr`), `file-publish.ts` (`publishFile`, `publishAll`), `file-mutations.ts` (delete/move/reload/discard/draft-create/duplicate/dry-run/create-folder), `query-results.ts` (`getQueryResult`), `notebook-results.ts` (per-cell result capture and rehydration), `shared.ts` (`hashString`, `deepMerge`, `generateDiff`, `PromiseManager`).

It does **not** own the HTTP layer — every call goes through `FilesAPI` (`lib/data/files.ts`) or a bare `fetch` to `/api/query`; it does not own augmentation (`selectAugmentedFiles` in `lib/store/file-selectors.ts` is a pure Redux selector); and it does not own permissions beyond the client-side display filter in `readFolder`.

`file-state.server.ts` is the server twin (`readFilesServer`, `getAppStateServer`) for tool handlers and cron jobs: it reads through `FilesAPI` from `lib/data/files.server.ts`, takes an explicit `EffectiveUser`, and touches no Redux. `file-state-interface.ts` holds the option/result types both sides share.

**`lib/hooks/`** owns the React surface. `file-state-hooks.ts` is the CORE set (`useFile`, `useFilesByCriteria`, `useFileByPath`, `useFolder`, `useQueryResult`, `useAppState`, `useDirtyFiles`, `useSaveDecision`). Every one is the same two-part shape: an effect that calls the imperative `lib/file-state` function, plus a `useAppSelector` with a custom equality function so it re-renders only on a real change. Domain hooks (`useConnections`, `useContext`, `useContexts`, `useConversation`, `useConversationsList`, `useConfigs`, `useUsers`, `job-runs-hooks`) compose those or their own `lib/data` clients; the leaf utilities (`use-deep-stable`, `use-stable-callback`, `use-table-columns`, `use-story-preview-css`, `use-semantic-*`, `use-spreadsheet-result`, `useScreenshot`) are render-identity and lazy-fetch helpers with no Redux writes.

**`lib/navigation/`** owns URL-parameter preservation (`url-utils.ts`: `as_user`, `mode`, `view` — defaults `org`/`full` are deliberately not written back into URLs), the patched router (`use-navigation.ts`), the unsaved-changes/agent-running interception (`NavigationGuardProvider.tsx`), and the navigation-churn queue (`nav-progress.ts`). It does **not** own route→data loading; that is `store/navigationListener.ts`.

### Architecture

**Read path.**

```
component → useFile(id) ──effect──▶ loadFiles([id], ttl, skip)
                │                        │
                │                        ├ filter: id > 0, not fresh, not skipped
                │                        ├ PromiseManager dedupe (key = sorted ids)
                │                        ├ FilesAPI.loadFiles → dispatch setFiles
                │                        └ post-pass: missing ids → setLoadError NOT_FOUND
                └──selector──▶ selectAugmentedFiles(state, [id])
                                 = { fileState, references, queryResults }
```

`loadFiles` never throws; every failure lands in `file.loadError`. `readFiles` layers optional query execution on top (`runQueries: true`): for the root file and each already-`buildEffectiveReference`'d reference it resolves an execution via `getQuestionExecution` and calls `getQueryResult`, all under `Promise.allSettled` so one broken query can't fail the read.

**Write path.** Edits are staged in Redux and only persisted by an explicit publish.

```
editFile / editFileStr / applyJsonContentEdit
      ↓ setEdit (merge) | setFullContent (replace, sets contentReplaced)
  files[id].persistableChanges          ← selectIsDirty / selectDirtyFiles see this
      ↓ publishFile(id)  or  publishAll([ids])
  persistableContentOf(file) → FilesAPI.saveFile / batchSaveFiles (expectedVersion)
      ↓ setFile(updatedFile) + clearEdits + clearMetadataEdits
```

`publishAll` expands the requested ids to include their dirty references (via `extractReferencesFromContent`), sends one batch, then resolves any per-file `conflicts` by re-running `publishFile` on each — which is where the 409 overlay logic lives (take the server's `name`/`path`, overlay only the local `persistableChanges` on the server's content, retry at the server's version). `store/__tests__/staleSaveBugE2E.test.ts` pins this whole chain.

**Query path.**

```
useQueryResult(query, params, db)
  → noneifyEmptyNumericParams (ONCE, so effect key == selector key)
  → getQueryResult(...)
      1. selectIsQueryFresh? → return cached data, or re-throw a cached error
      2. queryPromiseManager.execute(queryHash, …)   ← dedupe
      3. dispatch setQueryLoading  (BEFORE the semaphore, so queued cards show "loading")
      4. querySemaphore.run(…)     ← limit is a getter reading selectMaxConcurrentQueries
      5. fetch /api/query, AbortController = timeout ⊕ caller's signal
      6. decodeJsonl(body) + X-Cached-At → runOrDefer(dispatch setQueryResult)
```

**Chat path.** `chatListener.ts` is the only driver.

```
dispatch(createConversation | sendMessage | retryConversationTurn | editAndForkMessage)
   → emitSyntheticSkillLoads → runV3TurnInListener
        → runV3Turn (conversation-stream-client.ts): POST /turns, then XHR GET /stream?since=
             deltas → addStreamingMessage; committed rows → live tool rows; pending → derived below
        → loadConversationDetail (incremental ?since, view = dev-mode ? 'full' : 'display')
        → parsePiConversation → dispatch loadConversation (durable log is the truth)
        → status 'paused' → updateConversation({ pending_tool_calls })
                              ↓
          matcher(updateConversation | setUserInputResult) listener
                → executeToolCall (lib/tools/tool-handlers) under withToolWatchdog
                → completeToolCall
                              ↓
          completeToolCall listener: all results in? → runV3TurnInListener({ completedToolCalls })
```

`observeConversation` is the same stream read with no POST — used while a Remote Agent Session drives the conversation externally; `renderFromDurableLog` re-renders on a 150 ms debounced, strictly-chained promise so reloads never interleave with the `pending` dispatches that must follow them.

**Navigation.** `LayoutWrapper` dispatches `setNavigation`; `navigationListener.ts` maps `/f/{id}` → `readFiles([id])` and `/p/{path}` → `readFolder(path)`; `appStateSelector.ts` recomputes `AppState` from the same Redux state. Independently, `useRouter().push/replace` calls `beginNavigation()`, and `LayoutWrapper`'s pathname effect calls `endNavigation()` to flush whatever `runOrDefer` queued.

### Interactions with other areas

| Boundary | Direction | Contract |
|---|---|---|
| `components/containers/*` (15 files), `components/file-browser/*`, `components/modals/*` | → us | Containers are the only components allowed to touch Redux; views take props. Enforced for 10 named view files by `RESTRICT_VIEW_REDUX` in `frontend/eslint.config.mjs`. |
| `lib/tools/handlers/*` | → us | Frontend-bridged tools call `getStore()` and the `file-state` verbs directly (`edit-file.ts`, `create-file.ts`, `publish-all.ts`, `file-review.ts`, …). `chatListener` imports `tool-handlers` **dynamically** to break the cycle `tool-handlers → store → chatListener → tool-handlers`; it carries an explicit `eslint-disable-next-line no-restricted-syntax` because inline imports are otherwise banned repo-wide. |
| `lib/data/files.ts` (`FilesAPI`) | us → | Sole HTTP surface for file CRUD. `file-state` adds Redux + caching on top; nothing here calls `/api/files` by hand. `ConflictError.currentFile` is the 409 payload the publish path depends on. |
| `app/api/query` | us → | `getQueryResult` posts `{ query, connection_name, parameters, parameterTypes?, filePath?, fileId?, fileVersion?, cachePolicy?, forceRefresh? }` and reads a JSONL body plus the `X-Cached-At` header. |
| `lib/store/file-selectors.ts` | us → | `selectAugmentedFiles` / `selectAugmentedFolder` / `selectFilesByCriteria` / `selectFileByPath` live outside this area but are the augmentation layer both `file-read.ts` and `appStateSelector.ts` build on. |
| `lib/chat/compress-augmented.ts` | us → | `filesSlice` imports `dbFileToFileState` (the DbFile→FileState constructor, which deep-sorts content keys); `appStateSelector` imports `compressAugmentedFile` + `APP_STATE_LIMIT_CHARS`. Client and server read paths must produce identical compressed output — `store/__tests__/file-state-server-parity.test.ts` asserts it. |
| `lib/data/helpers/param-resolution.ts` + `lib/sql/sql-params.ts` | us → | `getRootParams` / `buildQueryParamValues` / `noneifyEmptyNumericParams` produce the *canonical* param map. Cache key, augmentation lookup key and `fileState.queryResultId` must all be derived from the same map. |
| `store/configsSlice` ← SSR `preloadedState` | env → us | `MAX_CONCURRENT_QUERIES` and `QUERY_TIMEOUT_MS` reach `querySemaphore` and the fetch timeout through Redux, read live on each acquire. |
| `lib/analytics/middleware.ts` | us → | Subscribed to every dispatched action; adding an action means it may become an analytics event. |
| `orchestrator/` + `agents/` | via HTTP | The listener never imports the orchestrator. Its only contract is the v3 route pair (`POST /api/conversations/[id]/turns`, `GET …/stream`) plus `/interrupt`, `/fork`, `/api/chat/log-error`. |
| `lib/navigation/nav-progress.ts` | us ↔ components | `runOrDefer` is called from `query-results.ts` and `components/containers/SmartEmbeddedQuestionContainer.tsx`; `endNavigation` only from `components/app-shell/LayoutWrapper.tsx`. |

### Gotchas

- **A same-version refetch preserves unsaved edits.** `fileStateFromServer` (`filesSlice.ts`) keeps `persistableChanges`/`ephemeralChanges`/`metadataChanges` unless the incoming `version` is strictly greater, or `overwriteEdits: true` is passed. Only `reloadFile` passes it. Without this an agent's staged dashboard edit was wiped by the very next `readFiles`; `store/__tests__/refetch-preserves-edits.test.ts` guards both directions.
- **`contentReplaced` changes save semantics.** `setFullContent` makes `persistableChanges` the *entire* content and flags the file, so `persistableContentOf` returns it verbatim instead of merging — that is the only way a key deletion survives a save. Later `setEdit` merges preserve the invariant (merging onto full content is still full content).
- **Two keys must never deep-merge.** `editFile` special-cases `viz` (the Viz V2 envelope is written whole; a merge resurrects deleted encoding channels), and `cellResults` goes through `setNotebookCellResults` with replace semantics (a partial map would drop already-saved cells, and a merge cannot delete one).
- **Negative ids are never sent to the server.** `pathToPlaceholderId` (`file-read.ts`) and `pathToVirtualId` (`filesSlice.ts`) are duplicate djb2 implementations that must stay in agreement; `loadFiles` filters out `id < 0`, and `reloadFile` refuses them. There are no client-created "virtual files" any more — `createDraftFile` gets a real positive id from the server immediately, with `draft: true` hiding it from folder listings until first save.
- **A cached error is "fresh".** `selectIsQueryFresh` deliberately treats an error as fresh within the TTL, and `getQueryResult` re-throws it without re-fetching. Removing that turns a failing query into an infinite retry loop on every render.
- **`MAX_CACHED_RESULTS = 256` is a correctness constant, not a memory knob.** Drop it below the largest dashboard's question count and each re-render evicts the earliest results, cascading into duplicate `/api/query` round-trips.
- **`CACHE_TTL.FILE/FOLDER/QUERY` are all ten hours** (`lib/constants/cache.ts`). The `120000` default on `selectIsQueryFresh` is the selector's own fallback and is not what callers pass.
- **Query concurrency is capped and time-boxed.** `querySemaphore`'s limit is a *getter* over `selectMaxConcurrentQueries`, so a runtime config change applies without recreating it (`lib/file-state/__tests__/query-concurrency-cap.test.ts`). Each fetch races an internal timeout against the caller's optional `signal`; an abort is normalised into "Query timed out after Ns" or "Query cancelled" so the UI and the agent never see a bare `DOMException`. Only timeouts and network/5xx failures are reported via `captureError`; 4xx SQL errors and user cancellations are not.
- **`forceLoad` must reach the server.** `getQueryResult({…}, { forceLoad: true })` both skips the client cache and sets `forceRefresh: true` in the request body; a normal load must not (`query-force-refresh.test.ts`).
- **Redux writes during navigation are deferred.** `setQueryResult`/`setQueryError` go through `runOrDefer`, because urgent updates preempt and restart Next's low-priority navigation transition — clicking a dashboard tile while queries streamed felt dead. `beginNavigation` arms a 5 s safety timer so deferred work is never stranded if a navigation is cancelled.
- **`editFileStr` replaces ALL occurrences by default.** `replaceAll` defaults to `true`; passing `false` turns a non-unique `oldMatch` into an error. The edit surface is MARKUP (`fileToMarkup`/`markupToContent`), not JSON, and the `id`/`name`/`path` wrapper is not part of it. A parse failure is the only hard error — schema and story-param problems come back as non-blocking `validation` strings, and Publish is the real gate. There is a deliberate *truthful no-op guard*: if the replacement changed the string but produced identical content, it returns `success: false` so the agent retries instead of believing a phantom edit.
- **The echoed diff is canonical, not the agent's text.** `editFileStr` diffs against the markup re-derived from Redux after staging, so the agent's next `oldMatch` (built from memory of its own `newMatch`) matches what is actually stored. `generateDiff` uses a Myers shortest-edit-script over lines, not a positional compare — a positional cascade turned one-line story edits into 100 KB payloads that compounded every turn (`lib/file-state/__tests__/generate-diff.test.ts`).
- **`selectDirtyFiles` excludes only `connection`, `config`, `styles`.** That set is narrower than `SYSTEM_FILE_TYPES` in `lib/ui/file-metadata.ts`, which also lists `context` — so context files *do* appear dirty and *are* published by `publishAll`.
- **Tool execution is guarded three ways.** `inFlightToolCalls` is populated synchronously before any `await`, so a re-fired listener cannot double-execute (`store/__tests__/chat-listener-inflight.test.ts`); calls are grouped by `arguments.fileId` — same file serial, different files parallel; and each is raced against `withToolWatchdog` at 6 minutes, which does *not* cancel the underlying work but swallows a late settlement so `completeToolCall` fires exactly once.
- **Chat tests do not stream.** `runV3TurnInListener` branches on `IS_TEST`: jsdom has no usable XHR/SSE, so it POSTs the turn and polls `ConversationsAPI.get` up to 600×10 ms until `runStatus !== 'running'`. The remote-session observer returns immediately under `IS_TEST`. Node tests drive `updateConversation` directly.
- **The message queue lives only in the live store.** `loadConversation` re-reads `queuedMessages` from the existing conversation and ignores the snapshot in its payload — turn-finalize dispatches carry a conversation captured at turn *start*, which would otherwise wipe anything queued mid-turn or resurrect flushed messages.
- **Both sidebars start collapsed, and only the restore pass opens them.** `uiSlice`'s initial
  `leftSidebarCollapsed` is `true` — not the user's preference — because SSR has no localStorage and any
  other default flashes the wrong chrome on hydration. `components/app-shell/DataLoader.tsx` reads the
  stored flags after mount and folds them into the same single `setBulkUiFlags` dispatch as `devMode`,
  so restoring N flags costs one re-render, and a key that is absent (not `'true'`/`'false'`) leaves the
  reducer default alone rather than writing `false`.
- **Opening the right sidebar overwrites the remembered left-sidebar preference.**
  `setRightSidebarCollapsed(false)` force-collapses the left sidebar *and persists that*, so the two are
  not independent memories: reopening the chat panel is a durable write to `leftSidebarCollapsed`.
  `persistBooleanPreference` swallows its own throw, because localStorage is unavailable in
  private/locked-down browsers and a preference write must never break a toggle.
- **Dev mode changes the wire format.** `viewFor(state)` selects `'full'` vs `'display'`; toggling it invalidates the whole conversation-log cache, because slim and full entries must never mix in one log, and re-renders settled conversations so the inspector has data without a reload. The listener watches both `setDevMode` and `setBulkUiFlags` (localStorage restore at boot races the page-level fetch).
- **Incremental conversation loads have two guards.** `loadConversationDetail` only accepts a `?since` response when the returned seqs are contiguous with the cached prefix *and* the merged length matches the server's `maxSeq` — the second guard catches a truncate-and-replay retry that removed rows the client still holds. An errored turn skips the incremental path entirely.
- **Sanctioned module-level state.** `chatListener.ts` (`abortControllers`, `observingConversations`, `inFlightToolCalls`), `conversation-log-cache.ts` (`cache`), and `use-story-preview-css.ts` (`cache`) each carry an explicit `eslint-disable-next-line no-restricted-syntax` with a reason: they are per-browser-tab, never server-side, so there is no cross-request leakage.
- **`selectSaveClassification` uses `weakMapMemoize`.** Reselect's default LRU size is 1, which thrashes when several components call it with different `fileId`s and returns a fresh object each time — React-Redux then warns and re-renders needlessly.
- **`useAppStore` is not `useAppSelector`.** `store/hooks.ts` exports it for reading state inside callbacks without subscribing — use it for values only needed at click/submit time (`queryResultsMap`, colour mode at send) so an unrelated slice update doesn't tear through the parent.
- **`withColorModeOverride`** (`store/color-mode-override.ts`) proxies only `getState`, memoised per underlying state reference; `dispatch`/`subscribe` pass through. It is how a story declaring `colorMode: "light"` themes its embedded charts inside a dark app without any chart component learning about it.

### Key files

| Task | File |
|---|---|
| Add/change a file operation | `frontend/lib/file-state/file-read.ts` · `file-edit.ts` · `file-publish.ts` · `file-mutations.ts` (re-export via `file-state.ts`) |
| Change how queries execute or cache client-side | `frontend/lib/file-state/query-results.ts` + `frontend/store/queryResultsSlice.ts` |
| Change the dirty/save model | `frontend/store/filesSlice.ts` (`fileStateFromServer`, `persistableContentOf`, `selectDirtyFiles`, `selectSaveClassification`) |
| Add a React hook over files/queries | `frontend/lib/hooks/file-state-hooks.ts` |
| Change chat turn orchestration in the browser | `frontend/store/chatListener.ts` |
| Change the SSE/turn transport | `frontend/store/conversation-stream-client.ts` · `store/conversation-log-cache.ts` |
| Change conversation state shape | `frontend/store/chatSlice.ts` |
| Change what the LLM sees as page state | `frontend/store/appStateSelector.ts` |
| Add a route → data mapping | `frontend/store/navigationSlice.ts` + `frontend/store/navigationListener.ts` |
| Add a UI flag (with localStorage persistence) | `frontend/store/uiSlice.ts` |
| Server-side file reads for tools/jobs | `frontend/lib/file-state/file-state.server.ts` |
| Preserve `as_user` / `mode` / `view` across a navigation | `frontend/lib/navigation/url-utils.ts` · `use-navigation.ts` |
| Block navigation on unsaved changes | `frontend/lib/navigation/NavigationGuardProvider.tsx` |

**One extraction produces a story's embed runs for every consumer.** `storyEmbedRuns` (`lib/data/helpers/param-resolution.ts`) is the single place that walks a story body for inline `<Question>` and `<Number>` embeds and resolves each one's params. Four independent callers depend on it agreeing with itself — the client augmentation that fills `queryResults`, the server-side `executeQueriesForFile`, EditFile's post-edit auto-execute, and the renderer (`views/story/InlineNumber.tsx`) — because each computes `getQueryHash(query, params, connection)` and a divergence does not throw: the embed simply renders unbound, with no cached result to find. A fifth consumer must route through `storyEmbedRuns` / `bindReferencedParams` rather than re-deriving the set.

**Edit-time parameter lints are advisory, and there are exactly three.** `collectEditValidation` (`lib/file-state/file-edit.ts`) runs on every edit, always applies the edit, and returns `validation: string[]` as text the agent can self-correct from. `lintStoryParams` flags a `:name` an embedded question needs with no `<Param>` declared, a declared/used type mismatch, and a declared-but-unused param. `lintStoryParamSources` flags a `<Param id={N}>` importing from a file that does not exist or is not a question. `lintDashboardParams` flags one `:name` used at two different types across questions — auto-derive then silently produces two separate filters instead of one shared one. All three live in `lib/data/story/story-params.ts`; save/publish, not the edit, is the hard gate. `lintStoryParamSources` covers a second source kind: a `<Param query={…}>` whose `connection` is
missing. That is not cosmetic — `extractInlineFileQueries` and `storyEmbedRuns` both require
`query && connection` before admitting a param source, so a connection-less inline source is silently
absent from the executed set *and* from the public-share allowlist: the control renders with no
options and a guest's fetch is denied outright. The lint is the only place that failure is visible
before a reader hits it.

---

## Visualization

How a query result becomes a chart: two vocabularies (V1 `vizSettings`, the V2 `viz` envelope), the
recipe system, the Vega/Vega-Lite render pipeline, the editing surface and the validation gates.
**Vega is the only chart engine** — there is no second renderer to fall back to.

→ **`frontend/lib/viz/CLAUDE.md`** for the full pipeline, the V1→V2 bridge and the gotchas.

## Render surfaces

Rendered documents (stories, dashboards) do not draw into the main document. They mount into a
**same-origin iframe** whose body holds one `<svg><foreignObject><div>` — the *surface*. That one
choice is the spine of this whole area: `foreignObject` content is real, live, interactive DOM
(focus, hit-testing, `contenteditable` all work), but the same `<svg>` can be handed to
`XMLSerializer` and rasterized through an `<img>`. Capture is therefore **serialization of the
element the user is looking at**, never a re-derivation of layout. Everything else here exists to
make that serialized copy self-contained (its own styles, fonts, canvas pixels, scroll state) or to
decide *when* it is safe to serialize.

Eight modules:

| Module | Owns | Does NOT own |
|---|---|---|
| `lib/jsx` | Parse/validate/serialize static JSX **as data** | Rendering; which components exist |
| `lib/story-ui` | The shadcn component registry + AST→React interpreter | Parsing, validation, the components themselves (`components/kit/*`) |
| `lib/story-surface` | Mounting + sizing the svg surface; serializing it to a standalone SVG | Building the iframe document; deciding readiness |
| `lib/dashboard-surface` | The dashboard iframe's single generated stylesheet + its measured-width context | Mounting (it reuses `lib/story-surface`) |
| `lib/html` | Iframe-document plumbing: sanitize, CSP, style mirror, font resolution, save-time re-serialization, healing | Layout, capture |
| `lib/screenshot` | Browser capture orchestration: which path, readiness gating, cropping, position markers, agent-image constants | Serialization internals (delegated) |
| `lib/headless-capture` | Server-side story capture via Playwright + its lifecycle | Anything browser-side |
| `lib/og` | Open Graph share cards (client preview capture + server composition) | The story renderer |

### `lib/jsx` — static JSX as inert data

`parseJsx` (acorn + acorn-jsx, isomorphic) wraps the source in `<>…</>` so multiple roots are legal,
offset-corrects positions back, and normalizes to `JsxElement | JsxText | JsxExpression`. Attribute
and child `{…}` expressions are resolved to JSON literals where possible; **non-static expressions
are recorded, not thrown**, so `validateJsx` can reject them with a precise span. Only an acorn
syntax error yields `{ ok: false }`.

`validate.ts` is the security boundary — a JSX parser gives no "static" guarantee for free. It
rejects: non-JSON attribute values and spreads, `on*` handlers, name-denied attrs
(`dangerouslySetInnerHTML`, `ref`, `key`, `srcdoc`, `is`), dangerous tags
(`script`/`iframe`/`object`/`embed`/`base`/`meta`/`link`/`form`/`frame`/`frameset`/`applet`/`noscript`),
unregistered Capitalized tags, tags outside an optional HTML allowlist, and dangerous URL schemes in
URL-bearing attributes. Scheme checking strips `[\x00-\x20]` first because browsers do
(`java\tscript:` resolves as `javascript:`); `srcset`/`ping` are checked per list entry;
`data:image/*` is allowed, other `data:` is not.

`serialize.ts` is the inverse and the round-trip is load-bearing: strings are entity-escaped
(`&`, `"`, `<`, `>` in attributes; plus `{`/`}` in text), because acorn-jsx *decodes* entities and
does **not** process backslash escapes — `JSON.stringify`ing an attribute containing `"` would
terminate the attribute and lock the file out of every subsequent edit. Static string expression
children re-emit as template literals so SQL/CSS keep `<`, `>`, `{` raw.

`lenient.ts` (`sanitizeLooseJsx`) rewrites the three HTML-isms agents actually produce — comments,
unclosed void tags, a stray `<` in prose — skipping template-literal spans. It is applied **only as
a retry after a strict parse failure** (`lib/data/story/content-jsx.ts`); a document that already
parses is never altered. Comment stripping runs to a fixpoint (one pass can splice a new `<!--`).

`components.ts` binds the two allowlists: `JSX_COMPONENT_NAMES` (legacy stories: embeds + the
invented design components in `lib/data/story/story-components.ts`) and
`JSX_STORY_COMPONENT_NAMES` (new `format:'jsx'` stories: embeds + `STORY_UI_COMPONENT_NAME_LIST`).
Names only — no React import — so server-side save validation stays headless.

### `lib/story-ui` — registry and interpreter

`registry.ts` maps ~60 tag names to the vendored shadcn components in `components/kit/*`.
`component-names.ts` is the same list as data only (`STORY_UI_COMPONENT_NAME_LIST`) plus
`STORY_HTML_TAGS`, the explicit HTML allowlist for new-format stories; `__tests__/registry-names.test.ts`
asserts the two never drift.

`interpreter.tsx` turns a validated AST into React elements over an injected registry:

```
JsxNode[] ──renderStoryNodes(nodes, { components, decorateElement })──▶ React.ReactNode
             per node: buildProps → React.createElement(Component ?? tag.toLowerCase())
```

It is **defense in depth, not a second validator**: even on an unvalidated AST it drops `on*` props,
`DENIED_PROPS`, dangerous URL schemes, and non-static values, so nothing executable reaches React.
Unknown Capitalized tags render nothing. Author-side HTML spellings are mapped (`class`→`className`,
`for`→`htmlFor`); `style` accepts a CSS string or an object and is sanitized to string/number values.
Controlled props are rewritten to their uncontrolled forms, but `value`→`defaultValue` **only on
`Tabs`/`Accordion`** — elsewhere `value` names a pane (`TabsTrigger`, `AccordionItem`) or is the
displayed number (`Progress`), and rewriting it breaks the component.

Every element is stamped `data-mx-ast="<path>"` (dot-separated child indexes counting *all* nodes).
That stamp is how `lib/data/story/jsx-edit.ts` maps a WYSIWYG DOM edit back to the JSX source node;
`decorateElement` is the hook `components/views/shared/StoryJsxBody.tsx` uses to wrap editable text
hosts — implementations must preserve the element's `key`, which carries the same path.

`floating.ts` exports `STORY_FLOATING_CSS`, injected into the story root: inside `foreignObject`
`position: fixed` resolves against the SVG viewport, not the page, so Radix's popper wrapper
(`[data-radix-popper-content-wrapper]`) is forced to `absolute`. `cn.ts` re-exports
`components/kit/cn.ts`. `recipe-classes.ts` is a generated Tailwind-candidate union extracted from kit
sources (`npm run generate-story-ui-classes`), unioned with per-story candidates when
`lib/data/story/story-css.server.ts` compiles a story's CSS. The compile candidate set is actually
`STORY_RECIPE_UNION` = these classes ∪ `STORY_WYSIWYG_CLASSES` (`lib/data/story/typography.ts`), and
that union is also the hash source for `storyCssCompileVersion()` — so growing the format toolbar's
palette flips the version and every previously-saved story recompiles at read time
(`lib/data/story/__tests__/story-css-typography.test.ts`).

`lib/data/story/typography.ts` is that second half and the single source of truth for the WYSIWYG
format toolbar: which Tailwind classes it may apply (a curated, token-based palette — the `text-*`
size scale, `font-bold`/`italic`/`underline`, the four alignments, curated `mt-*`/`mb-*`/`p-*` steps,
`max-w-prose`, and the full-bleed recipe) plus the pure class-string algebra that the live DOM
mutation and the AST write-back both call, so instant feedback and persisted source can never
diverge. It is curated rather than free-form for two reasons: `story-css.server.ts` pre-bakes the
whole palette into every story's sheet, so applying a class is a DOM attribute change with zero
recompile latency, and a bounded palette can never author a declaration the banned-CSS guard would
strip. Stepping is **relative and in place** — every size/spacing token shifts one step including
variant-prefixed ones (`text-3xl @2xl:text-5xl` → `text-4xl @2xl:text-6xl`), because the story skill
mandates responsive type and a stepper that only rewrote the base token would leave the `@2xl:`
variant winning the cascade and masking the click.

### `lib/story-surface` — mount, size, serialize

`index.ts` hides the DOM-vs-SVG difference behind one interface so `AgentHtml` stays a thin
composition. Two implementations exist; **`'svg'` is the only one app code ever mounts** —
`AgentHtml`'s `surface` prop defaults to `'svg'` and no caller overrides it, and `DashboardSurface`
passes `'svg'` literally. The `'dom'` branch survives as the abstraction's second implementation and
is exercised only by tests.

```
mountStorySurface(doc,'svg',w) → <svg data-mx-story-svg>
                                   └ <foreignObject>
                                       └ <div data-mx-story-root xmlns=XHTML>   ← surface.root
autoSizeStorySurface({surface, iframe, doc, fluid, fixedHeight?})
   sync(): stamp --mx-vh → [fluid] applyWidth(measured) → reflow
           → measureHeight() → applyHeight() → iframe.style.height
   observes: RO(surface.root), RO(iframe), window 'resize' → disposer
```

Non-obvious invariants, all pinned by `__tests__/story-surface.ui.test.ts`:

- An `<svg>` does **not** auto-size to its `foreignObject` content — it defaults to 150px. Height and
  (for fluid callers) width must be pushed in explicitly, on **both** the svg and the foreignObject,
  since each clips its content.
- The root must carry the XHTML namespace or the browser parses it as an unknown SVG element and
  renders nothing.
- Heights round **up** (a short svg clips the last text line); widths round **down** (a surface wider
  than its container is exactly the clipping failure this prevents). Both writes are change-guarded,
  because the caller drives them from a `ResizeObserver` and a redundant write re-triggers it.
- `sync()` order is load-bearing: width → reflow → measure → applyHeight. Reading `scrollHeight`
  flushes layout, so the reflow between the two is synchronous.
- `RO(iframe)` — a *top-document* target — is the only thing that fires on a pane-width change; the
  inner document's observer is not reliably delivered across realms.
- The iframe is content-sized, so `vh` inside a story is useless; the surface stamps the host
  window's `innerHeight` as `--mx-vh` **on the root** (inside the serialized subtree) so captures
  keep it. `STORY_FLUID_SHIM_CSS` caps chart embeds/media to the container and must likewise be
  injected *into the root*, not `<head>`.
- `STORY_CANVAS_WIDTH = 1280` is the logical canvas — the fallback before a fluid story can measure
  its parent, the width `ScaledStoryFrame` re-exports as `STORY_W`, and the headless capture default.

`serialize.ts` turns the live `<svg>` into a standalone string. An `<img>`-rendered SVG has no parent
document and no network, so four things are fixed up **on the clone only** (the live DOM is never
mutated): head styles cloned in (`collectSurfaceCss`), remote `url()` refs inlined as `data:` URIs
(`inlineFontUrls`, cached forever — fonts are immutable), scroll offsets baked as transforms
(`applyScrollOffsets` — `scrollLeft` is a property, so `XMLSerializer` drops it), and form state
stamped as attributes (`stampFormValues`). The clone's root also gets the current color-mode class,
because the standalone document has no `<html>` for `.dark`-scoped rules to match. `svgToImage`
rasterizes through a **percent-encoded `data:` URL, never a Blob URL** — Blob-URL SVG taints the
canvas in Chromium and WebKit — and awaits `document.fonts.ready` plus full `img.decode()` before
resolving, which is the main defense against blank captures.

`findStorySvg(element)` looks for `svg[data-mx-story-svg]` inside the element's iframe. Because
`DashboardSurface` mounts the same surface, dashboards are picked up by this path with no
dashboard-specific code.

### `lib/dashboard-surface` — the dashboard's closed style universe

Dashboards have **no authored classes**: every class inside the surface comes from our own
components, a closed set. So one static stylesheet covers every dashboard —
`chrome-css.gen.ts`, generated by `scripts/generate-dashboard-chrome-css.ts`
(`npm run generate-dashboard-chrome-css`) from react-grid-layout css + react-day-picker css +
compiled chrome utilities + the shadcn token layer (both modes, `--chart-1..5`) + the design-theme
`[data-theme]` blocks. `__tests__/chrome-css.test.ts` recomputes the version hash from current
sources and fails when the artifact is stale — otherwise the iframe would silently lose styles — and
asserts the sheet contains no non-`data:` `url()` (an external ref would 404 or taint a capture).
Note the chrome compile deliberately does **not** run the story pipeline's `sticky` ban: sticky table
headers are our code, not authored CSS.

`surface-width.tsx` is a bare React context. react-grid-layout's `WidthProvider` measures through
`resize-observer-polyfill`, whose refresh triggers are top-document events that never fire inside the
iframe realm — it measures once and goes deaf. The surface already tracks width authoritatively, so
`DashboardView` consumes `useSurfaceWidth()` instead of re-deriving it.

### `lib/html` — iframe document plumbing

- `sanitize-agent-html.ts` — DOMPurify for legacy HTML stories. Wraps input in
  `<div data-mx-story-root>` *before* sanitizing, because the parser would otherwise hoist a leading
  `<style>` into `<head>` and DOMPurify only returns the body. `<style>` is explicitly allowed (the
  iframe isolates it); `data-*` survives, so embed placeholders reach the portal step untouched.
- `agent-iframe-csp.ts` — `default-src 'none'` backstop. Nothing executes or fetches in the iframe
  realm (the nested React root runs in the top realm and fetches there), so only styles, fonts,
  images and media are allowed. `font-src 'self'` is required: next/font serves woff2 from
  same-origin `/_next/static/media/*`.
- `mirror-app-styles.ts` — copies the app residue the surface document still needs into the
  `style[data-mx-app-styles]` tag: static base guards (`.mx-chart-fill`, the `min-width: 0`
  grid/flex blow-out guard, the marquee utility) plus the top document's `@font-face` rules,
  absolutized against each sheet's own href. That is all — no Chakra/emotion CSSOM. The UI test setup
  mocks this module wholesale to a no-op (jsdom's `cssRules` is a slow JS reimplementation and goes
  quadratic across a test file).
- `css-urls.ts` — `absolutizeCssUrls`, deliberately dependency-free because it is shared by the
  mocked mirror **and** by the capture serializers; importing it from the mirror silently broke
  capture CSS collection in tests.
- `resolve-story-fonts.ts` — captures scan `@font-face`, not `@import`, so imported web-font
  stylesheets are fetched and their faces injected. Cached by URL set; an all-failed result is
  deliberately not cached so a later capture retries.
- `serialize-story.ts` — the save-side inverse of render for legacy stories: scope to
  `[data-mx-story-root]`, collapse nested wrappers, strip injected `data-mx-*` style tags and the
  embed-root host, strip leaked Ark `[data-scope]` runtime DOM, restore embeds to their authored
  empty placeholders from the `data-mx-osz` snapshot, drop `contenteditable`, and re-insert the
  hoisted `@import` font lines. Works on a clone in the root's **own** document.
- `heal-story.server.ts` — jsdom-only backfill (`lib/data/heal-stories.server.ts`) that runs the same
  serializer over a stored string; short-circuits unless the string carries `data-mx-story-root` or
  `data-scope`, so clean stories are never rewritten for incidental reformatting.

### `lib/screenshot` — which path, and when

```
captureFileViewWithReadiness(fileId, opts)
  ├─ waitForFileViewReady(fileId)            ← readiness.ts, best-effort, always resolves
  ├─ re-resolve [data-file-id] (may have remounted mid-settle)
  └─ captureElementBlob / captureElementFullHeightBlob
        ├─ findStorySvg → serializeStorySvg → svgToImage   (story, dashboard)
        └─ serializeElementToSvg          → svgToImage     (question, notebook, report, code)
              └─ rasterToBlob: fill bg → drawImage → [drawMarkerGutter] → canvas.toBlob
```

`serialize-element.ts` is the generic path for main-document React views whose CSS lives in the
parent document. It clones into `<svg><foreignObject>`, inlines every same-origin stylesheet
(`<style>` text verbatim — CSSOM re-serialization drops rules the parser doesn't know; link sheets
via `cssRules`, absolutized against the sheet's own href), runs the lockstep fixups
(`applyScrollOffsets`, `stampFormValues`, `stampCanvases`, node filter) *before* structural drops,
removes transient portal positioners (`[data-scope][data-part="positioner"]`, `position: fixed`
overlays that would land at a nonsense document-flow position), and re-establishes the ancestor
context the detached clone lost: an outer wrapper carrying the color-mode class + `data-theme` +
`snapshotInheritedStyle` (color/font/line-height — otherwise text falls back to initial black on dark
tiles), and an inner wrapper stamped `data-mx-theme-host` so `.dark [data-mx-theme-host]` token rules
resolve. `fixed`/`sticky` chrome renders at its document-flow position — accepted divergence.

`readiness.ts` gates everything. Busy is **explicit and opt-in**: any `[data-mx-busy="true"]` inside
the view, including inside same-origin iframes (one nested level), plus an iframe whose document is
still `loading`. Each poll re-broadcasts `FORCE_MOUNT_TILES_EVENT` on `document`, so windowed
dashboard tiles (`components/views/dashboard/WindowedTile.tsx`) mount their real content and their
own busy markers then gate the settle; re-broadcasting every poll matters because the view can
remount mid-settle. The wait always resolves by `timeoutMs` and returns `{ settled, busyCount }` —
degrading to a screenshot of a spinner is correct, hanging the tool is not.

`app-state-screenshot.ts` is the send-path attachment. Capture happens **only on send**, never
speculatively on view change (speculative warming froze the main thread for seconds while the user
typed). A one-slot cache keyed by `file id + markup hash + query-results/colorMode facet hash` makes
a repeat send instant; an **unsettled** shot is used once and deliberately not cached, because the
cache key may never change again and a cached spinner would be re-sent forever. A throwing capture
falls back to sending without an image.

`page-markers.ts` is pure band math on a **fixed document-pixel cadence** (`MARKER_CADENCE_PX = 400`)
— not a viewport fraction, so the numbered image is byte-identical across window sizes and stays a
cacheable prompt prefix. The two halves are deliberately decoupled: the badges are drawn into the
image (`draw-markers.ts`, mirroring `PageMarkerDevOverlay`'s geometry at content scale inside the
40px `pl-10` gutter marker-flagged views reserve), while the *pointer* — which bands the user is
looking at, plus per-element scroll offsets — is emitted as a tiny separate `<Viewport>` text block
(`read-viewport.ts`), so scrolling rewrites ~10 tokens and never invalidates the image before it.
`markersEnabledForAppState` gates both off one declared property, `FILE_TYPE_METADATA[type].markers`.

`constants.ts` is the single source for agent-image numbers (`AGENT_IMAGE_MAX_PX = 512`,
`DISPLAY_IMAGE_MAX_PX = 1536`, `AGENT_IMAGE_PIXEL_RATIO = 2`, `AGENT_IMAGE_JPEG_QUALITY = 0.85`,
chart watermark geometry) and is dependency-free so the browser capture path, the client chart
renderer and the server Sharp/Resvg renderer can all import it.

### `lib/headless-capture` — server-side story capture

`renderStoryToImage(input)` is the only seam; callers never import a backend. `manager.ts` owns the
lifecycle: lazy singleton backend (zero cost if unused, a failed launch clears the slot so a later
render retries), a `Semaphore` bounding concurrency (default 2), an idle shutdown (default 60s,
`unref`'d), and **it never throws** — disabled or unlaunchable ⇒ `{ ok:false, reason:'unavailable' }`,
a failed capture ⇒ `reason:'error'`. `playwright-backend.server.ts` launches headless Chromium in the
same container, loads `/f/<id>` exactly as a browser user would, waits for
`[data-file-id] iframe >>> svg[data-mx-story-svg]` and `fonts.ready`, and screenshots that element.
It renders at `STORY_CANVAS_WIDTH`, not a thumbnail viewport, because the surface tracks its
container — viewport width is a **layout input**, and a narrower one collapses container-query bands
so the agent would review a layout no reader sees. `session-cookie.server.ts` mints a short-lived
NextAuth session JWT (same secret and salt NextAuth uses, carrying `tokenVersion` so the
outdated-token guard passes) rather than driving the login form. Enabled by `HEADLESS_CAPTURE=1`,
default off.

### `lib/og` — share cards

`capture-story-preview.ts` runs in the browser when a story is made public: it finds
`[data-story-capture="<id>"]`, serializes the live surface (falling back to the generic element
serializer), crops the **top band** to the 1200×630 OG aspect, and POSTs a JPEG data URL to
`/api/files/[id]/preview`. `og-image.tsx` (server) pre-blurs that screenshot with sharp — satori
cannot do CSS blur — and composes the final card via `og-cards.tsx` (`next/og` + JetBrains Mono from
`public/fonts`, org branding from `getConfigsForMode`). The composed PNG is stored in the object
store and streamed back verbatim by `app/l/[shareId]/og/route.ts` — **a story card is never rendered
at crawl time**. Only the *generic* fallback (no capture yet, revoked share, root) can render on
demand, and even that serves the committed `public/ogs/generic.png` unless the org has a custom
expanded logo. That route is a plain handler rather than Next's `opengraph-image` convention because
the convention only ever emits the dev localhost host. `og-helpers.ts`'s `ogCacheKey` embeds
`updated_at` (normalized — `pg` returns `Date`, PGLite returns ISO strings) so the cache self-busts
on every edit.

### Interactions with other areas

**Story render path.** `components/views/story/StoryView.tsx` → `components/views/shared/AgentHtml.tsx`
builds the iframe document, mounts the surface, injects styles, and portals the body in.
`format:'jsx'` bodies go through `components/views/shared/StoryJsxBody.tsx`, which calls `parseJsx` +
`renderStoryNodes` with `STORY_UI_COMPONENTS` plus the live embeds from
`components/views/shared/StoryEmbeds.tsx`. **Contract:** the interpreter runs in the *parent* React
tree and its output is portaled into `surface.root`; iframe events do not bubble to the parent
document, so anything interactive must render from a root inside the iframe.

**Dashboard render path.** `components/containers/DashboardContainerV2.tsx` puts `data-file-id` on a
wrapper around `components/views/shared/DashboardSurface.tsx`, which reuses `mountStorySurface` /
`autoSizeStorySurface` / `StoryEmbedProviders` and injects only `DASHBOARD_CHROME_CSS` + the app-style
mirror. **Contract:** styles go **inside `surface.root`**, never `<head>` — the serialized `<svg>`
must be self-contained by construction. (`collectSurfaceCss` head-cloning exists for stories, whose
authored `<style>` blocks already live in the root.) DashboardSurface must also stamp
`data-mx-busy` on the root at build and clear it after the nested root's first commit
(`ClearBusyStamp`), or the readiness gate settles on an empty surface.

**Save path (`lib/data/story`).** `file-markup.ts` validates incoming markup with
`validateJsxSource` against `JSX_STORY_COMPONENT_NAMES` + `STORY_HTML_TAGS`; `content-jsx.ts` does the
`content ⇄ jsx` conversion and is the only caller of `sanitizeLooseJsx`; `jsx-edit.ts` applies WYSIWYG
DOM edits back onto the AST by `data-mx-ast` path and re-runs `validateJsx` on the result.
**Contract:** save-time validation and render-time interpretation are two *independent* gates over
the *same* allowlists. Neither may be relaxed on the assumption that the other caught it.

**Agent tooling.** `lib/tools/handlers/file-review.ts` and `components/explore/ChatInterface.tsx`
call into `lib/screenshot`; `agents/analyst/file-tools.ts` calls
`renderStoryImageBlocks` (`lib/headless-capture/story-image-blocks.server.ts`) for headless turns,
where Slack's app state has no `fileState` to hang an image on. **Contract:** LLM-facing callers MUST
branch on `readiness.settled` — an un-annotated mid-load capture reads as broken content and triggers
destructive "fixes".

**Region capture.** `components/screenshot/RegionCaptureButton.tsx` /
`ImageAnnotatorDialog.tsx` call `captureRegionBlob`, passing a `filter` that excludes the selection
overlay and a `targetBox` snapshotted at drag time.

**Charts.** `components/viz/VegaChart.tsx` forces Vega's SVG renderer precisely because captures
serialize live DOM — canvas content serializes empty (`stampCanvases` is the fallback, and a tainted
canvas is skipped entirely).

**CI / scripts.** `scripts/capture-matrix.ts` (+ `b2-surface-matrix.ts`, `story-width-matrix.ts`,
`b2-surface-drivers.tsx`) drives the real modules across Chromium/WebKit/Firefox;
`scripts/headless-capture-fidelity.ts` pixel-diffs the Playwright screenshot against the client
serialize path under an explicit threshold — that diff is what keeps the two capture mechanisms from
forking.

### Gotchas

- **A Blob URL for the rasterizing `<img>` taints the canvas** in Chromium and WebKit. `svgToImage`
  uses a percent-encoded `data:` URL; never "optimize" this.
- **Styles injected into `<head>` are lost by the SVG capture path.** Anything the surface needs must
  live inside `surface.root` — which is also why `serialize-story.ts` strips the whole `data-mx-*`
  style family on save (otherwise derived CSS compounds into `content.story` on every round-trip).
- **DOM *state* is not markup.** Scroll offsets, `input.value`, `checked`, `<option>.selected` and
  `<canvas>` pixels all vanish through `XMLSerializer` and are stamped in explicitly. All these
  fixups walk live and clone trees **in lockstep** and must run before any structural removal.
- **Both generated artifacts are CI-gated for freshness**, not for correctness: change a kit/chrome
  source without regenerating and `lib/dashboard-surface/__tests__/chrome-css.test.ts` /
  `lib/story-ui/__tests__/recipe-classes.test.ts` fail — a missing regeneration surfaces as a failing
  test, never as a silently unstyled iframe. The extractor tokenizes **raw source text**, so even a
  comment edit to a file in `components/kit/`, `EMBED_CHROME_FILES` or `DASHBOARD_CHROME_FILES`
  (`scripts/generate-story-ui-classes.ts`, `scripts/generate-dashboard-chrome-css.ts`) changes the
  candidate set and trips both gates. Regenerate after touching those files, whatever you changed.
- **`format:'jsx'` story bodies are stored as jsx TEXT**, not as a stored AST. The AST is a transient
  in every edit path.
- **The interpreter's `data-mx-ast` stamps are render output only.** Nothing that carries them may be
  written back to source; `jsx-edit.ts` strips **any** `data-mx-*`-prefixed attribute plus `contenteditable`, so a new render
artifact (`data-mx-busy`, `data-mx-selected`, `data-mx-hover`) is covered by the prefix rule without
any edit here.
- **`applyWidth` rounds down, `applyHeight` rounds up.** They are not symmetric, on purpose.
- **`'dom'` surface is unreachable from app code.** `AgentHtml` defaults to `'svg'`, nothing passes
  otherwise, so the DOM-surface branches (and `capture-story-preview.ts`'s "DOM-rendered story"
  fallback) exist as the abstraction's second implementation and are exercised only by tests.
- **`headless-capture` never throws.** Distinguish `unavailable` (flag off / no Chromium — degrade
  silently) from `error` (a real capture failure).
- **A story is not a static Chakra-free zone by accident.** The iframe CSP is `default-src 'none'`;
  the sanitizer/validator is the primary defense and the CSP is the backstop, but the iframe is
  same-origin, so this is defense in depth, not isolation.

### Key files

| Task | File |
|---|---|
| Add/deny a JSX attribute or tag | `frontend/lib/jsx/validate.ts` (+ mirror in `frontend/lib/story-ui/interpreter.tsx`) |
| Add a component stories can use | `frontend/lib/story-ui/registry.ts` **and** `frontend/lib/story-ui/component-names.ts` |
| Change how a story is sized inside its iframe | `frontend/lib/story-surface/index.ts` |
| Fix a capture that loses styles/fonts/images | `frontend/lib/story-surface/serialize.ts` (surfaces) / `frontend/lib/screenshot/serialize-element.ts` (main document) |
| Change which capture path a view takes | `frontend/lib/screenshot/capture.ts` |
| A capture rasterizes spinners or blank tiles | `frontend/lib/screenshot/readiness.ts` |
| Change what the agent sees on send | `frontend/lib/screenshot/app-state-screenshot.ts` |
| Change marker cadence / the `<Viewport>` pointer | `frontend/lib/screenshot/page-markers.ts`, `read-viewport.ts`, `draw-markers.ts` |
| Agent image size/quality constants | `frontend/lib/screenshot/constants.ts` |
| Dashboard iframe missing a style | `frontend/lib/dashboard-surface/chrome-css.gen.ts` → `npm run generate-dashboard-chrome-css` |
| Story CSS candidate list is short a class | `frontend/lib/story-ui/recipe-classes.ts` → `npm run generate-story-ui-classes` |
| Add a class the format toolbar can apply | `frontend/lib/data/story/typography.ts` (auto-unions into the compile and flips the CSS version) |
| Saved story grows / re-nests on every save | `frontend/lib/html/serialize-story.ts` |
| Server-side story image (Slack, reports, eval) | `frontend/lib/headless-capture/index.server.ts`, `playwright-backend.server.ts` |
| Share-card look or caching | `frontend/lib/og/og-cards.tsx`, `og-image.tsx`, `og-helpers.ts` |

**One converter, no per-type dialect.** `content` (the typed jsonb) stays canonical for every file type — renders, GUI saves, the query path and the validators are unchanged — and the agent's markup is a *projection* of it produced by a single uniform converter (`lib/data/story/content-jsx.ts` + `file-markup.ts`), not a per-type serializer. The TypeBox `*Content` schema does double duty: it validates the content *and* drives the conversion, deciding what nests, what is an array, how a scalar coerces, and which field is a `format:'jsx'` body. Storing the markup as the source of truth was considered and dropped — it buys nothing the projection does not, and costs a storage migration plus a second truth to keep in sync.

**Do not fork a JSX parser, and do not reach for MDX.** A post-parse validator over `acorn` + `acorn-jsx` is less code and less maintenance than a dialect-specific parser, and it yields precise diagnostics ("attribute `viz` uses a call expression — not allowed") instead of an opaque parse failure, which is what lets the agent self-correct. MDX is the wrong shape at a deeper level: it *compiles JSX to an executable JavaScript module*, reinstating the "it is code, not data" problem the interpreter exists to avoid. The markup stays an inert AST that is interpreted, never evaluated.

**Banned story CSS is one constant with three enforcement points.** `lib/data/story/banned-css.ts` is the single source behind the prompt rule, the save-time sanitizer over `<style>` blocks and inline styles (`sanitizeStoryMarkupCss`, wired into `file-markup.ts`), and the Tailwind candidate filter that runs before compile (`partitionBannedCandidates`). Two bans: `position: fixed` / `sticky`, because containing-block semantics break inside `<svg><foreignObject>` and a fixed element lands somewhere else entirely in a capture; and every external-fetch construct — `url()` / `src()` tokens and `@import`, with only `data:` URIs passing — which is simultaneously an exfiltration guard (authored CSS firing requests from a guest viewer's browser) and a capture-taint guard (the serialized SVG must be self-contained). Detection runs on a decoded copy (comments removed, CSS escapes and HTML entities resolved, lowercased) so `\75 rl(…)`, `POSITION:FIXED` and `url(&quot;…&quot;)` cannot smuggle past, while the strip removes the original text. Enforcement is declaration-level — a banned declaration is dropped and its siblings survive, so a save never fails on style content. Nothing else needs rejecting: `foreignObject` renders with the real engine, so whatever renders live captures identically.

**`buildSalvaging` is protective, not a bug fix.** A probe of 40+ malformed candidate shapes (`w-[calc(100%`, unbalanced brackets and quotes, and similar) found that nothing throws in current Tailwind v4 — so it is not fixing an observed crash. It exists because `withCompiledStoryCss` is awaited on the `createFile`/`saveFile` path: a future Tailwind that *does* throw on one bad class token would fail the entire save. So `build()` runs inside a bisect that drops whichever candidates a compiler rejects, compiles the survivors, and logs what it dropped. It never throws. The banned-CSS candidate filter is a deliberately separate step *before* the bisect, so a security reject can never be silently absorbed as a "bad token".

**Prop filtering has to be a deny list, and that is forced by the component library.** Every one of the 20 vendored kit components spreads `{...props}` onto its root element and enumerates nothing, so there is no allow list of props that could be expressed — an unknown attribute reaches the DOM by construction. Hence the global denials: `on*` handlers, `ref`, `key`, `dangerouslySetInnerHTML`, `srcdoc`, `is`, style sanitized to string/number values, and scheme filtering on every URL-bearing attribute (`href`, `src`, `srcset`, `xlinkHref`, `formAction`/`formaction`, `ping`). This matters because `content.story` is editable by any org user and rendered to other viewers including anonymous guests — it is a real XSS boundary, not a lint.

**Legacy-ness is derived from stored content only.** `isLegacyStoryContent` (`lib/data/story/file-markup.ts`) decides via an attribute-level match for `data-c` on the *existing stored* HTML (plus a non-empty legacy body), never from incoming markup — a story cannot be declared legacy by what the agent or the editor sends. That matters because the legacy flag relaxes `validateJsxSource` to accept the retired component vocabulary; accepting it from input would turn it into a validation bypass. Legacy stories are frozen rather than migrated: they keep the old compile path and their live `@import` fonts, and the banned-CSS sanitizer is wired only into the jsx-story save path.

**Headless capture needs a real browser — that is the problem, not a missing library.** Node-side SVG rasterizers ignore `foreignObject` entirely, and Satori implements a flexbox-only subset that cannot express story markup, so neither can stand in for the Playwright backend. The swappable-backend seam exists to allow a *different browser*, not a pure-Node renderer.

**A theme is CSS custom-property values and nothing else.** Components and utility classes are identical across all six themes (the shadcn/tweakcn convention); a theme swaps `--background`/`--foreground`/`--card`/…, `--radius`, the font families and `--chart-1..5`, which is how a theme change recolors Vega charts without touching a spec. All six ship as tiny `[data-theme="<name>"]`-scoped blocks appended to a story's compiled sheet, so switching themes is instant and needs no recompile. **Themes set defaults only** — authored and agent CSS is injected after the compiled sheet in document order and wins. A theme that starts shipping component overrides or `!important` breaks both properties at once.

**No story-side JavaScript, and no query tool that would need it.** The interpreter runs in the *parent* React tree and portals into the story root, which is only possible because the iframe stays same-origin: one React tree, one Redux store, direct events, no in-iframe bundle and no `postMessage` bridge. Shipping arbitrary story JS would only be safe under an opaque-origin sandbox, which kills the parent's `contentDocument` access and forces both the embeds and the interpreter into an in-iframe bundle behind a bridge — an entire second architecture in service of one feature. If the need returns, the shape is a closed-verb API executed by trusted parent-side code: never `eval`, never a sandboxed realm.

**Charts are Vega or they are wrong, and that is enforced by prompt and rubric rather than a lint.** The failure mode is an agent hand-building a chart out of HTML and CSS divs. Enforcement is (1) the `skill_stories` / `skill_questions` rule that anything visualizing data must be a `<Question>` embed carrying a `<viz>` envelope, with reference images reproduced as Vega-Lite specs — HTML stays correct for stat tiles, callouts and layout — and (2) a rubric line ("no hand-drawn charts — all data visuals are live embeds"), because a fake chart is visually obvious to the judge. A save-time HTML heuristic was considered and dropped: it is weaker than both, since any div-with-widths pattern either misses real cases or blocks legitimate layout.

**`content-jsx.ts` is file-type-agnostic by injection, and must stay that way.** Its `SchemaCtx` takes an optional `jsxField` codec (`toJsx`/`fromJsx` plus the component and HTML-tag allowlists), and `file-markup.ts` is the only place that binds file type → schema and wires the story-v2 codec in; with no codec present a `format:'jsx'` field degrades to a plain string leaf. That injection is what keeps the generic schema-walking converter from importing any specific file type's module, and it is why `content-jsx` and `story-v2` are siblings rather than a dependency chain. `file-markup` is thin but not vestigial — keep it thin, and do not let `content-jsx` learn about stories again.

**Chromium does not repaint transformed `foreignObject` content after a relayout.** The DOM and the layout are correct; the *old pixels* survive until an unrelated invalidation, and transform transitions freeze mid-animation. Three mitigations carry this, all load-bearing:

- Grid item transitions are switched off inside the surface — `DashboardView` injects `[aria-label="Dashboard"] .react-grid-item { transition: none; }`, and tile chrome transitions colours and opacity only, never `transform` (react-grid-layout merges those classes onto its positioned item).
- `DashboardSurface` nudges the compositor after every committed size change: `svg.style.transform = 'translateZ(0)'` for one frame, then cleared.
- Width re-measurement is trailing-debounced 60 ms, so an animated pane toggle costs one relayout and one repaint instead of a per-frame grid relayout with a Vega resize on every tile.

Animating a pane width is not something to tune — transformed `foreignObject` content cannot paint incrementally at all.

- **A surface svg's own `getBoundingClientRect` is frame-relative.** `svgBoxInTopViewport` (`lib/screenshot/capture.ts`) walks up the frame chain adding each `frameElement`'s offset, because a region-capture selection is expressed in TOP-viewport coordinates. Comparing the two spaces directly crops against the wrong origin: the containment pre-gate then rejects a selection that really is on the surface — falling through to the generic path, which renders an iframe clone black — or crops the wrong band. The walk stops at the first cross-origin ancestor and keeps the composition it has.

**The marker gutter is an overlay and never changes canvas geometry.** `drawMarkerGutter` (`lib/screenshot/draw-markers.ts`) paints the badges and dashed band lines onto the already-rasterized content canvas at content scale, and a contract test asserts the output canvas is exactly the input's width. Widening the image would hand the agent a picture whose geometry differs from the page — the opposite of what numbered markers exist for. Badges live inside `MARKER_GUTTER_CSS_PX` (40, Tailwind `pl-10`), the left padding every marker-flagged main-document view reserves; **stories reserve nothing on purpose** and rely on their authored margins, because injecting structural padding would shift every curated story. Badge height carries a 14-output-pixel floor: at the roughly 0.45× agent scale the live overlay's 22px badge would render unreadable numerals, and the floored badge still fits the 40px gutter, so it never crosses into content.

**Why dashboards moved into an iframe and questions did not.** Partial self-containment — injecting the needed styles into a main-document surface — is not enough: the live render still sees app-document CSS that the serialized copy does not, which flips the direction of the fidelity gap rather than closing it. Shadow DOM does not close it either, since inherited properties and custom properties pierce a shadow boundary. A same-origin iframe is the only boundary where live and captured are equal *by construction*, and that is what makes the dashboard's single closed chrome stylesheet sufficient. Questions, notebooks and reports stay on `lib/screenshot/serialize-element.ts` plus the environment snapshot: iframe-izing a Monaco-bearing workbench is high cost for little capture fidelity. The iframe is a fidelity and isolation tool, **not** a performance one — expect no rendering speed-up from it; the real levers are tile windowing, per-tile chart cost and fewer observers.

**Design themes are one canonical palette each, and they pin the colour mode.** `content.theme` on `StoryContent` and on `DashboardContent` names one of the six `STORY_THEME_NAMES` (`modernist`, `classical`, `nocturne`, `organic`, `broadsheet`, `industry`); the registry is `lib/data/story/story-themes.ts`. A theme is CSS custom-property *values* — the shadcn token set plus fonts — with a small element-level layer for personality; components and utility classes are identical across themes, and the emitter appends tiny `[data-theme="<name>"]` variable blocks so switching a theme needs no recompile. Themes set defaults only: authored and agent CSS is injected after the compiled sheet and wins. A theme is a self-contained design rather than a light/dark pair, so a themed document renders the same in a light or a dark app — the surface mode is `storyThemeMode(theme) ?? content.colorMode ?? the app mode`, which keeps chart ink and embed chrome legible on the theme's fixed palette.

---

## Auth, Access Control, Mode Isolation, HTTP Helpers, and the File-Health Rubric

Six small, deep modules under `frontend/lib/`: `auth/` (identity), `mode/` (file-system
isolation), `middleware/` (the one place request identity is normalized), `http/` (route
wrappers + response shapes + the client fetch layer), `oauth/` (MCP bearer tokens), and
`rubric/` (file health scoring).

### What each module owns

**`lib/auth/`** owns *who the caller is*. `auth-factory.ts` builds the NextAuth v5 config
(credentials provider, JWT sessions, 7-day `maxAge`) and is instantiated exactly once in
`frontend/auth.ts`. `auth-helpers.ts` owns the `EffectiveUser` type and `getEffectiveUser()`,
the single request-scoped identity resolver every server route uses. `access-rules.ts` /
`access-rules.client.ts` own *role → file-type* permission, read from `frontend/rules.json`.
`role-helpers.ts` owns the three role predicates. `guest-session.ts` + `share-tokens.ts` own
anonymous public-share identity. `embed.ts` owns iframe-embedding cookie/CSP config.
`otp-utils.ts` / `password-utils.ts` own credential primitives. `e2e-runtime.ts` owns the
runtime E2E opt-in gate.

It does **not** own per-file ACL. Whether *this* user may touch *this* file is
`lib/data/helpers/permissions.ts` (`checkFileAccess`), which composes `isAdmin`,
`canAccessFileType`/`canViewFileType`, and the mode path helpers. It also does not own the user
table (`lib/database/user-db.ts`) nor the org-level rule overrides (`AccessRulesOverride` in
`lib/branding/whitelabel.ts`, delivered via the config document).

**`lib/mode/`** owns the *path algebra* of mode isolation: `Mode = 'org' | 'tutorial' |
'internals'`, `resolvePath(mode, logicalPath)`, `extractLogicalPath`, the system-folder tables,
and home-folder resolution. It does **not** own mode *selection* — that is
`lib/middleware/create-middleware.ts` (server) and the `?mode=` URL param propagated by
`mode-utils.ts` + `lib/http/fetch-patch.ts` (client). It performs no I/O; `resolveHomeFolder`
takes an injected `checkExists`.

**`lib/middleware/create-middleware.ts`** owns the auth gate and header normalization for every
request. It is the *only* place `x-mode`, `x-view`, `x-impersonate-user`, `x-user-id`,
`x-request-id`, `x-request-path` and `x-e2e-enabled` are set. `frontend/middleware.ts` is a
three-line wrapper; the matcher and `runtime: 'nodejs'` must stay a static literal there.

**`lib/http/`** owns the API surface contract in both directions. Server: `with-auth.ts`
(`withAuth`, `withCronAuth`), `with-remote-session-auth.ts` (`/s/<code>` capability auth),
`api-responses.ts` (`successResponse` / `errorResponse` / `ApiErrors` / `handleApiError`),
`api-types.ts` (`ApiResponse`, `ErrorCodes`). Client: `fetch-wrapper.ts` (caching + dedup +
abort), `useFetch.ts`, `declarations.ts` (endpoint catalog), `fetch-patch.ts` (global
`window.fetch` monkey-patch). It does **not** own the error *classes* — `UserFacingError`,
`FileNotFoundError`, `AccessPermissionError`, `FileExistsError` live in `lib/errors.ts` and
`handleApiError` only maps them to status codes. It also does not own the client file-data path:
that is `FilesAPI` (`lib/data/files.ts`), which does its own fetching; only a subset of
`declarations.ts` is actually referenced (see Gotchas).

**`lib/oauth/db.ts`** owns OAuth 2.1 credentials for the MCP endpoint. Despite the filename it
owns **no database tables**: PKCE authorization codes live in a `globalThis`-backed in-memory
`Map` (5-minute TTL), and access (1h) / refresh (30d) tokens are stateless JWTs signed with
`NEXTAUTH_SECRET`, discriminated by a `type` claim. It does not own the OAuth routes
(`app/oauth/*`, `app/.well-known/oauth*`) or the bearer→`EffectiveUser` bridge
(`lib/mcp/auth.ts`).

**`lib/rubric/`** owns file-health scoring: the report contract (`types.ts`), the scoring math
(`scoring.ts`), four pure deterministic scorers (`deterministic/*`), the check catalogs
(`checks.ts`), the LLM judge adapter (`llm/score-llm.server.ts`), and the two entrypoints
(`registry.ts` deterministic-only, `score-file.server.ts` combined). It does **not** own the LLM
call (`runMicroTask` → `MicroAgent`, prompts in `micro.rubric_llm` of
`orchestrator/prompts/prompts.yaml`), screenshot capture (`lib/screenshot/`), or the UI
(`components/file-browser/FileHealthPanel.tsx`).

### Architecture — identity and mode

```
  ?as_user=… ?mode=… ?view=… ?e2e=…        cookies: authjs.session-token | mx-guest | mx_e2e
                 │
                 ▼
  middleware.ts → createMiddleware()          ← auth() wraps it; req.auth = NextAuth session
    · public / share / remote-session / guest branch → set x-request-id, x-request-path only
    · no session            → 302 /login?callbackUrl=…
    · tokenVersion < CURRENT_TOKEN_VERSION → 302 /login   (auth-constants.ts)
    · authenticated branch  → x-user-id, x-mode (admin-gated for 'internals'),
                              x-view, x-impersonate-user (admins only), x-e2e-enabled
                 │
                 ▼
  getEffectiveUser()   (React cache() → once per request)
    · session? → impersonation lookup (UserDB.getByEmail) else session claims
    · no session + isShareGuestPath → verifyGuestToken(mx-guest) → guestToEffectiveUser
                 │
                 ▼
  EffectiveUser { userId, email, name, role, home_folder, mode, view?, guest? }
                 │
     ┌───────────┴────────────────────────────────┐
     ▼                                            ▼
  resolvePath(mode, '/…')                 checkFileAccess(file, user)
  resolveHomeFolderSync(mode, home_folder)   (lib/data/helpers/permissions.ts)
                 │                                │
                 └──────────► every DocumentDB query is mode-prefixed
```

`home_folder` is stored **relative** (`'sales/team1'`) and resolved against the live mode at
access time, which is what makes one user row work in `/org` and `/tutorial` simultaneously.
`checkFileAccess` enforces mode first — even an admin sees nothing outside `/{mode}/…`.

Background callers with no HTTP request build the user directly and pass mode explicitly:
`getUserEffectiveUser(email, mode)` (Slack), `lib/mcp/auth.ts` (bearer token → `DEFAULT_MODE`),
`resolveRemoteSession` (owner of the `/s/<code>` session).

### Architecture — the namespace seam

Mode is one isolation axis; `INamespaceModule` (`lib/modules/types.ts`, default implementation
`lib/modules/namespace/index.ts`) is the seam a deployment implements to add a coarser one. It has
four verbs. `resolve(req, hints)` maps a request to its namespace, or returns `null` to reject it —
there is no safe default. `seal(namespace)` makes that value safe to travel as the
`x-namespace-context` request header, because middleware writes it and handlers would otherwise trust
an attacker-supplied copy. `with(namespace, fn)` establishes one where there is no request to read it
from, scoped to `fn` and deliberately not `enterWith`-style: an ambient value cannot be unset and
leaks onto whatever runs next on the same async context, which on a pooled server is an unrelated
request. `isolation()` returns the current request's coarse prefix. The single-workspace
implementation answers a constant for all of them, `bindExternalId`/`unbindExternalId` are no-ops, and
`provision()` is the ordinary first-run `AuthModule.register`.

Three entry points cannot go through middleware and resolve for themselves, each because the
namespace is not in the URL: `app/api/mcp/route.ts` (it is in a bearer token), the Slack events
webhook (it is a `team_id`), and `app/oauth/authorize/approve/route.ts`. Each wraps its handler in
`with()`. Work that outlives its request — a detached chat turn, an `after()` callback — re-enters
via `getModules().auth.getContextRunner()`, which must be awaited **while the request is still
alive**, since that is when it captures the namespace. A JWT refresh has no request at all, so
`auth-factory.ts` stamps the namespace onto the token at login (`getExtraTokenPayload`, and the
`namespace` claim in `types/next-auth.d.ts`) and re-enters it around the `UserDB.getById` read. In
this repo `resolve()` ignores the session entirely, so nothing compares the session's namespace
against the request's — that comparison is what an implementing deployment adds, and the claim exists
so it can.

### Architecture — role rules

`frontend/rules.json` (`version: 3`) is the data. Three rule kinds matter: `fileTypeAccess` (per
role: `allowedTypes` for API access, `createTypes` for create **and** edit, `viewTypes` for UI
listing), `createLocationRestrictions` (mode-resolved required path prefixes), and the
`creationBlocklist` / `deletionBlocklist`.

Two implementations read it and must stay in step: `access-rules.ts` (server;
`fs.readFileSync(process.cwd()/rules.json)`, cached except in dev) and `access-rules.client.ts`
(client; static `import rulesConfig from '@/rules.json'`). Both apply the org's
`AccessRulesOverride` field-by-field on top. The client half exposes `useAccessRules()`, which
binds the overrides from `selectConfig` so components never pass them manually.

### Architecture — the rubric

```
  content (+ ctx)                              screenshot (data: or https)
        │                                              │
        ▼                                              ▼
  scoreFileDeterministic()                     scoreFileLLM()
  registry.ts → deterministic/{question,       llm/score-llm.server.ts
    dashboard,story,context}.ts                  → runMicroTask('rubric_llm', …)
        │  RubricFinding[] (source:'rule')        → parse {checks:[{id,pass,reason}]}
        │                                         → FAIL ⇒ finding (source:'llm')
        └───────────────► combineReports() ◄──────────┘
                                │
                          buildReport(fileType, findings, assessed)   ← scoring.ts
                          · category = 5 − Σ deduction, rounded to 0.5
                          · ANY error ⇒ that category AND overall = 0
                          · overall = weighted mean over ASSESSED categories only
                                │
                         toAgentRubric()  → what the agent reads
```

Three severities of coupling to the rest of the app: `refs.ts` derives the referenced-question
ids (dashboard assets, story `<Question id={N}>`) so the client badge, the server route, and the
agent review path all build the identical `DeterministicContext`; `score-file.server.ts`
resolves those ids via `loadFile` (best-effort, never throws); `deterministic/story.ts`
normalizes the stored placeholder-div story body back into agent JSX (`buildStoryJsx`) before
any rule runs, so rules read what the agent reads.

Consumers: `app/api/files/[id]/rubric/route.ts` (GET deterministic, POST combined),
`agents/analyst/health-tools.ts` (`CheckFileHealth` server tool),
`lib/tools/handlers/file-review.ts` (the EditFile/CreateFile/ReviewFile review core, which
degrades to the client-side deterministic rubric when a screenshot can't be captured), and
`components/file-browser/FileHealthPanel.tsx`.

The constants live beside the rules (`scoring.ts`: weights `0.3/0.3/0.4` for visual types,
`0.5/0.5/0` for context; grade bands 4 / 2.5. `question.ts`: 400/800 query tokens, ≤5 series.
`dashboard.ts`: `MIN_TILE_W/H` 2, `MIN_PLOT_TILE` 3, `MAX_VISUALS` 15, text 400/800 tokens.
`story.ts`: cartesian ≥50% of column or ≥480px, pie/funnel ≥34% or ≥260px. `context.ts`:
`MAX_DOC_TOKENS` 1000).

### Interactions with other areas

| Boundary | Contract |
|---|---|
| **API routes → `withAuth`** (~75 files) | Handler receives `(request, user: EffectiveUser, context)`. `null` user ⇒ `401` before the handler runs. Thrown errors are rethrown; non-abort errors also publish `AppEvents.ERROR` with `source: server:<pathname>`. |
| **API routes → `api-responses`** | `successResponse(data)` ⇒ `{success:true,data,request_id?}`; `handleApiError(e)` ⇒ `{success:false,error:{code,message,type?}}` with status from the `UserFacingError` subclass. ESLint (`eslint.config.mjs`, `app/api/**`) rejects a bare `NextResponse.json(…, {status:500})`. |
| **`lib/data/*` → `lib/auth` + `lib/mode`** | `files.server.ts` calls `canAccessFileType`, `canCreateFileType`, `canCreateFileByRole`, `canDeleteFileType`, `validateFileLocation`; `helpers/permissions.ts` calls `checkFileAccess`. All take `EffectiveUser` and are the only enforcement layer below the routes. |
| **Chat / orchestration → `EffectiveUser`** | `lib/chat/*.server.ts` and every server tool thread `EffectiveUser` for file access and mode. Guest chat is additionally gated by `guestChatDenialReason(user, SHARE_GUEST_CHAT_ENABLED)`, enforced in both chat routes. |
| **`lib/modules/registry` → namespace** | `attachNamespace` runs `getModules().namespace.resolve(req)` then `.seal()` into `x-namespace-context` in *both* middleware branches, deleting any inbound copy first. Only the authenticated branch acts on a `null` result (session cookies cleared, redirect to `/login`); the public branch discards it and proceeds with no namespace attached. |
| **`lib/modules/registry` → auth** | `AuthConfigOptions` (`auth-config-options.ts`) lets a module override user lookup, JWT refresh, and extra session fields without touching `auth-factory.ts`. `getContextRunner()` and `getExtraTokenPayload()` are the two hooks that carry the namespace past the end of a request. |
| **Client → server identity** | `fetch-patch.ts` monkey-patches `window.fetch` at import (`components/app-shell/Providers.tsx`) to re-append `as_user` and non-default `mode` to any `/api/` URL. XHR-based SSE bypasses it, so `store/api-url.ts` re-implements the same append for the chat stream. |
| **MCP → `lib/oauth`** | `app/api/mcp/route.ts` → `lib/mcp/auth.ts` → `OAuthTokenDB.validateAccessToken` → `UserDB.getById`, constructing its own `EffectiveUser` at `DEFAULT_MODE`. Middleware treats `/api/mcp`, `/oauth`, `/.well-known/oauth` as public. |
| **Remote agent sessions → `withRemoteSessionAuth`** | `/s/<code>/*`; the unguessable code is the only credential. Resolution is `resolveRemoteSession` (`lib/chat/remote-session.server.ts`); the wrapper adds a per-conversation 60-calls/60s in-memory limiter and yields `{conversation, user: <owner>, code, params}`. |
| **Rubric → orchestrator** | `runMicroTask('rubric_llm', vars, user, images)`; the checklist is rendered by `formatChecklist(fileType)` into the `{checklist}` prompt var and `fileToMarkup` supplies `{markup}`. The judge runs on a stronger model than the micro default via the code-owned grade override `rubric_llm: task('rubric_llm', 'core')` in `agents/micro/micro-tasks.ts`. |
| **Rubric → viz/story** | `refs.ts` imports `extractSavedQuestionIds` (`lib/data/story/story-question.ts`); `story.ts` imports `parseJsx` (`lib/jsx`) and `buildStoryJsx` (`lib/data/story/story-v2.ts`). Adding a viz type does not require a rubric change, but the cartesian/round sets in `story.ts` and `dashboard.ts` are hard-coded lists. |

### Gotchas

- **Header normalization only happens on the authenticated branch.** The public / share /
  remote-session / guest branches of `routeRequest` copy `req.headers` verbatim and set only
  `x-request-id`, `x-request-path` and `x-namespace-context` — a client-supplied `x-mode` or
  `x-impersonate-user` survives. `x-namespace-context` is the exception: `attachNamespace` deletes any
  inbound copy before setting its own on every branch, so a client-supplied one never reaches a
  handler. Safety rests entirely on each of those consumers building its own identity without
  trusting those headers: MCP uses `DEFAULT_MODE`, Slack passes mode explicitly, and the guest
  branch of `getEffectiveUser` derives everything from the signed cookie. Any new public route
  that calls `getEffectiveUser` breaks that invariant.
- **The `internals` admin gate lives on the header, not on the URL.** `x-mode` downgrades a
  non-admin's `?mode=internals` to `org`, but `effectiveMode` — used only for the bare
  `/p` → `/p/{mode}` redirect — does not. A non-admin can land on `/p/internals` while their
  data plane is forced to `org`.
- **Impersonation returns before the token-version check.** In `getEffectiveUser`, a matched
  `x-impersonate-user` returns immediately; `isTokenOutdated` is only reached on the
  non-impersonating path. Stale-token rejection for impersonating admins relies on the
  middleware having already redirected.
- **`resolvePath` is idempotent by design.** `resolvePath('org', '/org')` returns `/org`, not
  `/org/org` — the exact-match case exists because `home_folder` is documented as `/org` in
  places and double-prefixing rooted file search at a non-existent path.
- **`withCronAuth` answers auth failure with `200 {ok:true}`,** not 401 — deliberate, so a
  scheduler doesn't retry-storm an unconfigured `CRON_SECRET`.
- **`handleApiError` reports nothing.** The ESLint rule that forces it for 500s is justified in
  `eslint.config.mjs` as "ensures the error is reported to internal monitoring", but the
  function only `console.error`s. The only publisher of `AppEvents.ERROR` on the request path is
  `withAuth`'s rethrow branch — a route that catches its own error and returns
  `handleApiError(e)` never reaches it.
- **`handleApiError` has a legacy substring fallback:** any non-`UserFacingError` whose message
  contains `'not found'` becomes a 404 whose body says `"Resource not found"`, discarding the
  original message. Throw a `FileNotFoundError` to control the response.
- **`isClientAbortError` matches `'aborted'` exactly** (plus `AbortError` / `ECONNRESET`), not by
  substring, so genuine errors that merely mention aborting still get reported.
- **`fetchWithCache` aborts the previous in-flight request with the same cache key.** With
  `deduplicate: true` the second caller joins the first instead, so this only bites
  non-deduplicated endpoints. In-flight cleanup deliberately attaches two handlers to the
  original promise rather than `.finally(...)` — the latter branches a floating chain and
  surfaces failures as unhandled rejections (`__tests__/fetch-wrapper-dedup.ui.test.ts`).
- **`lib/http/declarations.ts` is largely unreferenced.** Only 18 of its endpoints are used
  (`files.search`, `files.delete`, `folders.create`, `conversations.listRecent`, the `admin.*`,
  `auth.*`, `recordings.*` and `orgs.register` groups). The rest — including
  `API.chat.send`, which points at `/api/chat`, a directory with no `route.ts` — are dead;
  file CRUD goes through `FilesAPI` instead.
- **Server and client access rules load `rules.json` differently.** The server reads it from
  `process.cwd()` at runtime (re-read on every call in dev, cached in prod, falling back to a
  hard-coded 3-role default if the file is missing); the client bundles it at build time. A
  deployment that ships the app without `rules.json` next to `cwd` silently degrades to that
  fallback, which knows only `question`/`dashboard`/`folder`.
- **`createTypes` governs editing as well as creating** (`canCreateFileByRole`), and an *absent*
  `createTypes` means "everything allowed", not "nothing".
- **Guest sessions are scope-pinned by the cookie alone.** `isShareGuestPath` admits only `/l/…`
  and `/api/…`; the main app UI ignores the cookie entirely. The synthetic guest `userId` is
  negative and derived from `sha256(nonce:email)` so guest conversation folders never collide
  with real users or the cron `-1` user. A share link's authorization is nothing but the nonce
  presence + non-revoked flag on `file.meta.shares[]` — `decodeShareLink` proves nothing.
- **Enabling embedding flips cookies to `SameSite=None; Secure` for everyone on that deploy.**
  `parseFrameAncestors` returns `''` for both the disabled case *and* `'*'`, so no CSP header is
  emitted in either — `'*'` is strictly more permissive than an explicit origin list.
- **`CURRENT_TOKEN_VERSION` (currently 2) is checked in two places** — middleware (redirect) and
  `getEffectiveUser` (returns `null` ⇒ 401). Bumping it logs everyone out.
- **Rubric: an `error` is a gate, not a deduction.** One error anywhere zeroes the overall to 0 /
  `poor` regardless of the other categories, and each category's own score also drops to 0. A
  category the source did not evaluate is `score: null, assessed: false` and is excluded from
  the weighted mean rather than counted as 5.
- **Every check in `LLM_CHECKS` is categorized `aesthetics`.** So in practice the judge fills the
  aesthetics gap the deterministic scorers leave for question/dashboard, and the deterministic
  half owns correctness/clarity. `context` has an empty LLM list, so `scoreFileLLM` returns
  without any LLM call at all.
- **Judge voting is configured off.** `JUDGE_VOTES = 1` in `score-llm.server.ts` despite the
  surrounding comment describing an N-run worst-of aggregation; a check a
  run omits from its JSON is treated as neither pass nor fail.
- **`CheckFileHealth` scores the last SAVED content**, while the rubric route's POST scores the
  caller-supplied merged content so the score matches the screenshot. A fresh unsaved draft
  therefore scores 0/5 through the tool.
- **The live thresholds, stated plainly** because they are easy to misremember: `visual-count`
  warns above `MAX_VISUALS = 15`; `JUDGE_VOTES = 1`; `too-much-text` has a warn tier AND an error
  tier at 800 tokens; `typed-number` triggers at 5+ digits; and the judge's model comes from the
  code-owned grade override `rubric_llm: task('rubric_llm', 'core')` in
  `agents/micro/micro-tasks.ts`.

### Key files

| Task | File |
|---|---|
| Change who is authenticated / add a login path | `lib/auth/auth-factory.ts` (+ `frontend/auth.ts`) |
| Change what identity a request resolves to | `lib/auth/auth-helpers.ts` |
| Add/alter a request header, public route, or redirect | `lib/middleware/create-middleware.ts` |
| Change role → file-type permissions | `frontend/rules.json` + both `lib/auth/access-rules*.ts` |
| Add a mode, or change mode path layout / system folders | `lib/mode/mode-types.ts`, `lib/mode/path-resolver.ts` |
| Add an authenticated API route | `lib/http/with-auth.ts` + `lib/http/api-responses.ts` |
| Change an API error's status or shape | `lib/http/api-responses.ts` (+ `lib/errors.ts` for the class) |
| Client caching / dedup / abort behaviour | `lib/http/fetch-wrapper.ts` |
| Preserve `as_user` / `mode` on a new client transport | `lib/http/fetch-patch.ts`, `store/api-url.ts` |
| Public share links and anonymous guests | `lib/auth/share-tokens.ts`, `lib/auth/guest-session.ts` |
| Iframe embedding (cookies + CSP) | `lib/auth/embed.ts` |
| MCP bearer tokens / PKCE codes | `lib/oauth/db.ts`, `lib/mcp/auth.ts` |
| Add or retune a deterministic health rule | `lib/rubric/deterministic/*.ts` + `lib/rubric/checks.ts` |
| Add or retune an LLM judge check | `lib/rubric/checks.ts` (`LLM_CHECKS`) + `micro.rubric_llm` prompt |
| Change scoring weights, deductions, grade bands | `lib/rubric/scoring.ts` |
| Score a new file type | `lib/rubric/registry.ts` (`SCORERS` + `DETERMINISTIC_COVERAGE`) |

**Why the rubric is analytic rather than one number, and how a new rule finds its home.** Quality is decomposed into atomic, independently-scored criteria because a single holistic score suffers halo effects, is not individually actionable, and calibrates poorly against human judgment — and because a judging LLM forced into structured per-criterion output is markedly less verbose and less position-biased. The three categories are a priority waterfall, so every rule has exactly one home: `correctness` ("if ignored, is it wrong, broken, or dishonest?"), then `clarity` ("it is correct, but is it hard to understand at a glance?"), then `aesthetics` ("it works and reads fine, but does it look unpolished?"). A rule belongs to the *first* category whose question it fails. The scale is deliberately coarse (0–5, rounded to 0.5) to avoid false precision, and **each category's baseline is 5 no matter how many rules it contains** — a category is penalized only for actual findings. That property is what makes the rubric extensible: adding a more granular check can never harshen the score of a clean file.

**The viz thresholds are grounded, not invented.** The dashboard visual-count band (roughly 5–9 visuals before a board stops being readable), F-pattern reading hierarchy, chart-fits-the-task, and the ≤7-categories-on-color ceiling come from published BI guidance (AHRQ dashboard design, Tableau and Sigma layout guidance); the chart-type-fit rules come from data-ink-ratio and graphical-perception work. The scoring model itself follows the analytic-rubric and LLM-judge-calibration literature. The story rules trace to our own `skill_stories` prompt — *a story is an argument with live numbers, not decoration*. Retune a constant when evidence says so, but do not treat these numbers as arbitrary defaults picked to make files pass.

**A review without a screenshot is weaker, not equivalent.** `scoreFileLLM` still runs when no `screenshotUrl` is available, but the prompt then tells the judge to work from markup alone and to mark visual-only checks `applicable: false` — and an inapplicable check can never become a finding. Since every entry in `LLM_CHECKS` is an aesthetics check, a screenshot-less run silently narrows the judge to the subset it can assess from text. Treat "reviewed" without a settled capture as a partial review.

**The rubric is never ambient.** It is deliberately not injected into app state or `ReadFiles` results — that was the first version's design and it read as background noise the agent learned to skip. Feedback is delivered only where the agent is already acting: `EditFile` returns the full post-edit review (and degrades to the deterministic half when nothing is mounted to screenshot), `CreateFile` returns the deterministic report because a fresh draft renders nowhere, and `ReviewFile` is the explicit no-edit review. Adding the report to a passive read path re-creates the failure it was moved away from.

**`embed-too-narrow` judges the desktop base layout on purpose.** `deterministic/story-layout.ts` resolves an embed's column-width share structurally — dividing by the track count of any multi-column `grid-template-columns` ancestor (resolving both inline `style` objects and class rules out of the story's `<style>` block), multiplying through percentage widths, and taking the tightest fixed `px` cap. `stripAtBlocks` removes `@container` / `@media` / `@supports` / `@keyframes` blocks *before* that resolution, so a narrow-viewport override that collapses the grid to one column cannot mask a base layout that squeezes a chart into a third of a column. The rule reports the structural cause of a cramped chart; whether the rendered result actually looks cramped is the judge's call.

**Two password bypasses sit ahead of the hash check in the credentials `authorize` chain.** `lib/auth/auth-factory.ts` accepts `password === user.email` when `IS_DEV`, and accepts the configured `ADMIN_PWD` for any admin in any environment, before it ever reaches `verifyPassword(password, user.password_hash)`. The dev shortcut is what lets `test/e2e/auth.setup.ts` register the workspace admin idempotently via `POST /api/orgs/register` and then log in with no seeded credential — and it is why a dev build must not be run on a reachable host.

**The runtime E2E opt-in is a hygiene gate, not a security boundary.** `?e2e=<E2E_RUNTIME_SECRET>` (validated in `lib/auth/e2e-runtime.ts`, persisted as the `mx_e2e` cookie, surfaced to SSR as the `x-e2e-enabled` header) does exactly one thing: it lets `ReduxProvider` expose `window.__MX_STORE__`, which is the requester's own Redux state, already present in their browser. No other user's data is behind it, so a leaked secret is a rotation rather than an incident. The faux-LLM channel is the part that stays build-time-only and 404s on a production build.

---

## Tools, Jobs, Integrations & Telemetry

Nine modules under `frontend/lib/` that sit at the app's edges: the browser half of the
agent's tool calls, the scheduled-job runner, the Slack and MCP surfaces, outbound
messaging, and the event/analytics pipeline every other module publishes into.

### What each module owns

**`lib/tools/`** — the browser-side execution of *frontend-bridged* tool calls. When a
server tool needs Redux or the DOM it throws `UserInputException` / `FrontendToolException`,
the orchestrator returns the call as pending, and `executeToolCall` (`lib/tools/tool-handlers.ts`)
runs it here before resuming the server run. The barrel owns registration and the
`ToolCall → ToolMessage` shape; each handler body lives in its own module under
`lib/tools/handlers/`. It does **not** own the LLM-facing arg schemas — those are TypeBox
objects colocated with the tool class in `agents/web-analyst/web-tools.ts`. It does not own
file mutation either: every handler goes through `lib/file-state/file-state.ts`.

**`lib/jobs/`** — scheduled and manual runs of `alert` / `context` / `report` / `sheets_sync`
job files: cron evaluation, run-file creation, handler dispatch, and message delivery
hand-off. It does not own what a job *does* (that's `lib/evals/server`, `lib/chat/run-report.server.ts`,
`lib/csv-processor`) nor the transport (that's `lib/messaging`). It does not own scheduling:
an external scheduler POSTs `/api/jobs/cron` once a minute; nothing here holds a timer.

**`lib/integrations/slack/`** — the whole Slack surface: OAuth install + HMAC state, bot/channel
config persisted in the org config document, event dedup, Slack Web API calls, markdown→mrkdwn
and Block Kit rendering, and the thread↔conversation mapping. It does not own the agent — it
calls the same `runConversationTurn` the browser uses.
It also owns one thing that is not obviously Slack's: recording which namespace a `team_id` belongs to.
A Slack event webhook arrives with no session and no identifying host — only the team id — so resolving
it has to happen *before* any request context exists, which means it cannot read namespace-scoped
storage. Install time is the one moment both values are known, so `upsertSlackBotConfig` /
`removeSlackBotConfig` call `syncTeamBinding`, which is `bindExternalId('slack_team', …)` /
`unbindExternalId`. The bind is best-effort and re-runs on re-install: the config write is what the
user asked for, so a binding failure is logged and swallowed rather than failing the install. The
events route then passes `hints: { slack_team: teamId }` to `resolve()`; a known team runs inside
`with()`, a team id that resolves to nothing is acked `{ok: true}` and dropped (guessing is worse than
losing an event), and a payload with no team id at all proceeds with no namespace established.
`lib/integrations/slack/__tests__/namespace-binding.test.ts` pins all five behaviours.

**`lib/messaging/`** — outbound message transports (config-declared HTTP webhooks with
`{{VAR}}` substitution, plus email/OTP HTML builders), client-side error reporting, and the
server-side unhandled-rejection router (`unhandled-rejection-logger.ts`, wired from `runBootTasks()`
in `lib/instrumentation/register-modules.ts`, not from `instrumentation.ts` — that file returns early
for a deployment supplying its own module set, so anything wired after the branch had to be
re-implemented verbatim). It does not own *who* to notify
(job handlers build recipient lists) and does not own the event bus.

**`lib/app-event-registry/`** — a synchronous-publish / fire-and-forget in-process pub/sub. It
owns the typed event catalogue (`events.ts`) and the single place handlers are subscribed
(`index.ts`). Business logic never calls an analytics function directly; it publishes.

**`lib/analytics/`** — two unrelated halves. (a) Server-side telemetry tables in the **document
DB** (`file_events`, `llm_call_events`, `llm_logs`, `queries`, `query_execution_events`,
`feedback_events`, `app_events`) plus the credit accounting built on `llm_call_events`.
(b) A client-side Mixpanel/noop provider plus a Redux middleware that mirrors *every* dispatched
action to it. There is **no DuckDB here** — `file-analytics.db.ts` writes through
`getModules().db`, the same Postgres/PGLite adapter as the document store.

**`lib/mcp/`** — a per-session MCP server bound to one OAuth-authenticated user, exposing
read-only tools. It does not own OAuth token issuance (`lib/oauth/`) and cannot write files.

**`lib/search/`** — pure ranking/snippet logic for file search and database-schema search,
plus the schema-result size cap. No DB access of its own beyond `FilesAPI`.

**`lib/spreadsheet/`** — direct-data ("spreadsheet") question sources: validation,
materialization into a `QueryResult`, and a content-addressed cache identity that reuses the
existing query-result key space so viz/projection need no second store.

### Architecture

**Frontend-bridged tool call** — the browser-side half of the tool loop lives in
`frontend/lib/tools/`, which has its own `CLAUDE.md` covering the bridge, the handler
registry and the review/rubric path.

**Job run**

```
external scheduler ──POST /api/jobs/cron──► runForOrg(now)          lib/jobs/cron-scan.ts
                                              for each JOB_DEFINITIONS entry
                                                FilesAPI.getFiles(type) → isActive → suppressUntil
                                                getCron(content) → getPrevFireTime  lib/jobs/cron.ts
                                                JobRunsDB.findOrCreate(window_start=prevFire)  ← dedup
                                                create run file (status:'running')
                                                JOB_HANDLERS[job_type].execute(...)
                                                save run file + deliverMessages(...)
                                                JobRunsDB.complete(SUCCESS|FAILURE)
                                            ──► runCreditResets(now)  lib/jobs/credit-reset.ts

user ──POST /api/jobs/run──► runJob(...)   lib/jobs/run-job.ts   (same body, one job, source:'manual')
```

`lib/jobs/job-runs-state.ts` is the client mirror of that surface (fetch history → Redux
`jobRunsSlice`, trigger a run, select a run) and is the only place components should reach for.

**Slack turn**

```
Slack ──► POST /api/integrations/slack/events   (signature verify + reserveSlackEvent)
            └─ processSlackEvent()                       lib/integrations/slack/process-event.ts
                 addReaction :eyes:
                 getSlackUserEmail → getUserEffectiveUser → checkCreditGate
                 getOrCreateSlackConversationId (meta.slackThreadKey)    slack/store.ts
                 buildSlackAgentArgs (app_state: {type:'slack'})         slack/context.ts
                 runSlackChatTurn → runConversationTurn                  slack/run-turn.server.ts
                 extractSlackReply / extractQueryCharts (legacy log)     slack/messages.ts
                 uploadSlackFile(charts) → postSlackMessage(blocks)
                 :eyes: → :white_check_mark:  (or :x: on throw)
```

**Event pipeline** — one publish fans out to specific handlers *and* a global sink:

```
appEventRegistry.publish(AppEvents.X, payload)          registry.ts (never awaited, never throws)
   ├─ specific subscribers (index.ts)  → file_events / query_execution_events / feedback_events
   │                                   → reportErrorToSentry (ERROR only)
   └─ subscribeAll sink (index.ts)     → enrichEventPayload (request path, referer, user)
                                          ├─ recordAppEvent  → app_events (JSONB payload)
                                          └─ forwardToWebhooks → EVENTS_FORWARD_RULES regex match
                                               hooks.slack.com → {text: "*type*\n• k: v"}
                                               anything else   → raw enriched JSON
```

### Interactions with other areas

| Boundary | Contract |
|---|---|
| `store/chatListener.ts` → `lib/tools/tool-handlers.ts` | Calls `executeToolCall`; catches `UserInputException` (`lib/tools/user-input-exception.ts`) to raise a `UserInputComponent` prompt and re-invoke with `userInputs` filled. Handlers must be re-entrant: the second call sees `userInputs[0].result`. |
| `agents/web-analyst/web-tools.ts` ⇄ `lib/tools/handlers/*` | The TypeBox schema and the handler are two halves of one contract, enforced in CI by `lib/tools/__tests__/tool-schema-sync.test.ts`: it parses each handler's *source text* and fails if the handler reads an `args` key the schema doesn't declare, or the schema declares a param the handler never reads. |
| `lib/tools/handlers/*` → `lib/file-state/file-state.ts` | Every read/edit/create/query goes through `readFiles`, `editFileStr`, `editFile`, `createDraftFile`, `getQueryResult`. Nothing here talks to `/api/files` directly. |
| `components/explore/*` → `lib/tools/tool-config.ts` | `getToolConfig(name)` returns `{displayComponent, chipLabel, chipLabelPlural, chipIcon, timelineVerb}`, with a `DefaultToolDisplay` fallback for unknown tools — a new tool renders without touching this file. |
| `app/api/jobs/{cron,run}/route.ts` → `lib/jobs/` | Routes are thin: auth (`withCronAuth` / `withAuth`), `JobRunsDB.ensureTable()`, then `runForOrg` / `runJob`. Outcomes are returned as a discriminated union (`RunJobOutcome`), never thrown. |
| `lib/jobs/handlers/*` → other areas | `alert`/`context` → `createServerRunner` (`lib/evals/server`); `report` → `runReportV2` + `buildServerAgentArgs`; `sheets_sync` → `lib/csv-processor` + `mergeReimportedSheetFiles`. All four return `{output, messages, status?}` — a handler reports failure by returning `status:'failure'`, it does not have to throw. |
| `lib/jobs/deliver-messages.ts` → `lib/messaging` + Slack | Resolves `config.messaging.webhooks` through `resolveWebhook`, then dispatches per `msg.type`. `slack_app_alert` bypasses webhooks entirely and posts via the installed bot token (resolved from its `@SECRETS/…` ref by `resolveConfigSecrets`). Mutates each `RunMessageRecord` in place and never throws. |
| Everything → `lib/app-event-registry` | Publishers include `lib/data/files.server.ts` (FILE_*), `lib/http/with-auth.ts` (ERROR), `app/api/query/route.ts` (QUERY_EXECUTED), `lib/chat/orchestration-core.server.ts` + `lib/chat/headless-llm-tracking.server.ts` (LLM_CALL), `lib/auth/auth-factory.ts` (USER_LOGGED_IN), `app/api/share/guest-session/route.ts` (SHARE_*), plus this area's `slack/process-event.ts`, `mcp/session-logger.ts`, `jobs/cron-scan.ts`, `jobs/credit-reset.ts`, `analytics/credit-usage.server.ts`. Contract: `publish` is void and fire-and-forget — you cannot await the write. |
| `lib/chat/orchestration-core.server.ts` → `lib/analytics` | Installs `creditEnforcer(user)` as the orchestrator's `beforeLlmCall` hook (throws `CreditLimitError` on an enforced over-limit user), and `await`s `recordLlmCallEvent` / `recordLlmRequest` / `recordLlmResponse` **directly** rather than via the registry, because a standalone prod build does not keep unawaited promises alive past the response. |
| `lib/mcp/server.ts` → data/search/connectors | Reuses `FilesAPI`, `ConnectionsAPI.getRawByName`, `getNodeConnector`, `readFilesServer`, `searchDatabaseSchema`, `searchFilesInFolder`, `getWhitelistForUser` + `validateQueryTables`, and `buildServerAgentArgs` — the same primitives the in-app agent uses, so MCP impersonates the user's context exactly. |
| `lib/spreadsheet/` → viz/query cache | `getSpreadsheetExecution(source)` returns `{query: 'spreadsheet:<hash>', params: {}, database: ''}`; `cacheSpreadsheetSource` dispatches `setQueryResult` under exactly that key. Consumers (`QuestionContainerV2`, `lib/file-state/file-read.ts`, `lib/chat/compress-augmented.ts`, `lib/data/helpers/param-resolution.ts`) resolve a question's source through `getQuestionExecution`, which is the single place `spreadsheet` and `query` are disambiguated. |
| `lib/branding/whitelabel.ts` → `lib/analytics/credit-policy.ts` | `OrgConfig.credits` is typed as `CreditsConfig`, so the settings UI, the gate, and the aggregation all read one shape from the org config document. |

### Gotchas

- **`appEventRegistry.publish` is unawaitable.** It returns `void` and swallows handler
  rejections into a `console.error`. Anything that must be durable before a response returns
  has to be awaited directly — that is exactly why `recordLlmCallEvent` is not an event handler.
- **A publish with no specific subscriber is not a no-op.** The `subscribeAll` sink still stores
  it in `app_events` and fans it to matching webhooks. `LLM_CALL`, `USER_MESSAGE`, `MCP_TOOL_CALL`,
  `REMOTE_TOOL_CALL`, `USER_*`, `SHARE_*`, `JOB_CRON_*`, `RATE_LIMIT_HIT` and `CREDIT_RESET`
  reach only that sink. `FOLDER_CREATED` is declared in `events.ts` but nothing publishes it.
- **Handler registration lives in `lib/app-event-registry/index.ts` and runs on first import of
  that barrel.** Importing `./registry` gets the same process-wide singleton but does not itself
  wire the subscribers, so publish through `@/lib/app-event-registry` rather than relying on
  another module having imported the barrel first.
- **`analyticsMiddleware` is in the store's middleware chain** (`store/store.ts`) and
  `BLACKLISTED_ACTIONS` is empty, so with Mixpanel configured every Redux action — with its
  full payload — is sent as `Redux/{slice}/{action}`. Blacklist patterns are the intended
  throttle; there are none today.
- **`handleApiError` does not report errors.** The route wrapper `withAuth`
  (`lib/http/with-auth.ts`) is what publishes `AppEvents.ERROR`, skipping client aborts
  (`isClientAbortError`) and rethrowing. `handleApiError` only shapes the response.
- **Cron dedup is the run row, not a lock.** `JobRunsDB.findOrCreate(window_start = prevFire)`
  is what stops a double fire; a job whose previous scheduled fire was more than one hour ago
  is skipped outright (`MAX_CRON_DELAY_MS`), so an outage does not retro-fire stale dailies.
- **Cron scanning ignores time zones; credit resets don't.** `cron-scan.ts` calls
  `getPrevFireTime(cronExpr, now)` with no zone, i.e. server-local time. `credit-reset.ts` passes
  the configured `resetTimeZone` (default `America/Los_Angeles`). Same evaluator, different
  effective schedule.
- **Cron-created run files are always typed `alert_run`**, hardcoded in `cron-scan.ts`, even for
  `report` / `context` / `sheets_sync` jobs. The manual path (`run-job.ts`) uses
  `` `${job_type}_run` ``. Anything filtering run files by type sees the two paths differently.
- **The cron path deliberately skips `slack_alert` delivery** (`skipTypes: ['slack_alert']` in
  `cron-scan.ts`) — those messages stay `pending` forever. `run-job.ts` delivers them. The
  in-code comment marks this as a known latent bug preserved on purpose.
- **`send: false` and `skipTypes` are different.** `send:false` marks *every* message `skipped`;
  `skipTypes` leaves the message untouched at `pending`.
- **Slack event dedup is in-memory and per-process** (a 500-entry `Set` in `slack/store.ts`,
  carrying an ESLint disable for the module-level-`Set` rule). It is lost on restart and is not
  shared across instances. `markSlackEventDone` is a no-op kept for API symmetry.
- **Slack is headless by construction.** There is no browser to bridge frontend tools to, so
  `runSlackChatTurn` always sends a fresh `user_message` turn and `setupOrchestration` swaps in
  `HEADLESS_REGISTRABLES` for `SlackAgent`. `extractSlackReply` reads only *this turn's* new
  rows (captured via `startSeq` before the turn) so an old answer can't be re-posted.
- **`SlackAgent` is the only agent with `TalkToUser`.** Every other agent replies via
  `stopReason: 'stop'` with plain content.
- **`Screenshot` is a live registration, not dead code.** The class still exists
  (`agents/web-analyst/web-tools.ts`, sharing `ReviewFileParams`) and is in `REGISTRABLES`, and
  the handler re-exports `reviewFileHandler` — so a saved log with a pending `Screenshot` call
  still resumes. It is not in any agent's advertised `tools` array.
- **A mid-load screenshot suppresses the visual judge.** When `readiness.settled` is false,
  `reviewFile` returns the deterministic rubric plus a `renderPending` note; grading spinner
  pixels previously drove agents to delete healthy embeds.
- **`CreateFile` never renders a chart image** (a created file is always a background draft) and
  refuses `dashboard`/`story` in the background unless `selectUnrestrictedMode` is on — those
  must go through `Navigate` with `newFileType`.
- **`CreateFile`'s `content` arg is `Type.Unknown`,** so the model often sends a JSON *string*;
  the handler parses it explicitly, because spreading a string into content produced
  `{"0":"{","1":"\n",…}` while still returning `success: true`.
- **Credit windows are named twice.** `credit-policy.ts` resolves `daily` and `weekly`; the
  aggregation maps `weekly → billing` and `daily → reset` (`credit-usage.server.ts`). A manual or
  automatic `CREDIT_RESET` app event moves the window start forward via `resetFloorExpr` — usage
  is floored at `GREATEST(calendar-start, latest applicable reset)`, so the reset feature is
  implemented as a *query* over `app_events`, not a mutation of stored usage.
- **`resolveCreditConfig` and the six allowance fields in `credit-budgets.ts` are test-only.**
  Production reads `weights`, `defaultBillingCycle` and `maxBillingCycleDays`; limits come from
  the org config document.
- **Managed-gateway calls bill from a cost the *provider* reports, not from local rates.** pi-ai
  normally computes `local_rate × wire_tokens`, which cannot work for the gateway: it picks the model
  server-side per request, so the client has no rate to multiply and `buildCustomModel` zeroes them.
  Left alone, every managed call records `cost = 0` in `llm_logs`, `costToCredits` sees nothing,
  credits never accrue, and no test goes red. The gateway therefore returns its own cost in the usage
  object (OpenRouter's `usage.cost` convention — the OpenAI usage object has no cost field), and
  `frontend/patches/@earendil-works+pi-ai+0.80.6.patch` makes pi-ai honour it.
  `frontend/lib/llm/__tests__/gateway-cost.test.ts` drives a real local HTTP server speaking that exact
  wire format through the real `streamSimple`, so the patch is what is under test rather than a
  re-implementation of it; it pins that a malformed cost is ignored rather than corrupting the total,
  and that a reported `0` is a real value and not a fallback trigger. **Dropping the patch on a pi-ai
  bump silently zeroes managed-workspace billing.**
- **`SEARCH_CONFIGS` in `lib/search/file-search.ts` covers only `question`, `dashboard`, `folder`,
  `connection`, `context`.** A file of any other type is skipped silently (`if (!config) continue`),
  so stories, notebooks, reports and alerts are unfindable via `SearchFiles`.
- **`capSchemaResult` exists because one schema can exhaust the context window.** A wide
  warehouse serializes to millions of characters and the whole conversation is re-sent every
  turn; the cap keeps whole tables in order up to `SCHEMA_RESULT_MAX_CHARS` (60k) and annotates
  the truncation. The MCP `SearchDBSchema` tool does **not** apply it — only
  `agents/benchmark-analyst/db-tools.ts` does.
- **`captureError` dedups per tab for 60s and retries with backoff** (5 attempts,
  `lib/messaging/capture-error.ts`). It is in-memory only: a reload drops pending retries. It
  never throws — an error reporter that throws recurses.
- **`isSpreadsheetSource` is a structural guard, not a type assertion.** Persisted content may
  predate validation or be agent-authored; the declared type is never trusted.
- **ESLint gates that bite in these files:** no dynamic `import()` / `require()`, no direct
  `process.env` (use `lib/config.ts` or `lib/constants.ts`), and no module-level `Map`/`Set`
  without an inline justification — the disables in `capture-error.ts`, `slack/store.ts` and
  `slack/messages.ts` are that rule. API routes additionally cannot return
  `NextResponse.json(..., {status: 500})`. `lib/database/documents-db` is import-banned outside
  `lib/data/*.server.ts`, which is why everything here goes through `FilesAPI` / `ConnectionsAPI`
  / `getModules().db`.

### Key files

| Task | File |
|---|---|
| Register / route a frontend-bridged tool | `frontend/lib/tools/tool-handlers.ts` |
| Handler signature + `content` vs `details` contract | `frontend/lib/tools/handlers/types.ts` |
| Pause a tool for user input | `frontend/lib/tools/user-input-exception.ts` |
| Edit pipeline, validation gates, auto-execute | `frontend/lib/tools/handlers/edit-file.ts` |
| Screenshot + rubric core | `frontend/lib/tools/handlers/file-review.ts` |
| Chat UI chip/timeline config per tool | `frontend/lib/tools/tool-config.ts` |
| Add a job type | `frontend/lib/jobs/job-definitions.ts` + `frontend/lib/jobs/job-registry.ts` |
| Cron scan / dedup / run-file lifecycle | `frontend/lib/jobs/cron-scan.ts` |
| Manual run (`/api/jobs/run`) | `frontend/lib/jobs/run-job.ts` |
| Cron expression evaluation (with time zone) | `frontend/lib/jobs/cron.ts` |
| Message delivery dispatch | `frontend/lib/jobs/deliver-messages.ts` |
| Slack request handling end-to-end | `frontend/lib/integrations/slack/process-event.ts` |
| Slack Web API + signature verification | `frontend/lib/integrations/slack/api.ts` |
| Slack reply/chart extraction, mrkdwn, Block Kit | `frontend/lib/integrations/slack/messages.ts` |
| Slack bot config, channels, thread→conversation | `frontend/lib/integrations/slack/store.ts` |
| Add an app event | `frontend/lib/app-event-registry/events.ts` |
| Subscribe a handler to an app event | `frontend/lib/app-event-registry/index.ts` |
| Telemetry table writes | `frontend/lib/analytics/file-analytics.db.ts` |
| Credit math / gate / aggregation | `frontend/lib/analytics/credit-usage.server.ts` |
| Admin-configurable credit limits | `frontend/lib/analytics/credit-policy.ts` |
| Webhook transport + `{{VAR}}` substitution | `frontend/lib/messaging/webhook-executor.ts` |
| Route an unhandled rejection to its conversation | `frontend/lib/messaging/unhandled-rejection-logger.ts` |
| Event → webhook fan-out + enrichment | `frontend/lib/messaging/app-events-notifier.ts` |
| MCP tool surface | `frontend/lib/mcp/server.ts` |
| File / schema search ranking | `frontend/lib/search/file-search.ts`, `frontend/lib/search/schema-search.ts` |
| Direct-data question validation + cache key | `frontend/lib/spreadsheet/materialize.ts` |

**Why file edits go through markup at all.** A June-2026 investigation measured a ~42% `EditFile` tool-call failure rate, and all three failure modes shared one cause: the model hand-authoring exact-match edits over escaped, minified JSON-inside-JSON — `changes` arriving as a stringified array, an `oldMatch` that does not appear in the minified target, and edits that produce invalid JSON. The worst case, a story stored as HTML, escaped into a JSON string, inside a JSON tool argument, was three layers of escaping. The fix was to hand the agent one JSX-shaped document of raw text in which structured config is a JSON literal inside `{}` — JSX props are not strings, so nothing needs escaping. Do not add a tool that asks the model to edit escaped JSON, whatever the convenience.

---

## API & Page Routes (`frontend/app`)

### What this layer owns — and what it does not

`frontend/app` is the Next.js App Router tree: 119 `route.ts` handlers plus 15 page routes and three
error boundaries (`error.tsx`, `global-error.tsx`, `not-found.tsx`). Its job is **HTTP adaptation only**:
parse and shape-check the request, resolve the caller, delegate to a `lib/` module, and map the outcome
onto a status code. Total across every route file is ~6800 lines; the largest is
`api/conversations/[id]/stream/route.ts` at 210 lines and 84 of the 119 are under 60.

It owns: request parsing/validation, auth and role gating at the edge, HTTP status/response shaping,
streaming envelopes (SSE, NDJSON), CORS headers on the public protocol endpoints, and `revalidateTag`
cache busting after mutations.

It does **not** own: business logic, database access, LLM orchestration, or permission *rules*. No
non-test file under `app/` imports `DocumentDB` — data access goes through `FilesAPI` /
`ConnectionsAPI` / `ConfigsAPI` (`lib/data/*.server.ts`). Access checks are enforced *inside* those
modules (`loadFile` is access-checked; `addShare`/`getShares` enforce admin + story type); routes that
add a role check on top are adding a second layer, not the only one.

### Auth: three stages, and the two that routes can skip

```
request
  └─ middleware.ts → lib/middleware/create-middleware.ts
       · public allowlist (login/register, /l/, /s/, /oauth, /.well-known/oauth,
         /api/auth, /api/orgs/register, /api/mcp, /api/health, /api/jobs/cron,
         slack events|interact|oauth-callback)  → pass through
       · otherwise require NextAuth session + CURRENT_TOKEN_VERSION, else redirect /login
       · stamps x-request-id, x-request-path, x-user-id, x-mode, x-view,
         x-impersonate-user (admins only), E2E header
  └─ route handler
       · withAuth(handler)  → getEffectiveUser() reads those headers → EffectiveUser
       · or a bespoke gate (see below)
```

`lib/http/with-auth.ts` exports two wrappers. `withAuth` 401s when `getEffectiveUser()` returns null, and
wraps the handler in a try/catch that publishes `AppEvents.ERROR` (skipping client aborts, matched by
`isClientAbortError`) and then **rethrows**. `withCronAuth` accepts only `Authorization: Bearer
$CRON_SECRET` and — deliberately — answers a bad/absent secret with `200 {ok:true}` rather than 401, so a
misconfigured scheduler doesn't alarm.

Routes that do not use `withAuth` fall into four groups, all verified:

| Gate | Routes |
|---|---|
| `getEffectiveUser()` inline | `api/files/search`, `api/conversations`, `api/recordings/**`, `api/micro-task`, `api/llm-logs`, `api/capture-error`, `api/benchmark/import`, `api/jobs/test`, `api/chat/debug-context`, `api/viz/backfill`, `api/object-store/{upload-url,local-upload}`, `api/conversations/[id]/{stream,llm-calls}` |
| NextAuth `auth()` session | `api/users`, `api/users/[id]`, `oauth/authorize/approve` |
| bespoke credential | `s/[code]/*` (bearer code via `lib/http/with-remote-session-auth.ts`), `api/mcp` (OAuth bearer via `lib/mcp/auth.ts`), `api/integrations/slack/{events,interact}` (HMAC signature), `api/integrations/slack/oauth-callback` (signed state), `api/test/faux/*` (`E2E_MODE` flag) |
| middleware session only, no in-route identity | `api/sql-to-ir`, `api/ir-to-sql`, `api/llm-calls/[callId]`, `api/object-store/serve/[...key]` |
| public by design | `api/health`, `api/auth/*`, `api/orgs/register`, `api/share/guest-session`, `l/[shareId]/og`, `s/[code]`, `oauth/{token,register}`, `.well-known/oauth-*` |

### The `handleApiError` contract, and every deviation

`lib/http/api-responses.ts` defines the shape all JSON APIs are supposed to speak:
`{ success, data | error: { code, message, details?, type? }, request_id? }`. `handleApiError` maps
`UserFacingError` subclasses onto status codes (`FileNotFoundError`→404, `AccessPermissionError`→403,
`FileExistsError`→409), falls back to substring sniffing on the message (`'not found'`, `'already
exists'`, `'validation'`), and otherwise returns a 500. It also `console.error`s and, via the
`AppEvents.ERROR` fan-out, reaches internal Slack.

The ESLint rule lives in `eslint.config.mjs` and is scoped to `files: ["app/api/**/*.ts"]`. It bans
exactly one AST shape: `NextResponse.json(...)` containing a `status: 500` property. Consequences worth
knowing:

- **Non-`api/` routes in this tree fall outside the glob entirely** — `oauth/token`, `oauth/register`,
  `oauth/authorize/approve`, the five `s/[code]/*` handlers, `l/[shareId]/og`, and both `.well-known/`
  routes. The `s/[code]/*` handlers still get the standard treatment because
  `withRemoteSessionAuth` calls `handleApiError` in its own catch; the others do not.
- The rule only catches the literal `500`. A route that returns a raw 401/403/400 `NextResponse.json`
  passes lint while still breaking the response shape — `api/files/search`, `api/jobs/test`,
  `api/viz/backfill`, `api/object-store/{local-upload,serve}`, `api/micro-task` and `api/recordings` all
  do this.
- Deliberate deviators: **`api/query`** catches everything and returns `ApiErrors.badRequest` — a failed
  query is the query's fault, not the server's, and a 4xx keeps the client from paging the team via
  `capture-error`; `handleApiError` is only reached for non-`Error` throws. **`api/jobs/test`** shapes
  its errors as `Partial<TestRunResult>` so the eval UI can render them uniformly. **`api/mcp`** and
  `oauth/token` speak JSON-RPC and OAuth error shapes respectively.
- Eight `withAuth` routes wrap **no outer try/catch**, so an unexpected throw is rethrown by the wrapper
  and becomes a Next.js framework 500 rather than the standard envelope: `api/validate-sql` (inner
  try only), `api/autocomplete`, `api/chat/mentions`, `api/skills/system`, `api/tools/schema`, and
  `api/integrations/slack/{oauth-start,manifest,oauth-configured}`. `l/[shareId]/og` has neither a
  try/catch nor a wrapper.

### Route groups

**Conversations / chat.** The browser's chat entry points (Slack goes in-process; `s/[code]/tool` and
`api/mcp` are separate agent surfaces onto the same log). `POST api/conversations/[id]/turns` claims the run
lease and NOTIFYs *synchronously*, then fires `runConversationTurn` **detached** (`void
runInContext(...)`) and returns immediately; `GET api/conversations/[id]/stream` is the resumable SSE
tail. Supporting routes: `interrupt` (Stop), `fork` (edit-and-fork at `atSeq`), `title` (cheap
post-first-turn poll), `screenshots/[callId]` (lazy image extraction from the stored full log),
`llm-calls` (admin-only debug), `remote-session` (mint/stop/status). `api/conversations` itself is
keyset-paginated metadata only. Aux: `api/chat/{feedback,log-error,mentions,debug-context}`.

```
POST /api/conversations/:id/turns
  ├─ owner+mode check · runStatus guards (remote → 409, running → {alreadyRunning})
  ├─ boundContextAppState(agentArgs.app_state)   ← server-side OOM backstop
  ├─ acquireRunLease + notifyStatus('running')   ← BEFORE returning
  └─ void runConversationTurn(…)                 ← detached; 200 {started:true}
GET  /api/conversations/:id/stream?since=&view=
  └─ flushCatchup → subscribe(LISTEN/NOTIFY) → {message|delta|status|pending|done}
```

**Query.** `api/query/route.ts` is the one place SQL is executed for the browser, and its **statement
order is load-bearing** (proven by `api/views/__tests__/query-route-views.test.ts`): guest guard →
whitelist validation → dialect resolution → view inlining → cache/lease/execute. Dialect comes from
`ConnectionsAPI.getRawByName`, never `FilesAPI.loadFile` — a regression guarded by
`api/query/__tests__/query-route-no-profiling.test.ts`. The response is plain NDJSON
(`application/x-ndjson`) with metadata in `X-Cache` / `X-Cached-At` / `X-Row-Count` headers.
`api/query-estimate` reads p50/p90 from `query_execution_events` for the progress UI.

**Files & folders.** `api/files` (list/create), `api/files/[id]` (GET/PATCH/DELETE),
`api/files/{batch,batch-save,batch-move,by-path,search,template}`, `api/folders`, plus per-file
subresources `api/files/[id]/{share,preview,rubric}`. PATCH is overloaded: `content === undefined` means
a metadata-only `moveFile`, anything else is a full `saveFile`. Saving a `config` busts the `configs`
cache tag; saving a `context` re-runs the loader with `{refresh:true}` because `saveFile` strips
`fullSchema`.

**Connections, contexts, semantic models, views.** `api/connections` (+ `[name]`, `test`) wrap
`lib/data/connections.server.ts`; `force_refresh=true` busts the `database-schema` tag.
**There is no `/api/contexts` route** — contexts are a file type and are read through `api/files`. A
`contexts.list` entry pointing at `/api/contexts` still exists in `lib/http/declarations.ts` (as does
`completions` → `/api/completions`); both would 404. `api/semantic-models` is a single POST that
multiplexes four modes off the body (`testModel` → save-gate test, `sql` → detect, `q` → field search,
`tables` → scoped models). `api/views/{prepare,promote}` are the view save gate and question→view
promotion.

**Jobs.** `api/jobs/cron` (`withCronAuth`, per-minute external scheduler → `runForOrg` + `runCreditResets`),
`api/jobs/run` (manual/forced → `runJob`, whose typed outcome union maps 1:1 to status codes),
`api/jobs/runs` (history), `api/jobs/test` (single eval Test via `createServerRunner`).

**Auth, orgs, users.** `api/auth/[...nextauth]` re-exports the NextAuth handlers; `check-2fa`,
`send-otp` (phone 2FA *or* passwordless email), `verify-otp` (stateless JWT round-trip) sit beside it.
`api/orgs/register` is the workspace bootstrap (gated by `ENABLE_ORG_CREATION`), `api/orgs/seed-status`
polls the fire-and-forget mxfood copy. `api/users` + `api/users/[id]` use `auth()` directly rather than
`withAuth` and do their own admin-vs-self authorization.

**Admin / settings-backing.** `api/admin/{db-version,validate-db,migrate-db,export-db,import-data,
reset-tutorial,migrate-conversations-v3}` — all `isAdmin`-gated behind `withAuth`. `reset-tutorial`
wipes `/tutorial` and `/internals` back to `workspace-template.json` and deliberately never touches
`/org`. Also admin: `api/cache/clear`, `api/llm/{registry,test}`, `api/llm-logs` (DELETE),
`api/credits/{events,reset}`, `api/tools/{schema,execute}`, `api/viz/backfill`, `api/test-error`
(additionally `IS_DEV`-gated, 404 in prod), and the Slack management routes
`api/integrations/slack/{oauth-start,oauth-configured,manifest,manual-install,test-message,bots/[teamId]}`.

Two admin routes break the `isAdmin`-behind-`withAuth` pattern, both because of the data-version gate.
`api/admin/migrate-db` uses `withAuthSkippingDataVersionGate` — it is the route that clears a failing
gate, so gating it would make the refusal unescapable. `api/admin/min-data-version` uses `withCronAuth`
(shared secret, no session) and sits in the middleware's session-exempt list; it reports the oldest
data version this deployment serves, for deploy tooling that has no session. It is distinct from
`api/admin/db-version`, which is session-gated and reports the version of the workspace making the
request. It returns only the minimum — anything richer is a database query away for whoever
legitimately needs it, and this endpoint is reachable with a shared secret.

`api/gateway/status` backs the plan-and-balance panel, and its **guard order is deliberate**: it
returns `{enabled: false}` for a workspace with no stored `gateway.orgSecret` *before* the admin check,
because such a workspace is not in a broken state and has no spend to protect; the `role !== 'admin'`
403 sits after it, since spend is org-wide. The org secret is resolved server-side and only the
resulting numbers come back (`app/api/gateway/__tests__/status.test.ts` asserts neither the raw secret
nor its `@SECRETS/…` ref appears in the response). A gateway outage returns
`{enabled: true, reachable: false}` rather than an error, so the panel can say "temporarily
unavailable" instead of rendering a stale zero.

**Remote agent sessions.** Public bearer surface under `s/[code]/`: the skill-doc markdown page
(`s/[code]/route.ts` — assembled per request from live connections + `RemoteSessionAgent.tools`),
`context`, `tool`, `result/[toolCallId]`, `end`. All but the doc page use `withRemoteSessionAuth`, which
resolves the code, applies a 60-calls/60s per-conversation in-memory rate limit, and hands the handler
the conversation plus the **owner's** `EffectiveUser`.

**Public share.** `api/share/guest-session` mints/refreshes the `mx-guest` cookie from a share nonce;
`api/files/[id]/share` manages the links (admin-only); `api/files/[id]/preview` composes and stores the
social card; `l/[shareId]/og` serves it. Guest scoping downstream is enforced by `getEffectiveUser` plus
the `user.guest` branch in `api/query`.

**MCP + OAuth.** `api/mcp` is one Streamable-HTTP endpoint (POST tool calls, GET SSE, DELETE terminate)
with an in-memory session map pinned to `globalThis` so it survives HMR, pruned every 30 minutes.
Discovery and issuance live in `.well-known/oauth-authorization-server`,
`.well-known/oauth-protected-resource`, `oauth/register` (RFC 7591 dynamic registration that always
returns the single public client `minusx-mcp`), `oauth/authorize` (+ `approve`), and `oauth/token`
(PKCE authorization_code, plus single-use rotating refresh tokens — covered by
`oauth/token/__tests__/refresh-flow.e2e.test.ts`).

**Object store.** `api/object-store/upload-url` issues presigned PUTs restricted to an allowlist of MIME
types (so an authenticated user can't host `text/html` under the app's S3 domain). When no S3 is
configured the client transparently uses `local-upload` (PUT, path-traversal guarded) and
`serve/[...key]` instead.

**Test hooks.** `api/test/faux/{route,reset,received}` register/clear/read the faux LLM channel and 404
unless `E2E_MODE`. `api/test-error` deliberately throws to exercise the reporting path.

**Utility cluster.** `api/{sql-to-ir,ir-to-sql,validate-sql,infer-columns}` run WASM SQL tooling;
`api/{autocomplete,column-suggestions,table-suggestions,chat/mentions}` are thin wrappers over
`CompletionsAPI`; `api/micro-task` runs a single-turn, no-tools LLM helper with no persisted
conversation; `api/story-css` compiles Tailwind for *staged* (unsaved) story drafts using the same
compiler as the save path; `api/viz/validate` is the browser's only route to the server-side Vega-Lite
validator (the 1.4 MB vendored schema must never ship to the client).

### Page routes

Only four pages are server components — `l/[shareId]`, `login`, `register`, `oauth/authorize`; the
other eleven are `'use client'`. `layout.tsx` is the only SSR data boundary: `loadInitialState()` resolves the effective
user and the org config and hands them, plus runtime flags (`maxConcurrentQueries`, `queryTimeoutMs`,
`analyticsConfig`, `disableAppStateImages`, `creditsEnabled`, `e2eEnabled`), to `Providers` as Redux
`preloadedState`. **Contexts and connections are not SSR-preloaded** — they arrive via hooks after
mount. `layout.tsx` also stamps the telemetry level on `<html>` for the prebuilt client bundle, injects
org styles, and redirects to `/hello-world` when `setupWizard.status !== 'complete'`.

The rest: `page.tsx` (home feed), `p/[[...path]]` (folder browser; middleware redirects bare `/p` to
`/p/{mode}`), `f/[id]` (file detail; the id segment may be slugged, `parseFileId`), `explore/[[...id]]`
(full-page chat — uses `useParams()` rather than `use(params)` to avoid remounting `ExploreInterface`),
`new/[type]` (creates a draft then `router.replace`s to `/f/{id}`), `l/[shareId]` (public story landing;
server-renders metadata, body is client-only), `settings`, `conversations`, `recordings`, `benchmark`,
`hello-world` (onboarding wizard, `ssr:false`), `login`, `register`, `oauth/authorize`.

### Interactions with other areas

- **← `lib/file-state/`**: the client `FilesAPI` and `lib/file-state/query-results.ts` are the callers of
  `api/files*` and `api/query`. Client query calls are bounded by `querySemaphore`, whose limit is read
  live from `configsSlice.maxConcurrentQueries` — which this tree seeds via `layout.tsx`. So the
  concurrency cap on `/api/query` is configured by a page route, not by the API route.
- **← `lib/hooks/useConversation.ts` / `lib/data/conversations.ts`**: drive the turns/stream pair. The
  browser is also the executor for frontend-bridged tools — it posts `completedToolCalls` back to
  `turns` to resume a paused orchestrator run.
- **→ `lib/chat/orchestration-core.server.ts`**: `turns` (via `lib/chat/conversation-turn.server.ts`),
  `api/tools/{schema,execute}` and `api/chat/debug-context` all read the same `REGISTRABLES` registry the
  live chat uses. Slack bypasses these routes entirely — `lib/integrations/slack/process-event.ts` calls
  the orchestration core in-process.
- **→ `lib/data/*.server.ts`**: the sole data boundary. `lib/data/files.server.ts` enforces ACLs, so a
  route omitting a role check is not necessarily a hole.
- **→ `lib/app-event-registry`**: routes publish (`QUERY_EXECUTED`, `FILE_VIEWED`, `FEEDBACK`, `ERROR`,
  `SHARE_OPEN`, `SHARE_LEAD`, `CREDIT_RESET`, `USER_MESSAGE`); analytics handlers subscribe centrally.
  Never call analytics directly from a route.
- **← `middleware.ts`**: upstream contract for `x-user-id` / `x-mode` / `x-view` / `x-request-id`.
  Anything not in the middleware allowlist is session-gated before the handler ever runs, which is why
  several routes carry no in-route auth.
- **← tests**: `frontend/test/harness/mock-fetch.ts` mounts these real handlers in-process for the `node` Vitest
  project, and `frontend/test/qa/*.spec.ts` drives them through a real browser in tutorial mode. Route handlers
  are imported and called directly in `app/**/__tests__/*.test.ts`.

### Gotchas

- **`api/query` returns 400 for query failures, not 500.** The client's `parseErrorMessage` and
  `captureError` both key off that. Changing it to `handleApiError` would start paging the team on every
  user typo.
- **View resolution sits between whitelist validation and the cache on purpose.** A view is authorized as
  itself (it appears in the whitelisted schema, so it can expose an aggregate over tables the reader
  can't query directly — its own SQL is validated where it is *authored*), and the cache key is computed
  over the *resolved* SQL, so editing a view body invalidates results for free. Non-view queries take a
  byte-identical fast path and are never parsed.
- **`forceRefresh` is ignored for guests** — public shares stay cache-served so they can't be used to
  hammer the warehouse.
- **`api/validate-sql` calls `FilesAPI.loadFile` on the connection** — the exact schema-profiling call
  `api/query` was changed to avoid. It is off the hot path, but do not copy the pattern.
- **`turns` claims the lease before returning.** Reordering this so the detached runner claims it lets a
  client open the stream and see a premature `idle`, or a heartbeat-less `running` that reads as
  orphaned. For an `autoRetry` the *old* `runStartedSeq` is preserved — overwriting it with `maxSeq+1`
  would point the truncate past the crashed rows.
- **A `stream` setup failure looks like success.** The route returns the SSE `Response` immediately and
  drives catch-up/subscribe in a detached async IIFE whose `.catch()` only logs and closes the writer.
  A failure there reaches the client as a 200 SSE stream that ends with zero events — no error status,
  no `AppEvents.ERROR`.
- **Stream liveness is polled, not just notified.** A NOTIFY only fires while the owner process is alive,
  so `stream` re-checks the lease every 15 s; without that a reconnect onto an already-dead turn would
  tail forever. Correctness is the cursor plus the catch-up SELECT — a dropped NOTIFY is harmless.
- **Reads and mutations use different predicates on conversations.** `canReadConversation` admits any
  admin by direct id; `ownsConversation` (DELETE/PATCH) and the inline owner+mode checks
  (turns/interrupt/fork/screenshots/remote-session) do not. Verified by
  `api/conversations/[id]/__tests__/admin-read-access.test.ts`.
- **`api/llm-calls/[callId]` has no role check** while its sibling `api/conversations/[id]/llm-calls` is
  admin-only — yet both serve raw pi-format request blobs containing full system prompts and
  conversation content. Any logged-in user can read any call by id.
- **`api/files/batch` intentionally bypasses `appEventRegistry.publish(FILE_VIEWED)`** in favour of one
  batched `trackFileEvents` insert. Per-file event publish (and its webhook fan-out) is dropped on
  purpose for bulk loads; restoring it reintroduces the N+1 insert storm.
- **`revalidateTag('configs', 'default')` takes two arguments.** That is the Next 16 signature (tag +
  cache profile), not a stray parameter. Same for `revalidateTag('database-schema', 'default')`.
- **`withCronAuth` answers a bad secret with `200 {ok:true}`.** Do not read a 200 from `api/jobs/cron` as
  proof that the scan ran.
- **The MCP session map lives on `globalThis`** to survive HMR; a dev-server restart drops every live MCP
  session.
- **`middleware.ts` still allowlists `/api/public/slack-chart`, which no longer exists.** Harmless, but
  do not treat the allowlist as an inventory of real endpoints.
- **`E2E_MODE` gating is a runtime 404, not a build exclusion** — `api/test/faux/*` files ship in the
  production bundle and answer 404. `api/test-error` behaves the same way behind `IS_DEV`.
- **QA flows must carry `mode=tutorial` on every request.** The system default is `org`; a missing mode
  parameter silently writes to production data.

### Key files

| Task | File |
|---|---|
| Response/error envelope, `ApiErrors`, `handleApiError` | `frontend/lib/http/api-responses.ts` |
| Session/cron auth wrappers | `frontend/lib/http/with-auth.ts` |
| Bearer auth + rate limit for `/s/<code>/*` | `frontend/lib/http/with-remote-session-auth.ts` |
| Header stamping, public allowlist, impersonation, mode | `frontend/middleware.ts`, `frontend/lib/middleware/create-middleware.ts` |
| The 500-shape lint rule (`app/api/**` only) | `frontend/eslint.config.mjs` |
| Query execution order, guest guard, cache headers | `frontend/app/api/query/route.ts` |
| Chat turn start (detached run, lease, remote guard) | `frontend/app/api/conversations/[id]/turns/route.ts` |
| Resumable SSE, stale-lease recovery | `frontend/app/api/conversations/[id]/stream/route.ts` |
| File CRUD + the PATCH move/save overload | `frontend/app/api/files/[id]/route.ts` |
| SSR preloadedState, telemetry stamp, wizard redirect | `frontend/app/layout.tsx` |
| External-agent protocol contract (the skill doc itself) | `frontend/app/s/[code]/route.ts` |
| MCP transport + session store | `frontend/app/api/mcp/route.ts` |
| Proof the query path never profiles schemas | `frontend/app/api/query/__tests__/query-route-no-profiling.test.ts` |
| Proof of whitelist → views → cache ordering | `frontend/app/api/views/__tests__/query-route-views.test.ts` |
| Proof of admin-read vs owner-mutate asymmetry | `frontend/app/api/conversations/[id]/__tests__/admin-read-access.test.ts` |
| End-to-end turn POST + stream GET + interrupt | `frontend/app/api/conversations/[id]/__tests__/stream-turns.test.ts` |

---

## UI Components (`frontend/components`)

Everything the browser renders except the chart engine itself. `components/viz/` (Vega) and
`components/plotx/` (DOM-tier tables, viz config panels, download helpers) are a separate area;
this tree consumes them and never reimplements them.

### What each module owns

| Module | Owns | Does NOT own |
|---|---|---|
| `containers/` | All Redux reads/writes for a file page; derives props for its view | Any presentation |
| `views/` | Pure presentation of one file type | Redux, fetching, save/publish |
| `kit/` | Vendored shadcn primitives (Radix + Tailwind + `cva`) | App state, Chakra, data |
| `ui/` | The surviving Chakra wrappers (`toaster`, `select`, `checkbox`, `close-button`, `color-mode`, `resizable-panel`, `ImageLightbox`, `GenerateButton`) plus the Chakra-free `Link`/`Dither` | Anything on the kit stack |
| `file-browser/` | The file page shell: `FileLayout` → `FileView` → `FileHeader` + type container; folder/list/grid browsing, drag-move, bulk select | File-type rendering (delegated) |
| `explore/` | The whole chat surface: composer, transcript, timeline/carousel, per-tool displays, debug modals | Tool *config* (`lib/tools/tool-config.ts`) and tool *execution* (`lib/tools/handlers/*`) |
| `app-shell/` | Providers, sidebars, create menu, mobile chrome, localStorage→Redux flag hydration (`DataLoader`) | Page content |
| `question/`, `params/`, `query-builder/`, `lexical/` | Question workbench pieces: viz dispatch, parameter widgets, Monaco SQL + semantic explorer, the Lexical rich-text editor with `@`-mentions | Chart rendering |
| `modals/`, `selectors/`, `schema-browser/`, `screenshot/`, `banners/`, `share/`, `dev/`, `Markdown/` | Cross-cutting leaf surfaces | — |
| `settings/`, `context/`, `connection-wizard/`, `evals/`, `config/` | Admin/authoring surfaces (users, LLM models, integrations, context + semantic-model editing, onboarding wizard, eval authoring, the custom-agent builder). All still Chakra. | — |

Direction of dependency on the chart area: `views/QuestionViewV2.tsx` and
`views/notebook/NotebookSqlCell.tsx` import `components/plotx/` config panels and
`components/viz/` renderers directly. Views compose plotx/viz; plotx/viz never import views.

### Container / View separation

Enforced by convention *and* by ESLint. `frontend/eslint.config.mjs` defines `RESTRICT_VIEW_REDUX`
(bans `@/store/hooks` and `react-redux`) and applies it to a hardcoded list of view files. The
convention currently holds across the whole `views/` tree: the only two files under
`components/views/**` that import Redux at all are the two documented exceptions —
`views/story/InlineNumber.tsx` (a dynamically instantiated embed leaf, structural peer of the
embed containers) and `views/shared/StoryEmbeds.tsx` (imports `react-redux`'s `Provider` to
*re-provide* the store to a nested iframe root, not to read it).

```
app/f/[id]/page.tsx
  └─ FileLayout (breadcrumb, right sidebar, edit banner)
       └─ FileView                      ← useFile(id); picks visual vs Code
            ├─ FileHeader               ← name/description, edit mode, save, publish, Present
            └─ getFileComponent(type)   ← lib/ui/fileComponents.tsx
                 └─ <Type>ContainerV2   ← ALL Redux for the page
                      └─ <Type>View     ← props only
```

`FileView` centralizes the visual-vs-code decision: when `uiSlice.fileViewMode[id] === 'json'` it
renders `views/CodeView.tsx` (editable JSON + read-only agent XML via `fileToMarkup`) instead of
the type view. No type view carries its own JSON branch.

Two generic bridges let a view push chrome up into the shared header without a command bus:
`file-toolbar/FileToolbarContext.tsx` (`useFileToolbarActions(memoizedActions)` in the view →
`useFileToolbar()` in `FileHeader`) and `file-toolbar/PresentationContext.tsx` (native Fullscreen
API via `useSyncExternalStore`; `FileHeader` offers the toggle for `PRESENTABLE_TYPES`).

### The kit / Chakra split

Two design systems coexist. `components/kit/` is the Tailwind v4 + vendored-shadcn stack; app
shell, admin and form surfaces are Chakra v3. The boundary is not "new vs old" — it is a
**per-file allowlist** in `eslint.config.mjs` that bans `@chakra-ui/*` imports (and the Chakra
wrappers under `components/ui/`) in named files and whole trees. Inside this area the ban covers
`components/kit/**`, `components/question/**`, `components/params/**`, `components/query-builder/**`,
`components/lexical/**`, the rendered-document views (`QuestionViewV2`, `DashboardView`,
`NotebookView`, `ReportView`, `AlertView`, `CodeView`, `views/notebook/**`, `views/dashboard/**`,
`views/shared/empty-states.tsx`, `views/story/StoryParamControl.tsx`), the embed containers, and
a handful of named `shared/` and `selectors/` files. Everything else may still use Chakra.

The reason is not taste: rendered documents mount inside an iframe surface where Chakra/emotion
rules from the top document never reach. A Chakra style prop on a component that renders inside a
story or dashboard resolves to nothing.

### Chat UI

`explore/ChatInterface.tsx` is the single chat component; `app-shell/RightSidebar.tsx` mounts it
with `container="sidebar"` and `app/explore/[[...id]]/page.tsx` with `container="page"`.

There are **two independent "compact" notions**, and they are unrelated:

- `viewMode` = `'detailed'` when `uiSlice.showExpandedMessages` is on, else `'compact'` (default).
- `isCompact` = `container === 'sidebar' || containerWidth < 900` — pure layout density.

Routing by `viewMode`:

```
compact (default)                        detailed
─────────────────                        ────────
groupIntoTurns(allMessages)              allMessages.map(...)
  └─ AgentTurnContainer (memo)             └─ SimpleChatMessage per message
       ├─ SimpleChatMessage (user msg)          └─ role==='tool' → ToolCallDisplay
       ├─ buildTimeline() → TimelineNode[]           └─ getToolConfig(name).displayComponent
       │    ├─ CompactTimelineBar   (isCompact)
       │    └─ VerticalTimelineRail (wide)
       │         └─ AgentTurnDetailPane
       │              ├─ 'agent' → thinking/content box
       │              ├─ 'query' → ChartCarousel
       │              └─ 'tool'  → DETAIL_CARD_BY_TOOL → DetailCarousel
       ├─ PendingClarifyPanel (outside the working area)
       └─ SimpleChatMessage (last reply → ToolCallDisplay → ContentDisplay)
```

So `ToolCallDisplay` is reached in **both** modes: as the per-message row in detailed, and via the
turn's user message / final reply in compact.

`buildTimeline` (`explore/agentTurnTimeline.ts`) collapses the flat message list into nodes:
`CHAT_TOOLS` messages coalesce into `agent` nodes, `ExecuteQuery` into `query` nodes, everything
else into `tool` nodes keyed by `getToolConfig(name).chipLabel` (so `SearchFiles` and
`SearchDBSchema` merge — both label `search`). The **last** chat message is spliced out of the
timeline and rendered below the working area as the reply.

Per-tool presentation is configured in `lib/tools/tool-config.ts` (not under `components/`):
`{ displayComponent, chipLabel, chipLabelPlural, chipIcon, timelineVerb }`, with
`DEFAULT_TOOL_CONFIG` for unknown tools. Each per-tool display file in `explore/tools/` exports a
default (the compact row) and, where it appears in the carousel, a named `*DetailCard`
(`WebSearchDisplay.tsx` is carousel-only and has no default export; `DetailCarousel.tsx`,
`ChartCarousel.tsx` and `StreamingProgress.tsx` are shared infrastructure, not tool displays).
Two independent null
switches exist: `displayComponent: null` in `tool-config.ts` suppresses the compact row
(`ClarifyFrontend`, `LoadSkillFrontend`, `WebSearch`), and a `null` value in `DETAIL_CARD_BY_TOOL`
(`explore/AgentTurnDetailPane.tsx`) skips the tool in the carousel — currently nothing uses the
latter, but the filter is live.

Interactive tools pause the orchestrator. `ToolCallDisplay` looks up the conversation by
`tool_call_id` (`makeSelectConversationByToolCallId`) and, if a `pending_tool_calls[].userInputs`
entry has `result === undefined`, renders `explore/UserInputComponent.tsx` instead of the tool
display. Answering dispatches `setUserInputResult` into `chatSlice` — the component never issues
HTTP; the chat middleware resumes the turn. Clarify answers are additionally stashed client-side
(`lib/chat/clarify-answer-stash`) so a reload before the resume turn commits doesn't re-ask.
**Exception:** when `conversation.remoteSession.active`, inline prompts suppress themselves and
`remote/RemoteSessionPrompts.tsx` is the sole renderer — a floating card stack on every page,
because a remote agent routinely navigates the user away from the session's chat view.

### Rendered-document surfaces

Stories and dashboards both render inside a **same-origin iframe** whose body contains an
`<svg><foreignObject>` surface (`lib/story-surface`, attribute `data-mx-story-svg`). React mounts
a *nested root inside that iframe document* — iframe DOM events don't bubble to the parent, so
delegation from the main root would never see clicks.

```
StoryContainerV2 → views/story/StoryView.tsx
      └─ views/shared/AgentHtml.tsx        ← builds the iframe, mounts the surface
           ├─ format:'jsx' → views/shared/StoryJsxBody.tsx  (lib/jsx parse → lib/story-ui render)
           └─ legacy HTML  → views/shared/StoryEmbeds.tsx   (portal per placeholder element)
                 └─ StoryEmbedProviders: Redux + Chakra + ark EnvironmentProvider re-provided

DashboardContainerV2 → views/shared/DashboardSurface.tsx  (same machinery, reused wholesale)
      └─ views/DashboardView.tsx  → react-grid-layout → WindowedTile → SmartEmbeddedQuestionContainer
```

`DashboardSurface` injects the generated chrome stylesheet (`lib/dashboard-surface/chrome-css.gen.ts`)
**inside** the surface root, so serializing the `<svg>` subtree is self-contained by construction.
Because the surface svg carries `STORY_SVG_ATTR`, the story capture path
(`findStorySvg`/`serializeStorySvg` in `lib/story-surface/serialize.ts`) picks dashboards up with no
dashboard-specific capture code. Main-document captures go through `lib/screenshot/serialize-element.ts`.

`views/dashboard/WindowedTile.tsx` renders off-viewport tiles as `data-mx-busy="true"` ghosts that
fill their grid cell (`h-full`, so total content height — which the marker math depends on — is
exact). Visibility is a rAF-throttled `getBoundingClientRect` composed up the frame chain, *not*
IntersectionObserver (IO never fires for `foreignObject` descendants) and *not* the tile's own
frame rect (the content-height iframe never scrolls, so every tile would read visible).

`DashboardView` deliberately does **not** use react-grid-layout's `WidthProvider`: its polyfill
observer is bound to the top realm and goes deaf inside the surface iframe. Width arrives via
`SurfaceWidthContext` (`lib/dashboard-surface/surface-width`), falling back to 1280px.

### Interactions with other areas

**Inbound — who renders this tree**

| Caller | Entry point | Contract |
|---|---|---|
| `app/f/[id]/page.tsx` | `FileLayout` + `FileView` | file id + path/name/type; everything else from Redux |
| `app/p/[[...path]]`, `app/page.tsx`, `app/conversations` | `FolderView`, `RecentFilesSection`, `Breadcrumb`, `InfiniteScrollSentinel` | plain props |
| `app/explore/[[...id]]` | `ExploreInterface` → `ChatInterface` | `container='page'` |
| `app/settings`, `app/new/connection`, `app/hello-world` | `settings/*`, `ConnectionWizard`, `ConfigContainerV2`/`StylesContainerV2` | plain props |
| `app/benchmark/page.tsx` | `AgentTurnContainer`, `groupIntoTurns`, `ExecutionTree`, `ToolDebugBar` | replays a stored conversation log through the *live* chat renderer — changing turn grouping changes benchmark output |
| `lib/story-ui/registry.ts` | `components/kit/*` | the story JSX interpreter's component registry IS the kit; renaming/removing a kit export breaks agent-authored stories |
| `lib/navigation/NavigationGuardProvider.tsx` | `modals/PublishModal` | unusual inbound edge: `lib/` renders a component |
| `lib/tools/tool-config.ts` | every `explore/tools/*Display` | imports the compact displays; `components/explore` imports `getToolConfig` back — the cycle is broken because `tool-config.ts` lives in `lib/` |

**Outbound — what this tree calls**

- **File & query state**: `lib/hooks/file-state-hooks.ts` (`useFile`, `useFolder`, `useQueryResult`)
  and `lib/file-state/file-state.ts` (`editFile`, `getQueryResult`, `applyStoryHtmlEdit`,
  `captureNotebookCellResult`). Containers use these; views never fetch.
- **Redux**: `store/filesSlice` (`selectMergedContent` = content + persistableChanges +
  ephemeralChanges), `store/uiSlice` (edit mode, view mode, view stack, chat flags),
  `store/chatSlice`, `store/authSlice` (`selectEffectiveUser`, `selectView`).
- **Permissions**: `lib/auth/access-rules.client.ts` — `canCreateFileByRole` is what containers use
  to derive `readOnly`. This is UI-layer defence only; the API routes and data layer re-check.
- **Capture**: components only *produce* the DOM contract; `lib/screenshot/*` consumes it.
  `data-file-id` (the capture anchor, stamped by each page view), `data-mx-busy` (readiness gate),
  `data-mx-story-svg` (surface svg), and `FORCE_MOUNT_TILES_EVENT` = `'mx-force-mount-tiles'`
  (`lib/screenshot/readiness.ts` → `WindowedTile`) are the four load-bearing strings.
- **Theming**: `data-mx-theme-host` must be present on any detached/portaled root
  (`file-browser/FileLayout.tsx`, `file-browser/ViewStack.tsx`, `kit/tooltip.tsx`,
  `kit/dropdown-menu.tsx`, `kit/select.tsx`) or the `app/theme-tokens.css` variables — scoped under
  `[data-mx-theme-host]`, never `:root` — don't resolve.
- **Tests**: `test/qa/*` and `test/e2e/*` drive this tree by `aria-label` only and read state via
  `window.__MX_STORE__`, which `app-shell/ReduxProvider.tsx` assigns only when the build-time
  `E2E_MODE` flag is set or the runtime QA opt-in (`?e2e=<secret>`) passes.
  A control without an `aria-label` is untestable by policy — add the label rather than working
  around it.

### Gotchas

- **The two ESLint guards are hardcoded file lists.** A newly added view is born *unguarded* by
  `RESTRICT_VIEW_REDUX`, and a newly added file outside the listed trees is born *outside* the
  Chakra ban. Both lists also name files that no longer exist — TransformationView.tsx and
  SvgPageSurface.tsx were deleted but never removed from the lists — so a name's presence in
  either list proves nothing about coverage.
- **Tailwind classes in the kit or in embed chrome need a codegen run.** Story CSS is compiled
  per-story from the story markup only; component chrome classes are pre-extracted into
  `lib/story-ui/recipe-classes.ts` from `components/kit/**` plus the explicit `EMBED_CHROME_FILES`
  list in `scripts/generate-story-ui-classes.ts`. Add a class to any of those and run
  `npm run generate-story-ui-classes` (and `npm run generate-dashboard-chrome-css`, which unions the
  same list) — otherwise the class silently emits nothing inside the iframe. The freshness test
  `lib/story-ui/__tests__/recipe-classes.test.ts` fails on a stale file.
- **`kit/popover.tsx` and `kit/tooltip.tsx` are patched shadcn.** No Radix `Portal` (or
  `portalled={false}`) because `position: fixed` is broken inside `foreignObject`; Radix's internal
  `[data-radix-popper-content-wrapper]` still sets `fixed`, which `STORY_FLOATING_CSS`
  (`lib/story-ui/floating.ts`) overrides to `absolute`. Re-vendoring shadcn upstream re-breaks
  story popovers.
- **`AgentTurnContainer` is `memo`'d with default equality and reads `state.files.files` with
  `shallowEqual`.** Passing an unmemoized callback from `ChatInterface`, or switching the selector
  to a plain read, reintroduces a full re-render of every turn on every streaming chunk (guarded by
  `components/__tests__/chat-rerender.ui.test.tsx`).
- **`ChatInput`/`LexicalMentionEditor` memo comparators deliberately ignore `onSend`/`onSubmit`
  identity.** They assume a reference-stable callback; passing a fresh closure makes Enter send the
  mount-time (empty) input while the editor clears. Two regression tests pin this
  (`__tests__/chat-input-enter.ui.test.tsx`, `__tests__/chat-input-stable-onsend.ui.test.tsx`).
- **`DashboardContainerV2` uses a module-level `EMPTY_PARAMS` constant.** A fresh `{}` per render
  destabilizes `DashboardView`'s derived `effectiveSubmittedValues` and cascades into infinite
  query-retry loops.
- **Dashboard param fallback uses key-existence, not `??`.** `computeEffectiveSubmittedValues`
  (`lib/dashboard/effective-params`) applies a question's saved default only when the key is
  *absent*; an explicit `null` (None) or `""` is a real value and must survive.
- **`views/CodeView.tsx` is rendered by `FileView`, not by any type view.** Adding a JSON toggle to
  a view duplicates it.
- **`getFileComponent` is a partial map.** `lib/ui/fileComponents.tsx` has no entry for
  `context_run`; `views/ContextRunView.tsx` is mounted directly by `context/EvalsTabContent.tsx`.
  A file type with no entry renders the "Unsupported file type" branch of `FileView`.
- **UI tests query by `aria-label` only** (`getByLabelText`/`findByLabelText`). This is enforced by
  convention, not lint, and QA flows depend on it.

### Key files

| Task | File |
|---|---|
| Add a new file type page | `lib/ui/fileComponents.tsx` + a new `containers/<Type>ContainerV2.tsx` + `views/<Type>View.tsx` |
| Change the file page shell / header actions | `file-browser/FileView.tsx`, `file-browser/FileHeader.tsx` |
| Publish a toolbar button from a view | `file-toolbar/FileToolbarContext.tsx` |
| Change how a tool renders in chat | `lib/tools/tool-config.ts` + `explore/tools/<Tool>Display.tsx` (default = compact row, `*DetailCard` = carousel) |
| Change carousel routing / node → pane | `explore/AgentTurnDetailPane.tsx` |
| Change turn grouping or timeline nodes | `explore/message/groupIntoTurns.ts`, `explore/agentTurnTimeline.ts` |
| Chat composer, attachments, slash commands | `explore/ChatInput.tsx`, `explore/slash-commands.ts` |
| Interactive tool prompts (Clarify, confirmations) | `explore/UserInputComponent.tsx`, `explore/PendingClarifyPanel.tsx`, `remote/RemoteSessionPrompts.tsx` |
| Dashboard grid / tiles | `views/DashboardView.tsx`, `views/dashboard/WindowedTile.tsx`, `views/dashboard-assets.ts` |
| Dashboard iframe surface / capture self-containment | `views/shared/DashboardSurface.tsx` |
| Story iframe, embeds, WYSIWYG write-back | `views/shared/AgentHtml.tsx`, `views/shared/StoryJsxBody.tsx`, `views/shared/StoryEmbeds.tsx` |
| Question workbench (SQL, params, viz panel) | `views/QuestionViewV2.tsx`, `question/QuestionVisualization.tsx`, `query-builder/SqlEditor.tsx`, `params/ParameterRow.tsx` |
| Notebook cells | `views/NotebookView.tsx`, `views/notebook/NotebookSqlCell.tsx` |
| shadcn primitive (also the story component registry) | `components/kit/*` |
| Empty / new-file hero | `views/shared/empty-states.tsx` |
| Right sidebar & app chrome | `app-shell/RightSidebar.tsx`, `app-shell/Sidebar.tsx`, `app-shell/DataLoader.tsx` |

**The WYSIWYG text host freezes its subtree while focused.** `StoryJsxBody` treats a focused editable host as prop-equal so React bails out and never reconciles it — without that, any upstream re-render (an embed refetch, a param change, a Redux update elsewhere) reconciles mid-keystroke and clobbers what the user is typing. A render that must happen anyway commits the in-progress edit first. Edits commit on blur by writing back into the JSX **AST** by `data-mx-ast` path, never by scraping the rendered DOM, and only after real user input — programmatic focus churn does not commit. Because the host is rich `contentEditable`, the write-back has to preserve inline elements (`<strong>`, `<em>`, links); a plaintext-only commit silently strips them. The parsed result runs through the same `validateJsxSource` and prop deny list as agent-authored markup — pasted HTML is untrusted input, and there is no editor-trusted parse.

**The format toolbar mutates the live DOM first and the source second — both, every time.**
`components/views/story/StoryTypographyToolbar.tsx` renders in the PARENT document (the iframe's rect
offsets the anchor) and, on every control, computes the next class string or style value from the host
element's *live* attributes via the pure algebra in `lib/data/story/typography.ts`, writes it straight
onto the element, and only then emits it through `applyFormatEdit` → `applyFormatEditsToJsx`. The DOM
write is not an optimisation: the focused text host is render-frozen by the memo guard, so a React
re-render cannot deliver the change at all. The commit path is deliberately whole-value — the full
resolved `className` and the full inline `style` string — so a stale AST read can never merge two
partial edits. Text colour and fill are inline styles, not classes, because a class palette cannot
cover a colour picker's range.

The toolbar anchors to one of **three** target kinds, and they do not offer the same controls.
`'text'` is a focused contenteditable host and gets everything. `'text-element'` is a click-selected
`div`/`p`/heading/`span` parent — also full typography, because setting it on the parent is how a
style inherits into all its children. `'element'` is any other click-selected container, which hides
font size, B/I/U and text colour, since those are meaningless on a container; alignment, fill, width,
spacing, padding and bleed remain. Click-selection marks the target `data-mx-selected`, with
`data-mx-hover` previewing what a click would take; embeds are never selectable, since their chrome is
interactive. A breadcrumb of the selectable ancestor chain (outermost first, labelled via `crumbHint`)
re-anchors the selection up the tree — the reason the toolbar can style a wrapper the user cannot
easily click. Both marker attributes are render artifacts caught by the `data-mx-*` prefix strip in
`jsx-edit.ts`, so neither can reach stored source.

**Every agent edit remounts the story iframe, and two defenses keep the page still.** `AgentHtml` is
keyed on the story hash, so an edit tears the iframe down; the fresh one measures ~0px and regrows
asynchronously as embeds hydrate, and the browser clamps the scroll container toward the top on the
way through. `lib/hooks/use-story-rebuild-stability.ts` owns both defenses under one `ResizeObserver`:
the story box's `min-height` is pinned to the last stable measured height during render
(adjust-state-during-render, so the style lands in the same commit as the child's remount), and the
pre-rebuild `scrollTop` is snapshotted in an **insertion** effect — the only phase that still sees the
old position, since layout effects run after the fresh iframe has already sized to zero. The pin
releases only once the rebuilt content has regrown past it or after `MAX_PIN_MS`, never on a mere gap
in the resize stream: embeds waiting on query results stop resizing for far longer than the settle
debounce, and releasing there is exactly what used to clamp scroll to the top. A user scroll during
the rebuild cancels the restore. Separately, `preloadStoryFonts` registers the theme's faces once in
the TOP document via the FontFace API: the iframe's `@font-face` rules are `font-display: swap`, so a
cold cache repainted fallback text on every single edit.

**The agent authoring surface.** `components/context/AgentsTabContent.tsx` is the Agents tab of
`ContextEditorV2` (a structural mirror of `SkillsTabContent`): saved agents, read-only inherited ones
from `fullAgents`, and a raw-JSON variant. `components/context/AgentBuilder.tsx` is a four-step builder
(Identity → Prompt → Skills → Review) that **saves only at the end**, and whose Review step renders the
very component the saved card uses, `components/context/AgentReadView.tsx` — so what an author approves
is byte-for-byte what is stored, with no second formatting path to drift. The feature is alpha-gated on
`uiSlice.enableCustomAgents`: with the flag off the editor tab is not rendered *and* the chat picker
receives an empty option list, so no `custom_agent` pointer is ever sent. The gate is on both the
authoring and the sending side, not just the visible one.

**`components/settings/GatewayBillingCard.tsx` renders `null`, not an empty card, when there is no
gateway.** A self-hosted install is not in an error state — it simply has no billing — and an empty
card would be noise on every one of those settings pages. Two consequences of the same rule: a fetch
failure is treated as "unreachable" rather than thrown into the settings page, and a non-admin gets a
403 whose body carries no `data` key, which falls through to `{enabled: false}` and renders nothing.
The heading is "Plan & balance", never "Credits" — the credit-limits card sits directly below it, and
two adjacent cards with the same heading showing different numbers is unreadable.

**The inline `<Number>` query editor is a light-DOM dialog on purpose.** The story body renders inside the surface iframe, where Monaco's floating widgets (suggest, hover) mis-anchor, so `views/story/NumberQueryEditor.tsx` mounts the shared `query-builder/SqlEditor.tsx` in a Chakra `Dialog` at the `StoryView` level and hands the edited query back through the request's `apply` callback. Reuse rather than a hand-rolled `<textarea>` is the point: `SqlEditor` is a deep module (Monaco plus schema and `@`-reference autocomplete plus validation, behind `value`/`onChange`/`schemaData`), and the modal is the constraint the iframe imposes, not a styling choice.

**A parameter's declaration and its value are stored separately, and each file type declares differently.** A question declares in `QuestionContent.parameters` (`{ name, type: 'text'|'number'|'date', label, source }`) and holds values in `parameterValues`. A dashboard *auto-derives* its declarations by merging its questions' params on name+type. A story has no `params` field at all — but it has **two** storage shapes. A legacy story derives its declarations from `<div data-param-name=…>` placeholders inside `content.story` (inline-SQL sources ride along as a JSON `data-param-source-sql` attribute); a `format:'jsx'` story stores the `<Param/>` element **verbatim** in the body and has no placeholders anywhere. `markupToContent` picks the codec from the file's *stored* content, never from the incoming markup. Anything reading a story's params must therefore go through `extractStoryParams` (`lib/data/story/story-params.ts`), which scans placeholders *and* parses `<Param>` nodes out of JSX — a placeholder-only regex silently returns zero params for every new-format story. Either way the control lives exactly where the author placed it — values again in `parameterValues`. Because values are a separate name-keyed dict, a control can be moved or re-themed without touching them.

**One story `<Param>` drives every embed that uses it, by two different routes.** A LEGACY story goes through `views/shared/AgentHtml.tsx`, which scans the body for `[data-param-name]` into `paramTargets` (`paramFromPlaceholderEl`), holds the values in React state seeded from `content.parameterValues`, and portals a `StoryParamControl` per param. A `format:'jsx'` story has no placeholders to scan: `views/shared/StoryJsxBody.tsx` collects the declarations from the AST (`collectStoryParams`) and renders each `<Param>` through its own `ParamControlAdapter` → `StoryParamControl` **in place in the interpreted tree** — no DOM scan, no portal. Both then pass every embed `externalParameters` (`storyParamToQuestionParameter`, wired in `views/shared/StoryEmbeds.tsx`) plus `externalParamValues`; that contract onto the embeds is identical, and only the collection and mounting differ. Changing one control re-renders the story and re-executes each affected embed. Dashboards reach `SmartEmbeddedQuestionContainer` through the *identical* `externalParameters`/`externalParamValues` props from `DashboardView` — only the derivation of the controls differs.

**A `<Param>` names its SQL binding, and everything else about it is presentation.** `name` is always
the stable `:name` binding. Autocomplete comes from one of two sources: `<Param id={N} column="c">`
imports question N's column, and `<Param query={`SELECT DISTINCT city FROM customers ORDER BY city`}
connection="warehouse">` runs story-local SQL and uses its first result column
(`components/params/InlineSqlDropdownWidget.tsx`). With no `label` the control humanizes the binding —
`generateLabel` turns `immediate_parent` into "Immediate Parent" — and a custom `label` changes
**only** the reader-facing text, never the binding; `labelStyle={{…}}` styles that text. When
`nullable` is true (**the default** — it is opt-out) the control grows a separate **Any** pill in its
label row that stores `null`, which `applyNoneParams` turns into predicate removal downstream. Any is
a sibling of the control, not an entry inside the dropdown, and that is deliberate: an in-list option
is unreachable the moment the source query errors or returns no rows, and it can collide with a real
value in the data.

A query-backed `<Param>` is an embed run too, contributing its own run with **empty params** — a
suggestion query populates the control rather than consuming its value, so binding the story's current
values into it would re-execute the dropdown on every keystroke and key its cache against a moving
target. The same extraction feeds `extractInlineFileQueries`, which is what puts the source query on
the guest allowlist in `lib/query-cache/guest-query.server.ts`, so an anonymous share viewer can
populate the dropdown without gaining the ability to run anything else.

- **A portal must target the anchor's document, not `document.body`.** `DrillDownCard` takes the `Document` the drill click happened in (`DrillDownState.doc`) and portals there, because its `position` is in *that* document's viewport space — inside the dashboard surface iframe the top `document.body` is the wrong coordinate space, and a `position: fixed` backdrop is broken inside `foreignObject` anyway. Anything floating that a dashboard tile can open follows the same rule, and must also carry `data-mx-theme-host` so shadcn token classes resolve in the document it lands in.

---

## Small shared lib modules

A cluster of leaf modules with no owning subsystem: the file-type registry, the server/client
config split, the published support contract, white-label branding, and the handful of utils that
carry a real invariant. They are leaves by design — almost all of them are imported by many areas
and import almost nothing themselves, so a change here has wide blast radius and no local test to
catch it.

### The file-type registry

`frontend/lib/ui/file-metadata.ts` is the single table every other area derives file-type facts
from. `FILE_TYPE_METADATA` is a `const satisfies Record<string, FileTypeMetadata>` object; the
`FileType` union is `keyof typeof FILE_TYPE_METADATA`, so adding a key adds a type everywhere.
`frontend/lib/types.ts` line 1 imports `FileType` from here and re-exports it — this file, not
`atlas-schemas.ts`, is where the type union originates.

Everything else in the module is derived, not declared:

```
FILE_TYPE_METADATA ─┬─ FileType                    (keyof)
                    ├─ SUPPORTED_FILE_TYPES        (filter supported)
                    │    └─ getSupportedFileTypes(override) ← OrgConfig.supportedFileTypes
                    ├─ .category === 'analytics'   → ANALYTICS_FILE_TYPES
                    ├─ .markers                    → markersEnabledForAppState (screenshots)
                    ├─ .h                          → view height ('none' = full page flow)
                    └─ .systemCreatedOnly          → hidden from the Create menu
```

Consumers span the app shell (`components/app-shell/CreateMenu.tsx`, `Sidebar.tsx`), the file
browser (`FilesList.tsx`, `FileSearchBar.tsx`), chat (`components/explore/ChatInterface.tsx`),
config validation (`frontend/lib/validation/config-validators.ts`) and the screenshot pipeline
(`frontend/lib/screenshot/app-state-screenshot.ts`).

`getSupportedFileTypes(override)` implements the *full-replace* override rule shared with
`accessRules`: a non-empty `OrgConfig.supportedFileTypes` replaces the built-in set entirely; an
empty or absent one falls back to defaults so a bad config can't disable file creation. The
override can also *enable* a type whose `supported: false` (notebook, report) — that flag is the
default, not a hard gate.

`markers` is the app-state-screenshot flag (numbered position gutter + `<Viewport>` pointer). It
carries a real invariant, enforced in `frontend/lib/screenshot/__tests__/app-state-screenshot.ui.test.ts`:
**every `markers: true` type must also be `h: 'none'`** — markers on an internally-scrolled view
(question) would number only the visible slice. The same test asserts `conversation` is absent
from the registry.

`frontend/lib/ui/fileComponents.tsx` is the sibling type→container map, consumed only by
`components/file-browser/FileView.tsx`. It is a `Partial<Record<FileType, …>>`: a type with no
entry renders the "Unsupported file type" message rather than failing. Today that is `users`,
`folder`, `explore` and `context_run`.

### Config vs constants: the server/client split

Two files, deliberately disjoint:

- `frontend/lib/config.ts` — `import 'server-only'`. Every server-side env var and secret, read
  once at module load into one `EnvironmentConfig` object and re-exported as named constants.
- `frontend/lib/constants.ts` — client-safe: `NODE_ENV` derivatives, `NEXT_PUBLIC_*`, build-stamped
  values, and pure helpers (`parseAnalyticsConfig`).

Three mechanisms hold the split:

1. **ESLint** — `no-restricted-syntax` bans `process.env` member access repo-wide; only
   `lib/config.ts`, `lib/constants.ts`, `scripts/**`, `test/setup/**` and the `next.config.ts` /
   `playwright*.config.ts` files are exempt (`frontend/eslint.config.mjs`).
2. **`server-only`** — importing `config.ts` from a client component is a build error.
3. **`frontend/lib/__checks__/config-constants-no-overlap.ts`** — a compile-time guard, no runtime
   code and no test: it computes `keyof typeof Config & keyof typeof Constants` and assigns `true`
   to a type that is `true` only when that intersection is `never`. A name exported from both files
   fails `tsc --noEmit`, i.e. `npm run validate`. It uses `import type` so it never trips the
   `server-only` runtime guard.

`config.ts` validation is deliberately soft: `requireSecret` returns a dummy in test, `''` in the
browser, and only accumulates a fatal error on a real server. The one required secret is
`NEXTAUTH_SECRET`; everything else has a default or is `| undefined`. `getOptionalNumber` treats
`''` and non-finite input as "unset", so `MAX_CONCURRENT_QUERIES=` falls back to `10` rather than
becoming `NaN`.

Two derived exports do real work rather than pass a value through:
`EVENTS_FORWARD_RULES` parses a JSON `{ "<event-type regex>": "<webhook url>" }` map and *skips*
invalid JSON or a bad regex with a `console.error` — a malformed rule never crashes boot; and
`ANALYTICS_CONFIG` is gated by telemetry level (below).

**Telemetry.** `frontend/lib/telemetry.ts` (outside this cluster but the direct upstream of
`config.ts`) defines the `off | errors | full` level. `config.ts` computes
`TELEMETRY_LEVEL = parseTelemetryLevel(MX_TELEMETRY)` and then gates product analytics on it:
`off` → nothing, `errors` → only an explicitly-set runtime `ANALYTICS_CONFIG`, `full` → also the
image-baked `NEXT_PUBLIC_DEFAULT_ANALYTICS_CONFIG` default. The browser side never reads env: the
root layout stamps `data-mx-telemetry` on `<html>` and `instrumentation-client.ts` reads it back.
`SEND_ERRORS_IN_DEV` and `IS_DEV`/`IS_TEST` come from `constants.ts` so the three Sentry init files
(server / edge / client) can share one gate.

**The gateway is addressed by two exports in `config.ts`, and only one of them is normally set.**
`MX_GATEWAY_ORIGIN` is the origin of the managed MinusX gateway — one service, two planes: the
control plane (orgs, credits, status) at its root, inference at its `/v1`. `MX_GATEWAY_URL_PROXY` is
the full inference URL and *derives* from the origin, so staging is one variable: two that can
disagree eventually do, and the disagreement surfaces as an auth failure against a gateway that never
minted the key, a long way from its cause. The proxy is overridable anyway, because the single origin
is a property of the reverse proxy rather than of the gateway — behind it the control plane and the
inference proxy are separate services on separate ports, so an install sharing a network with the
gateway cannot reach both through one address. Setting it says "these are genuinely two places",
deliberately, rather than by forgetting to keep a second variable in step. Both live in
`frontend/lib/config.ts` (`server-only`), never `constants.ts` — the browser never calls the gateway,
so a client import is now a build error rather than a silently-inlined default.
`frontend/lib/llm/__tests__/gateway-url.test.ts` pins the derivation, the trailing-slash trim, and
that an override already carrying `/v1` is not suffixed again. The predecessor `MINUSX_GATEWAY_URL`
is gone and has no effect anywhere.

### `compatibility.json` — the published support contract

`frontend/compatibility.json` is a static JSON contract with **three consumers that cannot import
each other**:

```
frontend/compatibility.json
   ├─ the app      → lib/llm/compat-models.ts (per-grade "Auto" model), connection form field specs
   ├─ install.sh   → curled from raw.githubusercontent.com; drives the setup interview prompts
   └─ the docs     → docs/components/compatibility-tables.tsx (supported databases / models)
```

It must live at `frontend/` (not the repo root) because the app imports it as `@/compatibility.json`
and the Docker image ships it.

`frontend/lib/compatibility/__tests__/compatibility.test.ts` is the only thing keeping the three in
agreement — the directory contains nothing else. It asserts: every `connections.types[].type` is a
real `CONNECTION_TYPES` entry; every non-coming-soon `external-engine` connector appears with
`cli: true`; declared field keys are the exact keys the connectors read; `password`-kind and
credential-shaped fields are `secret: true` (so `install.sh` prompts silently); every
`kind: 'registry'` LLM provider exists in the baked pi-ai registry and declares one resolvable
default per `LLM_GRADES`; and that retired keys (`models`, `recommended`, and the `analyst` /
`micro` / `max` grade names) have not reappeared. Adding a connector to
`frontend/lib/ui/connection-type-options.ts` in the `external-engine` group and forgetting
`compatibility.json` fails this test.

`connection-type-options.ts` is the app-side twin: the picker's grouping/copy
(`components/shared/ConnectionTypePicker.tsx`). Its `description` strings contain `{{agentName}}`
placeholders substituted from branding at render time.

### `lib/gateway` — the managed MinusX gateway

`frontend/lib/gateway/` is the whole client surface onto the hosted service that provides model
access for MinusX-operated workspaces. It holds no billing logic of its own: how plans, balances and
expiry work is the service's business, and `frontend/lib/gateway/gateway-types.ts` only describes the
shape that comes back (money is integer micro-USD throughout; `microToUsd` is the only conversion).
Self-hosted installs never use any of it.

**The switch is `MX_GATEWAY_SHARED_SECRET`, not the URL.** `gatewayEnabled()`
(`frontend/lib/gateway/gateway-client.server.ts`) checks `baseUrl()` too,
but that reads `MX_GATEWAY_ORIGIN`, which carries a production default and is therefore never empty —
so the predicate reduces to the secret alone, and
`frontend/lib/gateway/__tests__/gateway-client.test.ts` pins exactly that. The URL cannot be the gate
because every install addresses that origin for inference; the secret is issued by MinusX and a
self-hosted install cannot obtain one. Naming the gateway has to stay harmless on its own.

**Everything here is best-effort, and that is the design.** `registerCompanyWithGateway`
(`frontend/lib/gateway/gateway-register.server.ts`) runs at the tail of `AuthModule.register`, after
registration has already committed, so nothing in it may throw: an outage must leave a working
workspace whose admin configures a provider by hand, not a half-registered one that can never be
registered again. A refusal is `console.warn`ed loudly at both layers, because everything downstream
of a failure is a non-event — no gateway config is written, the plan resolver falls back to whatever
else is configured, the settings panel renders nothing — which reads as "the feature is broken"
unless the reason is in the log.

**The credentials are returned exactly once.** `createGatewayOrg` yields `orgId` / `keyId` (public
ids) plus `orgSecret` (manages the account) and `key` (the inference credential); neither secret can
be read back, which is why registration persists them in the same step. They land under the `gateway`
key of the workspace config document, and extract-on-write moves both into the secrets store as
`@SECRETS/…` refs. The `llm` section written alongside points **every** grade at the provider —
wiring only `core` would leave a new workspace on "no model configured" for the other two — and
deliberately writes **no** `baseUrl`: that document is persisted forever, so a pinned URL (an internal
container hostname, say) would outlive every later change of address. Inference resolves from
`MX_GATEWAY_URL_PROXY` instead, derived from the same origin the client registered against.

**The service's vocabulary crosses the wire unchanged.** `createGatewayOrg`, `POST /orgs`, `org_id` /
`org_secret`, the `x-mx-org-secret` and `x-mx-shared-secret` headers, the config key `gateway.orgId`
and the entry point `registerCompanyWithGateway` are the *gateway's* names, not rename debt — do not
"fix" them. The app's own vocabulary is workspace, and that is what the props carry: `workspace_name`,
`app_url` and `app_commit` are sent on every registration, always all three, because support has an
org id and nothing else to go on. The `localhost` / `unknown` defaults are themselves the signal — an
absent key would read as an older client.

`fetchOrgStatus` / `fetchOrgUsage` gate on `baseUrl() && orgSecret` rather than `gatewayEnabled()`, so
a workspace with stored credentials keeps its settings panel working on a host that carries no shared
secret in its environment.

### Branding / white-label

`frontend/lib/branding/whitelabel.ts` owns the `OrgConfig` shape (branding, links, messaging
webhooks, `accessRules`, `supportedFileTypes`, `allowedVizTypes`, `chartColorPalette`, `setupWizard`,
`bots`, `credits`, `llm`, `gateway`, `remoteAgentsEnabled`), the `DEFAULT_CONFIG` fallback, the `DEFAULT_STYLES`
CSS, and `mergeConfig`. It owns *no* loading and *no* Redux: `frontend/lib/data/configs.server.ts`
reads the org config document, validates it, and calls `mergeConfig(DEFAULT_CONFIG, dbContent)`;
`app/layout.tsx` and `app/login/page.tsx` fall back to `DEFAULT_CONFIG` when there is no document;
`frontend/lib/database/import-export.ts` and `app/api/admin/reset-tutorial/route.ts` substitute
`DEFAULT_STYLES` into the seed template.

Merge semantics, and they differ per field:
- `branding` / `links` — key-wise shallow merge, with **empty strings filtered out** so a blank form
  field falls back to the default instead of blanking the brand.
- `thinkingPhrases`, `supportedFileTypes`, `chartColorPalette` — override wins only when non-empty
  (empty array = "unset").
- everything else — `overrides.x ?? defaults.x`.

**`mergeConfig` enumerates every `OrgConfig` key by hand.** Add a field to the interface, forget
`mergeConfig`, and it type-checks and is silently dropped on every config load. This is the exact
"explicit key enumeration" smell the repo bans elsewhere; there is a regression test for one such
drop (`lib/secrets/__tests__/config-secrets-e2e.test.ts` — "mergeConfig must not drop llm"). When
adding an `OrgConfig` field, update `mergeConfig` in the same edit.

`story-theme-options.ts` and `story-template-options.ts` are pure *projections* of registries owned
elsewhere (`lib/data/story/story-themes.ts`, `lib/data/story/story-templates.ts`) into the option
cards the frontend Clarify handler shows for `type: 'design'` / `type: 'template'`. They add only
the image-URL convention (`public/story-themes/<name>.png`,
`public/story-templates/<name>.svg`) and deliberately drop the templates' fat `guidance` field so it
never travels through picker props or the clarify stash.

`frontend/lib/ui/theme.ts` is the Chakra design system (`system`), consumed by
`components/app-shell/Providers.tsx`, `app/global-error.tsx`, `components/views/shared/StoryEmbeds.tsx`
and the test render helper. It covers the app-shell/admin surfaces only — rendered documents are on
the Tailwind kit. One asymmetry lives between it and `ACCENT_HEX` in `file-metadata.ts`:
`accent.info` exists as a raw *light-mode* token with **no semantic token** (so `color="accent.info"`
does not resolve) yet has an `ACCENT_HEX.info` entry. `ACCENT_HEX` exists because Lexical mention
nodes style with raw hex, not Chakra tokens; `ACCENT_TOKEN_HEX` is the `'accent.*' → hex` map that
`components/chat/MentionChip.tsx` and `components/lexical/MentionNode.tsx` both read.

### Utils that carry a contract

- **`utils/semaphore.ts`** — counting semaphore whose limit may be a **getter**, re-read on every
  acquire, so a Redux-hydrated runtime cap changes concurrency without recreating the instance. The
  release path hands the slot directly to the next waiter (active count unchanged) and only
  decrements when nobody waits; `run()` releases in `finally`, so a throwing task cannot leak a
  slot. Real users: `querySemaphore` in `frontend/lib/file-state/query-results.ts` (caps in-flight
  `/api/query` calls at `MAX_CONCURRENT_QUERIES`) and `frontend/lib/headless-capture/manager.ts`.
- **`utils/immutable-collections.ts`** — `immutableSet` / `immutableMap`. ESLint bans module-level
  `new Map()` / `new Set()` (they are shared across all requests on the server); the rule's selector
  matches `NewExpression`, so these helper *calls* pass without an eslint-disable. Use them for
  constants; keep the disable-with-justification for genuinely mutable module state.
- **`utils/query-hash.ts`** — `cyrb53`, a sync 53-bit hash that must produce identical output on
  client and server, because `getQueryHash(query, params, database)` is the Redux/query-result cache
  key computed on both sides (`store/queryResultsSlice.ts`, `app/api/query/route.ts`,
  `lib/query-cache/execute.server.ts`, `lib/data/helpers/param-resolution.ts`). `hashContent` is the
  same hash over `JSON.stringify(value)` and is used as the `editId` for DocumentDB writes — key
  order therefore matters to the hash.
- **`utils/error-recovery.ts`** — the auto-recovery policy behind `app/error.tsx`. Per error
  *message*: up to `MAX_AUTO_RESETS` (2) resets within a 5-minute window → one hard reload, guarded
  in `sessionStorage` for 10 minutes → `fallback` (manual UI). The reload step matters because
  `reset()` re-runs the JS already in the tab, so a stale tab can never pick up a fixed deployment
  without a full reload. **Failure contract: no storage, or storage that throws (privacy mode),
  returns `fallback`, not `reload`** — a reload it cannot record risks a reload loop. Occurrences
  further apart than the window are treated as sporadic and keep resetting.
- **`utils/xml-parser.ts`** — splits `<thinking>` / `<answer>` and strips `<suggested_questions>` /
  `<trust_info>` blocks. Shared by the chat Markdown renderer and the Slack integration
  (`lib/integrations/slack/messages.ts`) so both parse identically. Returns `null` when no tags are
  present (untagged content is all answer). Partial content after an unclosed opening tag is emitted
  immediately so streaming stays visible.
- **`utils/attachment-extract.ts`** — PDF/DOCX/TXT text extraction for chat attachments, and the one
  sanctioned exception to the no-dynamic-import rule: `pdfjs-dist` (~40 MB) and `mammoth` are
  `await import`ed inside their extractors with an inline eslint-disable, because a static import
  would pull them into every page that renders `ChatInput`. Limits are hard errors, not truncation:
  >10 PDF pages or >5000 words throws.
- **`utils/mentions.ts`** — `splitMentions` over the `@{…json…}` form; the regex is deliberately
  lazy and must stay in sync with `components/lexical/mention-transformer.ts`. Unparseable JSON
  degrades to plain text.
- **`utils/database-selector.ts`** — one selection rule ("preferred if present, else first, else
  `''`") over any object carrying `databaseName` / `name` / `metadata.name`, shared by chat, the
  notebook view and `lib/data/files.server.ts` so client and server pick the same default database.
- **`utils/toast-helpers.ts`** — `showAdminToast` reads Redux directly (`getStore()`); non-admins see
  nothing, and error/warning toasts additionally require devMode. Silent by design.
- **`utils/error-utils.ts`** (hydration-error classifier, used to suppress error reports),
  `utils/today.ts` (`todayISO()` for the `current_date` prompt var), `ui/animations.ts` (shared
  keyframe strings) and `ui/sidebar-sections.ts` (right-sidebar section titles/icons) have no
  contract beyond their signature.

### Small modules with a sharp rule

- **`frontend/lib/view/view-types.ts`** — `view` is a top-level URL param, preserved across
  navigation like `mode`. It is an **ordered** enum (`full → file → content → contentonly`), each
  level stripping strictly more chrome, so consumers must use the threshold helper `viewAtLeast`,
  never equality. Read by the middleware (`lib/middleware/create-middleware.ts`),
  `lib/auth/auth-helpers.ts`, `store/authSlice.ts` and the layout/file components.
- **`frontend/lib/dashboard/effective-params.ts`** — the dashboard parameter merge extracted from
  `components/views/DashboardView.tsx` so it is testable without a DOM. Precedence is
  `lastExecutedParams` → dashboard `paramValues` → the question's saved default → `''`, and
  membership is tested with `in`, never `??`: an explicit `null` (None) or `''` at a higher tier is
  a real value that a question default must not resurrect.
- **`frontend/lib/store/file-selectors.ts`** — pure, side-effect-free Redux selectors
  (`selectAugmentedFiles`, `selectAugmentedFolder`, `selectFilesByCriteria`, `selectFileByPath`)
  paired with the async loaders in `lib/file-state/`. `selectAugmentedFiles` memoizes on
  `(fileIds.join(','), state identity)` — a module-level `Map` with an explicit eslint-disable —
  purely to keep react-redux from warning about new references. `selectAugmentedFolder` applies
  permission (`canViewFileType`) and hidden-system-path filtering, so it is a *narrowing* view of
  Redux, not a mirror. Imported by hooks, tool handlers (`lib/tools/handlers/edit-file.ts`,
  `lib/tools/micro-task.ts`), `store/appStateSelector.ts` and the share page.
- **`frontend/lib/constants/cache.ts`** — `CACHE_TTL` — FILE, FOLDER and QUERY, all ten hours; the default
  staleness window for `useFile` / `useFolder` / `useQueryResult`. Note the import specifier is
  `@/lib/constants/cache`, distinct from the client-env module `@/lib/constants`.

### Test and benchmark support

`frontend/lib/test/faux-llm-channel.server.ts` lets an out-of-process Playwright test drive the
real in-process orchestrator's LLM. It installs a content-keyed matcher on the faux providers of the
chat-reachable agents (web-analyst, analyst, benchmark-analyst, onboarding) and records every
request they receive.

```
Playwright ──HTTP──> app/api/test/faux[/received|/reset]   (404 unless E2E_MODE)
                        └─> configureFauxFromDTO → dtoToFauxMatch → agent fauxRegistration.setResponses
```

Because the browser driver cannot reach this module's memory, the wire format is the serializable
`FauxMatchDTO` (no functions). Two gotchas: `DEFAULT_TARGETS` must be extended when a new agent
becomes reachable from chat, or its calls run unfauxed; and `delayMs` is matched by **substring**,
not exact key, because the LLM context wraps the user text (a leading `<CurrentTime>` block) — an
exact lookup would silently never apply the delay.

`frontend/lib/benchmark/import-conversation.ts` is a thin client for `POST /api/benchmark/import`:
it ships a benchmark run's orchestrator log (plus the dataset's connections list) and gets back a
conversation id, which `app/benchmark/page.tsx` opens at `/explore/<id>` to continue the run in the
chat UI. The `connections` array is load-bearing — it is persisted on the conversation's
`meta.benchmark_connections`, and without it continued SQL fails with "connector 'X' not loaded".

`frontend/lib/instrumentation/register-modules.ts` is the module-registry bootstrap:
`registerWithModules()` picks the PGLite or adapter-backed DB module from `getDbType()`, registers
auth / db / object-store / cache / namespace, runs `db.init()`, then `runBootTasks()` — the
unhandled-rejection router and the chat-runtime warm, which live here rather than in
`instrumentation.ts` so that registering modules is enough to get them. It is called by
`frontend/instrumentation.ts` at server start and by the standalone scripts
(`scripts/heal-stories.ts`, `scripts/migrate-conversations-to-v3.ts`) so they get the same wiring as
the app.

### Key files

| Task | File |
|---|---|
| Add a file type, change its icon/color/height/markers | `frontend/lib/ui/file-metadata.ts` |
| Wire a file type to its viewer | `frontend/lib/ui/fileComponents.tsx` |
| Add a server env var / secret | `frontend/lib/config.ts` (name must not collide with `constants.ts`) |
| Add a client-safe or build-stamped constant | `frontend/lib/constants.ts` |
| Understand why a config name collision fails `tsc` | `frontend/lib/__checks__/config-constants-no-overlap.ts` |
| Add a connector or LLM provider to the published contract | `frontend/compatibility.json` + `frontend/lib/ui/connection-type-options.ts`, guarded by `frontend/lib/compatibility/__tests__/compatibility.test.ts` |
| Add an `OrgConfig` field | `frontend/lib/branding/whitelabel.ts` — interface **and** `mergeConfig` |
| Change Chakra tokens / recipes | `frontend/lib/ui/theme.ts` |
| Bound concurrency of async work | `frontend/lib/utils/semaphore.ts` |
| Change the query-result cache key | `frontend/lib/utils/query-hash.ts` (client and server must agree) |
| Change error-boundary auto-recovery | `frontend/lib/utils/error-recovery.ts` |
| Add an embeddable chrome level | `frontend/lib/view/view-types.ts` |
| Change dashboard parameter precedence | `frontend/lib/dashboard/effective-params.ts` |
| Drive the LLM from a Playwright test | `frontend/lib/test/faux-llm-channel.server.ts` |
| Change server bootstrap wiring | `frontend/lib/instrumentation/register-modules.ts` |

**`lib/sql/sql-params.ts` must stay React-free.** The per-type icon and colour helpers live in `lib/sql/param-type-display.ts` (`getTypeIcon`, `getTypeColor`) purely so server, script and test code can import the parameter logic without pulling `react-icons` in behind it. `getTypeColor` returns a raw hex string rather than a theme token on purpose: consumers interpolate it into plain CSS (`border-left`, `color-mix(...)`), where a token name is invalid and silently drops the declaration.

---

## Build, Test & Docs Infrastructure

This area covers the npm script surface and the one-shot CLIs behind it (`frontend/scripts/`),
the shared test harness and the two Playwright suites (`frontend/test/`), the offline agent
benchmark (`frontend/benchmarks/`), ambient type declarations (`frontend/types/`), CI
(`.github/workflows/`), and the separately-deployed documentation site (`docs/`).

### What each module owns

**`frontend/scripts/`** — one-shot Node CLIs run through `tsx`, never imported by app runtime code.
Five families: **generators** that write committed artifacts (`generate-app-theme-css.ts`,
`generate-story-ui-classes.ts`, `generate-dashboard-chrome-css.ts`, `generate-theme-previews.ts`,
`generate-og-default.tsx`, `update-workspace-template.ts`); **browser matrices** that drive real
engines (`capture-matrix.ts` + `b2-surface-matrix.ts` + `story-width-matrix.ts`,
`headless-capture-fidelity.ts`); **DB mutators** that write to a live document DB
(`heal-stories.ts`, `migrate-conversations-to-v3.ts`); **read-only inspectors**
(`dump-llm-calls.ts`, `prompt-visualizer.ts`, `check-docs-consistency.ts`); and
`scripts/setup-cli/`, the only code here that ships inside the Docker image. It does **not** own the
behaviour it generates — every generator delegates to a `lib/` module and exists only to
serialize that module's output to disk.

**`frontend/test/`** — harness only; it contains no unit tests. Unit and integration tests live in
`__tests__/` directories next to the code they cover. This tree owns: the Vitest bootstrap
(`test/setup/`), the in-process route/DB harness (`test/harness/`), React Testing Library wrappers
(`test/helpers/`), the driver-independent flow vocabularies (`test/flows/`), and the two Playwright
suites (`test/e2e/`, `test/qa/`).

**`frontend/benchmarks/`** — offline agent-quality measurement (`runner.ts` is the generic engine,
`dataanalystbench.ts` the configured entry). Never runs in CI; it needs external datasets
(`DAB_BENCH_BASE_DIR`) and real LLM credentials. Distinct from `app/api/benchmark/import` (the
in-app route that ingests benchmark output) — the runner writes JSONL, the route reads it.

**The capture-matrix browser bundle has a real entry file.** `scripts/capture-matrix-bundle.ts`
imports the shipped modules and exposes them on `window` for the in-page drivers; esbuild bundles
that file into the `/bundle.js` the fixture pages load. It is a checked-in file rather than a
string assembled at build time specifically so the imports stay visible to `tsc`, ESLint and
`npm run knip` — a module reachable only through a template literal looks dead to every tool that
reads the repo. `scripts/b2-surface-drivers.tsx` (the dashboard-surface drivers) is reached this
way; the fixture pages deliberately carry zero stylesheets, so a tile that rasterizes empty proves
the surface depended on its environment.

The bundle carries its own YAML loader plugin. esbuild has no YAML support and the surface tree
transitively imports `orchestrator/prompts/story-guidance.yaml`, so `capture-matrix.ts` registers a
plugin that parses it — the esbuild-tier equivalent of `yaml-loader` (Turbopack),
`@rollup/plugin-yaml` (Vitest) and `scripts/register-yaml.mjs` (tsx). Without it the bundle does not
build at all. **`npm run capture-matrix` is not in CI**, so nothing catches it breaking except
running it.

`npm run knip` still reports `tailwindcss`, `@tailwindcss/oxide` and `yaml-loader` as unused
dependencies — all three are consumed through config rather than imports. Verify before deleting
anything it flags.

**`frontend/types/`** — ambient declaration files only (`next-auth.d.ts` augments
`User`/`Session`/`JWT` with `userId`/`role`/`home_folder`/`tokenVersion`). No values, no runtime.

**`.github/workflows/`** — CI and release. It owns the *required-check names*, not test content.

**`docs/`** — a standalone fumadocs (Next 16) app, statically exported and deployed independently.
It owns product documentation under `docs/content/`. Only `content/` is built into the site; any
other file in that directory is a plain repo file and is never published.

### npm scripts

Everything runs from `frontend/`. Names that mean what they say are omitted.

| Script | Notes |
|---|---|
| `validate` | The only types+lint gate. Runs `tsc --noEmit`, `eslint --quiet`, and `scripts/check-docs-consistency.ts` concurrently. |
| `check-docs` | `check-docs-consistency.ts` alone: every backticked path in the repo-root `CLAUDE.md` must resolve, and no source comment may reference a missing `*.md`. Exits 1 if `CLAUDE.md` is absent. |
| `test` / `test:main` / `test:ui` / `test:orchestrator` | Vitest; all projects, or one. |
| `test:e2e` / `test:qa` | The two Playwright configs (see below). |
| `capture-matrix` | Chromium+WebKit+Firefox fixture matrix over the real serialization modules. No dev server. |
| `capture-fidelity` | Pixel-diffs the headless capture backend against the client serialize path. Sets `HEADLESS_CAPTURE=1` and a throwaway `NEXTAUTH_SECRET`. |
| `update-workspace-template` | Runs migrations over `lib/database/workspace-template.json` with placeholder values substituted, restores the `{{TEMPLATE_VAR}}` markers, writes back. Never touches a database — review with `git diff`. |
| `prompt-visualizer` | Emits a self-contained HTML token-budget view of the real prompt assembly. Needs `scripts/register-yaml.mjs`. |
| `build:setup-cli` | esbuild-bundles `scripts/setup-cli/*.ts` into a gitignored setup-cli/ directory for the Docker image. |
| `postinstall` | `copy-duckdb-wasm.mjs` (node_modules → `public/duckdb/`) then `patch-package --error-on-fail`. Two patches live in `frontend/patches/`: the pi-ai one carries real semantics (web search, remote image URLs, and the provider-reported cost that managed billing depends on), while `next+16.1.6.patch` edits Next's *compiled, minified* app-page runtime — its intent is not recoverable from the diff, so treat it as opaque and re-derive it against upstream on a Next bump rather than hand-merging. `--error-on-fail` is what stops either from being skipped silently. |
| `benchmark:dab` | Requires `DAB_BENCH_BASE_DIR`; throws immediately without it. |
| `knip` | Dead-export detection. `knip.json` declares `scripts/*`, `benchmarks/dataanalystbench.ts` and the Playwright `*.setup.ts` files as entry points so they are not reported unused. |
| `generate-og:generic` | Regenerates the committed `public/ogs/generic.png`. |

`frontend/scripts/check-min-data-version.ts` is deliberately **not** an npm script and is wired to no
workflow in this repo. It refuses to ship a build that cannot read data still in service: raising
`MINIMUM_SUPPORTED_DATA_VERSION` is safe only once everything the deployment serves has been migrated
past it, and a workspace left behind is served by code that MISREADS its data — wrong content, not an
error. The comparison needs two numbers from two different builds (only the candidate knows its own
minimum, only the running deployment knows what it serves), which is why it is a script rather than
something the endpoint could answer alone. Run it with
`MIN_DATA_VERSION_URL=https://<host>/api/admin/min-data-version` and `CRON_SECRET` set. Exit `2`
("could not determine") is fatal on purpose: `withCronAuth` answers a wrong secret with
`200 {ok: true}`, so a missing `min` in the response must never read the same as a pass.

Most of these (`generate-app-theme-css`, `generate-dashboard-chrome-css`,
`generate-theme-previews`, `update-workspace-template`, `capture-fidelity`, `prompt-visualizer`,
and the two operational CLIs) run with `tsx --conditions react-server` because they import
`server-only`-guarded modules; `generate-story-ui-classes` does not need it. `setup-cli` can't
use that trick — it runs under plain `node` inside the image — so `build:setup-cli` esbuild-aliases
`server-only` to the empty `scripts/setup-cli/server-only-empty.js` instead. Two escapes from the
same guard, for two different execution contexts.

`orchestrator/prompts/prompts.yaml` is imported natively, which costs a YAML loader per runtime:
`yaml-loader` for the Next build, `@rollup/plugin-yaml` for Vitest (`vitest.config.ts`), and
`scripts/register-yaml.mjs` (a `node:module` `registerHooks` hook, loaded via `node --import`) for
`prompt-visualizer`. All three must stay in sync or the affected runtime dies with
`ERR_UNKNOWN_FILE_EXTENSION ".yaml"`.

### Vitest layout

`frontend/vitest.config.ts` defines three projects sharing one `@` → `frontend/` alias and a 45s
test/hook timeout:

```
node          environment: node    **/__tests__/**/*.test.{ts,tsx}
                                   minus *.ui.test.*, minus orchestrator/**, minus agents/**
                                   setup: test/setup/vitest.setup.ts
ui            environment: jsdom   **/__tests__/**/*.ui.test.{ts,tsx}
                                   setup: vitest.setup.ts + vitest.setup.ui.ts
orchestrator  environment: node    orchestrator/**/__tests__/**  +  agents/**/__tests__/**
                                   setup: vitest.setup.orchestrator.ts (which imports vitest.setup.ts)
```

The `node` project's exclusion of `orchestrator/**` and `agents/**` is what keeps a file from
running twice. Anything else matching `__tests__/**/*.test.ts` lands in `node` — including
`scripts/__tests__/dump-llm-calls.test.ts`. There is no separate scripts project.

`test/setup/vitest.setup.ts` runs for **all three** projects and is where global isolation is
enforced: `@/lib/database/db-config` is mocked so `getDbType()` returns `'pglite'` with every path
`undefined` (in-memory, no persistence directory can be reached); `server-only`, `next-auth` and
`@/auth` are stubbed; `@/lib/auth/auth-helpers` returns a fixed admin `EffectiveUser`; the module
registry is pre-populated with a real `DBModule` and throwing stubs for auth/store/cache; and
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are set to a sentinel that passes "key exists" checks but
guarantees a 401 on a real call.

`@/lib/analytics/file-analytics.server` is mocked with an explicit export list. That list must
track the real module: add an export there without adding a stub here and every test that
transitively imports it fails with a Vitest mock error.

### Test database harness

`test/harness/test-db.ts` gives each suite an isolated Postgres schema inside one shared PGLite
adapter:

```
setupTestDb('…/foo.db')
  → schemaFromPath()  = basename minus extension, non-alphanumerics → '_'   ("foo")
  → beforeAll:  CREATE SCHEMA IF NOT EXISTS foo; run POSTGRES_SCHEMA DDL once per (adapter × schema)
  → beforeEach: ONE adapter.exec() — SET search_path + DELETE all + INSERT the seed template
  → afterAll:   deliberate no-op (keeps the adapter warm for later suites in the file)
```

Two invariants follow. **The schema name is derived from the basename only** — two suites whose
`dbPath` shares a basename share a schema and therefore share data; `getTestDbPath('<unique-name>')`
exists so callers pick a distinct one. **The per-test reset is a single `exec` with no JS yields**,
so an async listener left running by a previous test cannot interleave and produce duplicate-key
errors; splitting that call back into separate statements reintroduces the flake it was written to
kill.

The harness itself is split across two trees, which is not where a reader would look:
`setupTestDb` comes from `@/test/harness/test-db`, but `getTestDbPath`/`setupTestStore` come from
`@/store/__tests__/test-utils`, which `test-db.ts` imports.

`test/harness/mock-fetch.ts` is the second half of the node-layer stack: it replaces `global.fetch`
with a matcher that routes matching URLs into real Next.js route handlers (constructing a
`NextRequest` from the *pattern*, not the actual URL) and **throws on any unmatched call**. That
throw is the contract — an unmocked network call is a loud failure, never a silent pass.

### Playwright: two suites, deliberately opposite gates

`playwright.config.ts` (`test/e2e/`) and `playwright.qa.config.ts` (`test/qa/`) use the same tooling
to prove different things:

```
E2E   next build with NEXT_PUBLIC_E2E=true   →  E2E_MODE permanently on
      /api/test/faux live · window.__MX_STORE__ always exposed · SVG charts
      specs may script the LLM: setFauxLLM / resetFauxLLM  (test/flows/e2e-faux.ts)
      port 3100 · distDir .next-e2e · PGLITE_DATA_DIR data/pglite-e2e
      workers: 1, fullyParallel: false   (tutorial reset is workspace-wide)

QA    next build with NEXT_PUBLIC_E2E deliberately UNSET
      faux channel 404s · store exposed only after ?e2e=<E2E_RUNTIME_SECRET> (cookie-persisted)
      REAL LLM → assertions must be structural/deterministic, never on generated text
      port 3101 · distDir .next-qa · PGLITE_DATA_DIR data/pglite-qa
      workers: QA_PARALLELISM || 2, fullyParallel: true
      setup chain: auth.setup → reset.setup (reset tutorial + waitForTutorialData) → qa specs
```

That asymmetry explains the rest: there is no faux-assertion helper on the QA side, `qa.yml` must
supply a real provider credential, and `test/qa/runtime-gate.spec.ts` exists purely to prove the
runtime opt-in works in all three directions (absent → not exposed, correct secret → exposed and
persists across navigation, wrong secret → not exposed).

The QA config never runs `next dev`. Locally it does a full `npm run build && npm run start`;
`QA_SKIP_BUILD=1` (CI) skips straight to `next start` on a restored build. The dev server compiles
routes on demand and races cold builds under parallel workers, producing `page.goto` timeouts.

**QA's tutorial-mode discipline** lives in `test/qa/flows.ts`. `QA_MODE = 'tutorial'`; `modeUrl()`
appends `mode=tutorial`; `e2eUrl()` appends that plus `e2e=<secret>`; every `/api/files` discovery
call carries `mode=tutorial` explicitly. The system default is `org`, so tutorial is opt-in on every
single request. Mutating flows add two guards: `assertTutorialMode(page)` polls Redux for
`auth.user.mode === 'tutorial'` and **fails the test** if it never holds, and the post-save
assertions (`assertQuestionSaved`, `assertDashboardSavedWithQuestion`) hard-require
`path.startsWith('/tutorial')`. `resetTutorial()` by contrast is best-effort — a non-admin QA
account gets a `console.warn` and the read-only flows continue.

Both suites locate elements by `aria-label` via `getByLabel` only. A control without one is a
missing `aria-label` on the component, not a reason to use a different query.

### CI

| Workflow | Trigger | Gates |
|---|---|---|
| `test.yml` | push main, PR | `validate` job (tsc + eslint + check-docs) and a 6-way Vitest shard matrix. |
| `e2e.yml` | push main, PR | Builds once with `NEXT_PUBLIC_E2E=true` into `.next-e2e`, then runs Playwright with `E2E_SKIP_BUILD=1`. |
| `qa.yml` | PR only | `qa-build` (Turbopack → `.next-qa`, uploaded as a tar) → `qa-flows` 3-shard matrix → `qa` aggregator. |
| `docker-build-check.yml` | PR, path-filtered | Builds the prod image with `push: false`. Filter covers Dockerfile, patches, lockfile, `next.config.ts`, `copy-duckdb-wasm.mjs`. |
| `publish.yml` | push main, `v*` tags, manual | main → `minusx-frontend-canary:latest`; tag → `minusx-frontend` semver+latest. Then dispatches the staging-deploy workflow in the private minusxai/deploys repo. |
| `docs-deploy.yml` | push main touching `docs/**` | Dispatches the docs-deploy workflow in the private minusxai/deploys repo. |
| `claude.yml` | `@claude` mentions | — |

Non-obvious CI facts:

- **The aggregator job `name:` strings are the branch-protection contract**, not the shard names:
  `Frontend Tests (Chat API, E2E, MinusX Agent)` (`test.yml`) and `QA Flows (prod build)`
  (`qa.yml`). Shard counts can change freely; renaming those two breaks required checks.
- Both the E2E and QA build jobs set `NEXT_SKIP_TYPECHECK: 'true'`. **A type error does not fail
  them** — `validate` is the sole types gate. (`next.config.ts` maps that env var to
  `typescript.ignoreBuildErrors`, and points the in-build check at `tsconfig.build.json`, which
  excludes tests.)
- Both build jobs must set `NEXTAUTH_SECRET` at *build* time: "Collecting page data" executes the
  auth route modules and `lib/config.ts` throws when it is unset.
- `qa.yml` tars `.next-qa` before upload because Turbopack emits chunk filenames containing a colon,
  which `upload-artifact@v4` rejects as an invalid path. The standalone and cache subdirectories are
  excluded from the tar.
- `qa.yml` sets `USE_BASE64_UPLOADS: 'true'` — with no S3 in CI, chart images would become
  `http://localhost` URLs that the Claude API rejects ("Only HTTPS URLs are supported").
- Model config is DB-only in the app, so `test/qa/auth.setup.ts` reads the runner-side
  `AWS_BEARER_TOKEN_BEDROCK` / `ANTHROPIC_API_KEY` / `ANALYST_AGENT_MODEL_CONFIG` env and seeds them
  into the workspace via `POST /api/configs` — the same path an admin uses. Fork PRs get no secrets,
  so the real-LLM describe skips rather than failing.
- No Turbopack build cache is restored anywhere: measured warm ≈ cold, so caching was pure overhead.
  `node_modules` and the Playwright browser binaries *are* cached, on a key shared by all three
  workflows.
- **Node 22 everywhere the app runs, stated in three places that must agree.** `actions/setup-node`
  pins `'22'` in `test.yml`, `e2e.yml` and both `qa.yml` jobs; `frontend/Dockerfile` builds and runs on
  `node:22-slim`; `frontend/package.json` declares `engines.node: ">=22.19.0"`. There is no `.nvmrc`
  and no `engine-strict`, so the `engines` field warns rather than blocks — the real gates are the
  workflow pin and the image. Bumping one without the others is the failure this triple exists to make
  visible: CI green on a runtime the image does not ship. `docs/Dockerfile` is deliberately still
  `node:20` — the docs site is a separate app with its own `package.json` and shares nothing with the
  frontend build.

### The docs site

A second Next app with its own `package.json`, `node_modules`, and `tsconfig.json`. `output: 'export'`
(`docs/next.config.mjs`) makes it a fully static bundle; `docs/app/api/search/route.ts` is
`force-static` and pre-renders the fumadocs search index rather than serving it.

```
content/docs/**.mdx  ─┐
content/guides/**.mdx ┴→ source.config.ts (defineDocs) → .source/server → lib/source.ts (loader)
                          → docsSource.pageTree → app/docs/layout.tsx (DocsLayout sidebar)
                          → app/docs/[[...slug]]/page.tsx  (and the parallel /guides tree)
```

Sidebar structure is entirely `meta.json`: `title`, `pages` (order **and** inclusion), `defaultOpen`.
The root `content/docs/meta.json` carries `root: true` and uses `"---Label---"` entries as section
separators. Two tabs (Docs, Guides) are two separate roots, switched by the client component
`lib/tabs.tsx` rendered as the sidebar banner.

**The one cross-boundary import.** `docs/components/compatibility-tables.tsx` does
`import compatibility from '../../frontend/compatibility.json'` so the supported-databases and
supported-models tables cannot drift from what the app actually supports. Three files conspire to
make that work: the import itself, `docs/next.config.mjs` widening `turbopack.root` to the repo
parent so imports may cross above `docs/`, and `docs/Dockerfile` copying the file to
`/frontend/compatibility.json` to preserve the relative path. Consequence: **the docs image must be
built from the repository root**, not from `docs/`.

### Interactions with other areas

- **`lib/` and `components/` → the test harness.** Over 200 test files import `@/test/harness/test-db`
  (integration) or `@/test/helpers/render-with-providers` (jsdom). `render-file-page.tsx` reproduces
  `FileLayout`'s position-relative container plus `ViewStackOverlay` without importing `FileLayout`
  (which transitively pulls ESM-only packages the runner can't transform). `dashboard-surface.ts`
  binds Testing Library queries to the dashboard iframe's document, because `screen` is bound to the
  top document and cannot see inside the surface — and mirrors the production readiness scan in
  `lib/screenshot/readiness.ts`.
- **Screenshot / story / dashboard-surface modules → `scripts/`.** `capture-matrix.ts` esbuild-bundles
  and drives the *real* `lib/screenshot/serialize-element.ts`, `lib/story-surface/serialize.ts` and
  `lib/data/story/banned-css.ts`; `b2-surface-matrix.ts` drives the shipped `DashboardSurface` and
  `WindowedTile`; `headless-capture-fidelity.ts` imports `lib/headless-capture/index.server.ts`.
  Renaming an export in those modules breaks `npm run capture-matrix`, not a unit test — and nothing
  in the Vitest suite will tell you.
- **Generated-artifact loop.** `generate-app-theme-css` → `app/theme-tokens.css`,
  `generate-story-ui-classes` → `lib/story-ui/recipe-classes.ts`, `generate-dashboard-chrome-css` →
  `lib/dashboard-surface/chrome-css.gen.ts`. Each has a freshness test in the owning module's
  `__tests__/` that fails when the committed output no longer matches its sources, so the generator
  is not optional after touching `components/kit/` or the theme definitions.
- **Database area → `scripts/update-workspace-template.ts`.** It reads
  `lib/database/workspace-template.json`, applies `lib/database/migrations`, and writes back. Adding
  a migration without running it leaves the seed template behind `LATEST_DATA_VERSION`.
- **Orchestrator/agents → `benchmarks/`.** `runner.ts` instantiates `Orchestrator` directly with a
  `registrables` list, so it depends on the same registry contract as production chat but bypasses
  the chat routes entirely. `benchmarks/dataanalystbench.ts` wires the `agents/benchmark-analyst/*`
  classes — which is why those keep `Base*` variants free of `server-only`.
- **`install.sh` → `frontend/compatibility.json` and `scripts/setup-cli/`.** The installer curls
  `compatibility.json` from raw.githubusercontent for its interview and runs
  `docker run --rm -i <image> node setup-cli/<entry>.js` for validation, passing JSON on stdin
  (never argv — argv leaks secrets to `ps`) and reading a JSON object from stdout. Exit codes are
  the API: `0` ok, `1` validation failed, `2` malformed input.
- **ESLint → this area.** `eslint.config.mjs` grants `scripts/**`, `test/setup/**` and the two
  Playwright configs an exemption from the `process.env` ban; turns off
  `react-hooks/rules-of-hooks` for `test/e2e/**` (the Playwright fixture callback is named `use`);
  and disables the import-discipline and `no-restricted-syntax` rules across `test/**` and all
  `__tests__/`.

### Gotchas

- **`vitest.setup.ui.ts` still mocks ECharts.** `vi.mock('@/lib/chart/echarts-init', …)` names a
  module that does not exist and `vi.mock('echarts', …)` names a package that is not a dependency.
  Both are inert. The `HTMLCanvasElement.prototype.getContext` stub below them is attributed to
  ECharts but is jsdom hygiene independent of it.
- **`TestDbOptions.withTutorialFiles` is declared and never read.** `setupTestDb` destructures only
  `customInit` and `withTestConnection`. Passing it does nothing.
- **`mirrorAppStyles` is mocked to a no-op in jsdom** for a reason worth knowing before you remove
  it: the real implementation re-serializes every accumulated `<style>` rule on each render, which
  goes O(n²) across a test file's shared document (it once turned a 9-test file into ~13 minutes).
- **`test/qa/*` runs against production URLs when `QA_BASE_URL` is set.** The only thing standing
  between a QA run and production files is `mode=tutorial` on every request plus the two mutation
  guards. Adding a flow that forgets `modeUrl`/`e2eUrl` silently targets `org`.
- **The e2e Playwright config defaults to `npm run dev`.** CI overrides it with `E2E_SKIP_BUILD=1`.
  Locally, first-run route compilation dominates the wall clock; `reuseExistingServer` is on
  outside CI, so a stale server on 3100 will be reused as-is.
- **`heal-stories` and `migrate-conversations-to-v3` require the dev server to be stopped** — PGLite
  is a single-process file database. The conversation migration has an in-process alternative
  (`POST /api/admin/migrate-conversations-v3`) that works while the server runs.
- **`installation/self-hosted.mdx` is not in `installation/meta.json`'s `pages` array.** It builds
  and is reachable by URL, but never appears in the sidebar. No `meta.json` in the repo uses a
  rest (`"..."`) entry, so omission from `pages` always means omission from the tree.
- **`check-docs` is part of `validate`.** It exits non-zero if the repo-root `CLAUDE.md` is missing,
  so `npm run validate` fails until that file exists.

### Key files

| Task | File |
|---|---|
| Add or change a Vitest project or alias | `frontend/vitest.config.ts` |
| Add a global test mock (all projects) | `frontend/test/setup/vitest.setup.ts` |
| Add a jsdom-only mock | `frontend/test/setup/vitest.setup.ui.ts` |
| Isolated DB for a test suite | `frontend/test/harness/test-db.ts` (+ `getTestDbPath` from `frontend/store/__tests__/test-utils.ts`) |
| Route an in-process API call in a test | `frontend/test/harness/mock-fetch.ts` |
| Render a component with providers | `frontend/test/helpers/render-with-providers.tsx` |
| Assert on Redux without polling | `frontend/test/helpers/redux-wait.ts` |
| Add a faux-LLM browser E2E spec | `frontend/test/e2e/` (+ `frontend/test/flows/e2e-faux.ts`) |
| Add a real-LLM QA flow | `frontend/test/qa/flows.ts` |
| Change E2E server env / ports | `frontend/playwright.config.ts` |
| Change QA server env / workers | `frontend/playwright.qa.config.ts` |
| Add/rename a CI job or required check | `.github/workflows/test.yml`, `.github/workflows/qa.yml` |
| Cross-engine capture regression | `frontend/scripts/capture-matrix.ts` |
| Refresh the seed template after a migration | `frontend/scripts/update-workspace-template.ts` |
| Inspect real prompt token budgets | `frontend/scripts/prompt-visualizer.ts` |
| Change what `install.sh` validates | `frontend/scripts/setup-cli/` |
| Run the agent benchmark | `frontend/benchmarks/dataanalystbench.ts` |
| Add a docs page / reorder the sidebar | `docs/content/docs/**/meta.json` |
| Docs ↔ app shared support matrix | `frontend/compatibility.json` → `docs/components/compatibility-tables.tsx` |

**Two root compose files, two different stacks — and the one named `prod` tracks the *less* stable image.** `docker-compose.yml` pulls `ghcr.io/minusxai/minusx-frontend:latest` (the semver-tagged release image) and runs fully embedded: `DB_TYPE=pglite`, `PGLITE_DATA_DIR=/app/data/pglite` on a named `pglite_data` volume, no external database. `docker-compose.prod.yml` pulls `ghcr.io/minusxai/minusx-frontend-canary:latest` — the image `publish.yml` builds from every push to main — and sets `DB_TYPE=postgres`, which requires `DATABASE_URL` in `frontend/.env` before the container will start. Both read `frontend/.env` via `env_file` and share `BASE_DUCKDB_DATA_PATH=/app` plus `ANALYTICS_DB_DIR=/app/data/analytics`. Reaching for the `.prod` file because of its name gets the canary build; the plain file is the stable one.

---

## Development philosophy

This section is not advisory. It describes how work is done in this repository, and it takes
precedence over habit, over convenience, and over what a task "seems to need".

### Test-driven development — the required order

**Every feature and every refactor follows this exact order. Do not implement first and back-fill
tests.**

1. **Contracts first.** Define types, interfaces, and method signatures. Reuse existing types; no
   duplication. Get the shape right before any behaviour exists.
2. **Tests second.** Write tests that exercise the ACTUAL behaviour, not helpers around it, and
   **confirm they FAIL (red) before implementing.**
3. **Implementation third.** Write code until the tests pass (green).
4. **Run the full suite** to confirm no regressions.
5. **Commit and push to the PR.**
6. **Browser-verify on the running dev server.** Drive the real flow. For chat, open the side-chat
   debug message and expand the model to read the EXACT request and response sent to the LLM.
   Don't assume; check.

> A green test that was never red is not a test — it is decoration. When asked "did you do TDD /
> browser-test?", answer honestly.

### Refactoring — Blue → Red → Blue

1. Identify the tests covering the existing behaviour. They must pass (**blue**).
2. Deliberately break the old implementation and confirm those tests fail (**red**). This is what
   proves the tests actually guard the behaviour rather than passing incidentally.
3. Re-implement until all tests pass (**blue**). Run the full suite, push, browser-verify.

The same proof applies to characterization tests written for existing code: if a test has never
been observed failing, you do not yet know that it tests anything.

### Keeping documentation consistent with code — enforced, not remembered

Documentation drifts silently, and stale documentation is worse than none: it sends the next
reader (human or agent) to a file that isn't there or a behaviour that no longer exists.

**Any change to the codebase must leave these three consistent, in the same change:**

1. **Code comments in every file touched** — a comment that describes the old behaviour is now a
   lie. Fix it or delete it.
2. **The relevant project documentation** (this file, and any per-directory agent guidance) — if
   the change alters architecture, moves or deletes a file the docs point at, or invalidates a
   documented gotcha.
3. **The relevant published docs pages** under `docs/content/**` — if the change alters
   user-visible behaviour, configuration, or setup.

This is part of the change, not follow-up work. A PR that changes behaviour and leaves the
documentation describing the old behaviour is incomplete.

**This is enforced by a hook, not by memory.** A `PostToolUse` hook on `Edit`/`Write` (configured
in `.claude/settings.json`) fires after code edits and requires the consistency check before the
change is considered done. Mechanical checks belong in the hook wherever they can be expressed —
for example, asserting that every file path referenced in documentation still resolves, which
catches the most common and most damaging form of drift in milliseconds and with no judgement.
What a mechanical check cannot catch is prose that is merely *wrong*; that remains the author's
responsibility, and the hook exists to make sure the question is asked every time.

### Validation

```bash
cd frontend
npm run validate    # type check + lint — ALWAYS use this to verify code correctness
```

**Never use `npm run build` for validation.** It is slow and memory-intensive. Run it only before
deployment.

### Commands

```bash
cd frontend
npm run dev                # dev server, http://localhost:3000
npm run validate           # type check + lint
npm run build              # production build — deployment only
npm run lint               # ESLint
npm test                   # all Vitest projects (node + ui + orchestrator)
npm test -- <pattern>      # specific test files
npm run test:main          # only the `node` project (integration/server tests)
npm run test:ui            # only the `ui` project (jsdom *.ui.test.tsx)
npm run test:orchestrator  # only the `orchestrator` project
npm run test:e2e           # Playwright full-app e2e
npm run test:qa            # QA flows (builds a local prod server)
npm run update-workspace-template   # re-run migrations on the seed template after adding one
```

Tests run on **Vitest** (`npm test` → `vitest run`), configured in `frontend/vitest.config.ts`
with three projects: `node`, `ui`, `orchestrator`. Run one with
`npx vitest run --project=<name> <pattern>`. There is no Jest — no `jest.config.*`, no `npx jest`.

### Test taxonomy — pick by what you are testing, not by habit

- **`node` (Vitest, node env)** — integration/server tests with **no DOM**. Drive Redux by
  dispatch, hit real API route handlers in-process (`mock-fetch`), faux LLM. The fastest
  full-stack layer.
- **`ui` (Vitest, jsdom, `*.ui.test.tsx`)** — component and hook **unit** tests. Mount one
  component or `renderHook` with specific props and assert DOM/behaviour. These are unit tests,
  not e2e; keep them here. Do not migrate them to Playwright: hook-identity and render-count
  tests have no browser-observable equivalent, and component isolation would be far slower and
  flakier as a full-app flow.
- **`orchestrator` (Vitest, node env)** — the headless orchestrator/agents tree.
- **Playwright (`test/e2e/*.spec.ts`, `npm run test:e2e`)** — **full-app e2e**: a real browser
  drives the booted app under `E2E_MODE` (faux LLM via `/api/test/faux`, store exposed on
  `window.__MX_STORE__`, SVG charts). Use ONLY for genuine cross-page user flows.

If real *rendering* fidelity is ever needed for a component test (real SVG or canvas, which jsdom
stubs), the right tool is **Vitest browser mode** — component-in-real-browser as a separate
opt-in project — NOT full-app Playwright e2e.

### QA flows

A separate Playwright project (`playwright.qa.config.ts`, `test/qa/*.spec.ts`, `npm run test:qa`)
driving the **real app with real data and no faux LLM**, portable across a local prod build and a
live deployment. It asserts deterministic outcomes — query results, saved files.

**How it runs.** With no `QA_BASE_URL` it builds and starts a production server (build-time e2e
flag off, runtime e2e gate on) — **always a prod build, never `next dev`**, because the dev server
compiles routes on demand and races cold builds under parallel workers. Against a deployment, set
`QA_BASE_URL` (plus `QA_EMAIL` / `QA_PASSWORD` / `QA_E2E_SECRET`) and the webServer is skipped.

**Non-negotiable rules:**
- **Tutorial mode only — never org/production.** Every navigation and `/api/files` discovery
  carries `mode=tutorial`; mutating flows additionally `assertTutorialMode(page)` before writing
  and hard-assert created paths start with `/tutorial`. The system default is `org`, so tutorial
  is opt-in on *every* request — **a missing `mode=tutorial` silently writes to production.**
- **Real clicks and typing, not API or URL shortcuts.** Open files by clicking their tile, create
  via the Create menu, type SQL into the editor, click Save.
- **Locate elements by `aria-label` only** (`getByLabel`). If a control lacks one, add it to the
  component — do not work around it.
- **The setup chain is serial:** login → reset tutorial → wait for data → flows. Flows themselves
  run with `workers > 1` (read-only plus reset-once-up-front makes them race-free).

### Writing tests

**Chat and agent e2e tests run fully in-process** — there is no separate backend or LLM mock server.
The LLM is driven by each agent's **faux provider**: import `fauxRegistration` from the agent
module and call `setResponses([...])`. These tests exercise the full stack: Redux → listener
middleware → API route → in-process orchestrator → faux LLM, and should observe automatic
behaviours rather than manually simulating them.

**UI test element queries: `aria-label` ONLY.** Never `getByRole`, `getByText`,
`getByPlaceholderText`, `getByTestId`, or any other strategy. Every interactive element is located
via `getByLabelText` / `findByLabelText`. If an element lacks an `aria-label`, add one to the
component — do not work around it with a different query.

**`TalkToUser` is not a normal tool call for most agents — do not mock it as one.** It exists only
in the Slack agent's toolset. Every other agent replies via `stopReason: 'stop'` with plain
content. The correct faux pattern for a non-Slack agent reply is
`fauxAssistantMessage('reply text', { stopReason: 'stop' })`. Mocking `TalkToUser` as a tool call
for a non-Slack agent fails to resolve and produces the "I do not have a text reply" fallback.

### Design principles

**Deep modules (Ousterhout) — the guiding design principle of this repository.** Modules should
have simple, narrow interfaces hiding substantial implementation.

- A feature's complexity belongs in ONE cohesive module; callers compose a few deep hooks or
  functions rather than orchestrating internals.
- Components should be thin compositions. If a component grows past roughly 150 lines of logic,
  extract the subsystems into hooks or pure modules under the owning `lib/` module — pure logic in
  plain `.ts` files so it is unit-testable without a DOM.
- Prefer making an existing module **deeper** (adding capability behind the same interface) over
  adding a new shallow module or a pass-through layer. Classitis, tiny wrappers, and
  config-forwarding layers are code smells.

### Code smells to avoid

- **Inline/dynamic imports.** Always import at the top of the file. `const { foo } = await
  import('./bar')` signals a circular dependency or poor module design — fix the architecture by
  extracting shared code. Never use an inline import to "fix" a circular dependency. Enforced by
  ESLint.
- **Direct Redux state mutation.** Always use slice actions.
- **Inline API calls or data fetching in components.** Use the CORE hooks or listener middleware;
  do not reach for cascading `useEffect` chains.
- **Explicit key enumeration.** Never manually re-list every field of a typed object when you can
  pass or spread it — this causes change amplification, where adding a field to the interface means
  hunting down every place keys were listed, and you *will* miss some. The typed interface is the
  single source of truth. Extract specific keys only when the target API requires a different shape.

### Component patterns

- **Container/View separation is enforced.** Containers connect to Redux and pass data and
  callbacks down; views are pure presentation. An ESLint rule blocks `@/store/hooks` and
  `react-redux` imports in the migrated view files by name, so a regression fails `npm run validate`
  rather than review. **When touching a view: if you need new state, add it as a prop and source it
  in the container — not via a direct Redux hook.**
- **Composition over inheritance.** Build complex UIs from simple, reusable components.
- **Single responsibility.** Each component does one thing well.

### UI design — avoid "AI slop"

**Never use a coloured accent bar on the left edge of a card or panel** (for example
`borderLeft="3px solid <accent>"` to signal state). It reads as generic AI-generated design. Convey
state with existing affordances instead: badges, toggles, text colour, a subtle background tint.

### Pull requests

**Raise every PR with NO description body** — no summary, no what/why, no test plan, no descriptive
comment. Open it with an empty body (`gh pr create --body ""`). The title alone stands.

### API routes

**Always use `handleApiError` in catch blocks.** Never return `NextResponse.json({ error }, {
status: 500 })` directly.

```typescript
import { handleApiError } from '@/lib/http/api-responses';

export async function POST(req: NextRequest) {
  try {
    // ...
  } catch (error) {
    return handleApiError(error); // reports the bug and returns a consistent error shape
  }
}
```

ESLint enforces this: a direct `NextResponse.json` with `{ status: 500 }` is a lint error under
`app/api/**`. If a route genuinely needs a custom 500 shape, suppress inline with
`// eslint-disable-next-line no-restricted-syntax` and report the error manually via
`appEventRegistry.publish(AppEvents.ERROR, ...)`.

### Environment variables

- **Server-only values** (secrets, DB URLs, internal flags): import from `frontend/lib/config.ts`,
  which carries an `import 'server-only'` guard and fails the build if a client component imports it.
- **Client-safe values** (`NEXT_PUBLIC_*`, `NODE_ENV`): import from `frontend/lib/constants.ts`.
- **Never access `process.env` directly** outside those two files. Enforced by ESLint.

**Runtime-config → Redux pattern:** server config is read in `lib/config.ts`, passed as Redux
`preloadedState` at SSR, and consumed via a selector. `Semaphore` takes a *getter* for its limit so
Redux changes apply without recreating it.

### Scripts

**Scripts belong in `frontend/scripts/` as Node.js run through `tsx`.** The frontend already has
the needed dependencies; use `import { config } from 'dotenv'; config()` to load `frontend/.env`,
and add an entry to `frontend/package.json`.

### Adding agent tools and agents

1. Add the tool (an `MXTool` subclass with a TypeBox param schema) or agent under `frontend/agents/**`.
2. Register it in the orchestration core's `REGISTRABLES`; headless runners use `HEADLESS_REGISTRABLES`.
3. Implement the behaviour: server tools directly in the subclass's `execute()`; frontend-bridged
   tools register a handler in the tool-handler registry.
4. Keep the TypeBox param schema and the handler behaviour in sync — the schema is the single source
   of truth for the arguments the LLM is told it may pass.
5. A **root** agent needs a second registration: `ROOT_AGENT_BY_NAME` in the same file. `REGISTRABLES`
   only makes a class instantiable on resume; without the map entry no request can select it.
6. Adding a `{slot}` to a shared prompt is a breaking change to every other renderer of that id.
   `pyFormat` throws `Missing variable '<name>'` — it does not render the literal — so a turn dies at
   prompt assembly, not at review. Grep every `renderPrompt('<id>', …)` call site and give each the new
   slot (usually `''`).

**Tool registration is not optional.** When a tool spawns another tool, or an agent dispatches a
sub-agent, the spawned class MUST be in `REGISTRABLES` — the orchestrator instantiates it from that
registry by `schema.name` when resuming or reconstructing a saved conversation log.

**Prefer one registered class over one class per configuration.** When behaviour varies by
user-authored data rather than by code — custom agents are the case in hand — put the resolved
definition on the per-turn context and register a single class. A class per definition makes every
saved log unresumable as soon as the underlying definition is renamed or deleted.

### Database schema changes

Declare the change in `frontend/lib/database/schema/tables.ts` (PGLite and Postgres share it),
update the shared types, then re-record `frontend/lib/database/__tests__/__snapshots__/schema-shape.test.ts.snap`.
Run `npm run update-workspace-template` if the seed template is affected.

**Additive DDL needs no migration entry.** `frontend/lib/database/schema/render.ts` emits every
declared column as `ALTER TABLE … ADD COLUMN IF NOT EXISTS` alongside the `CREATE TABLE`, so a
database built from an older declaration gains new columns, tables and indexes on the next boot by
itself. A `MigrationEntry` and a `LATEST_DATA_VERSION` bump are for changes to the shape of existing
**row content** — bumping the version for a bare column add strands every unmigrated workspace
behind the data-version gate for no reason.

Two fields fail open, so declare them deliberately: a `Table` without `scope` reads as shared across
the whole deployment, and a `Unique` without `scope` reads as a global invariant.
`frontend/lib/database/schema/__tests__/equivalence.test.ts` asserts both are present precisely
because forgetting either is silent. Never smuggle raw SQL through the declaration — see
`frontend/lib/database/schema/types.ts` for why there is no such field.

### Debugging async orchestration

Debug multi-tier async execution by adding temporary logging at tier boundaries — orchestrator
stream events, tool execution results — to trace data flow through the execution loop.

### Trace a new field or tool end to end

Three defect classes from shipping the semantic tier were each invisible to a green test suite, and they share one shape: a value exists at one layer and is silently absent at the next.

- **Registration is not advertisement.** A tool present in `REGISTRABLES` but missing from an agent's `tools` array is never offered to the model — the array replaces rather than extends, and nothing errors.
- **Schema is not surface.** A field absent from the agent-facing projection (`ContextAgentContent`) is dropped by the markup round-trip in *both* directions, so agent edits vanish without a message.
- **A fold that enumerates fields drops the new one.** A writer that lists keys instead of spreading them bypasses whatever gate reads the rest.

None of these throws, so no test fails. The check is to follow the value through registry → advertisement → schema → markup → persistence in a running app, and to verify by **reading the artifact** — the stored JSON, the debug view of the exact request sent to the model — never by eyeballing output that merely looks plausible.

