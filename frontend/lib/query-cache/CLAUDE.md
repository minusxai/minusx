# Query data plane — execution and caching

Everything between "there is a query string" and "rows exist", and the durable SWR + lease + blob
cache that wraps it.

The two modules either side have their own docs: `frontend/lib/sql/CLAUDE.md` (pure text/AST work,
no I/O) and `frontend/lib/connections/CLAUDE.md` (driver contact).

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

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
| Add a connector | `lib/connections/base.ts` + the ten enumerated registration points |
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
