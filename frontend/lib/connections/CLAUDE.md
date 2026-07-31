# Connections — the analytics data plane

Driver contact: one `NodeConnector` implementation per engine — **nine of them** (DuckDB, SQLite,
Postgres, BigQuery, Athena, ClickHouse, Mongo, CSV/Google-Sheets, internal_db) — plus connection
resolution, the row-cap seam, schema introspection and column profiling. It does **not** own
connection *documents* (those
are files, loaded via `ConnectionsAPI` / `connectionLoader` in `frontend/lib/data`), SQL parsing
(`frontend/lib/sql`, see `frontend/lib/sql/CLAUDE.md`), the result cache
(`frontend/lib/query-cache/CLAUDE.md` — this module is *called by* it, never the reverse), or
credentials: it receives an already-resolved config, because `run-query.ts` calls
`resolveConnectionSecrets` immediately before handing config to the factory.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## The execution pipeline

The cache steps are sketched here only for position; they are documented in
`frontend/lib/query-cache/CLAUDE.md`.

```
browser  lib/file-state/query-results.ts  ── POST /api/query ─┐
agent    agents/benchmark-analyst/db-tools.server.ts ─ getCachedResultBounded┤
MCP      lib/mcp/server.ts ─ executeQuery ─ runQuery ─────────┤ (no cache)
server   lib/file-state/file-state.server.ts ─ runQueryBounded┘ (no cache)
                                                   │
app/api/query/route.ts                             │
  guest gate (assertGuestQueryAllowed)             │
  whitelist validate (validateQueryTables)  ← BEFORE any cache serve
  dialect (ConnectionsAPI.getRawByName)            │
  view inlining (lib/views/resolve.ts)      ← BEFORE the cache key
  ──► getCachedJsonlStream(execute)                │
                                                   ▼
                                   execute() = applyNoneParams  (lib/sql/none-params.ts)
                                             → runQueryStream   (lib/connections/run-query.ts)
                                                 → resolveConnectionSecrets
                                                 → enforceQueryLimit (lib/sql/limit-enforcer.ts)
                                                 → connector.queryStream()
```

Everything is **streaming-first**. `NodeConnector.queryStream()` returns `{columns, types, finalQuery,
rows: AsyncIterable}`. On the base class it is a *concrete* wrapper that materializes via `query()`;
eight of the nine connectors override it with a driver-native cursor (only
`internal-db-connector.ts` does not). Note that `query()` and `queryStream()` are implemented
*independently* in each connector — no connector file calls `drainQueryStream`; that happens one
level up, in `runQuery` and in the cache's degrade path. Agent consumers use
`drainQueryStreamBounded` / `getCachedResultBounded`, which stop pulling at a row/byte budget —
because the stream is pull-based, stopping also stops the connector cursor
(`lib/connections/__tests__/bounded-drain.test.ts`).

## Connectors

There are nine connector files for ten registered type strings: `csv-connector.ts` serves both `csv`
and `google-sheets`. `getNodeConnector(name, type, config)` in `lib/connections/index.ts` is the only
factory; unknown types (and a `csv`/`google-sheets` config without a `files` array) return `null`, and
`runQueryStream` throws.

Each SQL connector rewrites `:name` placeholders into its driver's form through the shared grammar in
`named-to-positional.ts` — `$N` positional via `namedToPositional` (Postgres, DuckDB, SQLite,
internal_db), `@name` (BigQuery), `?` (Athena), `{name:Type}` (ClickHouse). The grammar's `(?<!:)`
lookbehind is load-bearing: without it `col::text` becomes `col:$1` and the query dies at the colon.
Mongo ignores params entirely: its "query" is JSON `{collection, pipeline}` and its row cap is
`enforceMongoLimit`, a hand-written mirror of `enforceQueryLimit`'s 1000/10000 contract.

DuckDB, SQLite, and CSV/Sheets all execute *through DuckDB*: `duckdb-registry.ts` keys one
`DuckDBInstance` per absolute file path, `sqlite-via-duckdb-registry.ts` attaches SQLite files with
`ATTACH … (TYPE SQLITE, READ_ONLY)` (deliberately avoiding better-sqlite3 blocking the event loop),
and `csv-connector.ts` builds an in-memory instance with `httpfs` views over S3 objects. All three
share `duckdb-stream.ts` for chunked streaming and `duckdb-query.ts` for interrupt-based timeouts.
`internal-db-connector.ts` runs against the *document* DB via `getModules().db.exec`, is gated to
`mode === 'internals'` in `run-query.ts`, parses every statement and rejects any write root key (an
unparseable statement is rejected too), and deliberately does not override `queryStream` (no cursor
primitive exists there).

Schema introspection returns `SchemaEntry[]` (schema → tables → columns), optionally with `indexes`
(Postgres via `pg_index`, DuckDB/SQLite via `duckdb_indexes()` in `duckdb-indexes.ts`; absent
elsewhere — an honest absence, not a fabricated empty list). `statistics-engine.ts` enriches those
columns with `ColumnMeta` (category, null counts, top values, min/max) and dispatches per connector
type; unknown types pass through unprofiled rather than issuing speculative queries. ClickHouse
profiling is metadata-only (`system.columns`) and never scans rows.

## Adding a connector

Implement the abstract members of `NodeConnector` (`lib/connections/base.ts`) — `ping()`, `query()`
and `getSchema()` — and override `queryStream()` with a driver-native cursor. **Do not override
`testConnection()`**: it is a concrete template that calls your `ping()` and attaches the schema, and
overriding it is how the `includeSchema` branch drifts per connector.

Then register the new type string everywhere it is enumerated. The two failure modes are not
symmetric: **missing a type union is a TypeScript error that `npm run validate` catches; missing a
`switch` arm or map entry is a silent fallthrough to the default branch.**

1. `lib/connections/<newdb>-connector.ts` — the connector itself. Import its driver at the top of the
   file; inline `await import()` is banned repo-wide.
2. `lib/connections/index.ts` — import, re-export, and add a `getNodeConnector()` branch.
3. `lib/types/connections.ts` — the `DatabaseConnection.type` string-literal union **and** the
   `connectionTypeToDialect()` map.
4. `lib/data/connections.interface.ts` — `CreateConnectionInput.type` and the update interface.
5. `lib/data/helpers/connections.ts` — a `getSafeConfig` branch.
6. `lib/connections/statistics-engine.ts` — a `profileDatabase()` case.
7. `lib/ui/connection-type-options.ts` — the `CONNECTION_TYPES` entry (and its type union).
8. `components/views/connection-configs/<NewDb>Config.tsx` plus its `index.ts` export.
9. `components/views/ConnectionFormV2.tsx` — every per-type branch: the `***REDACTED***` builder,
   `isFormValidForTest()`, `handleTypeChange`, `handleTest()`, `handleSaveClick()`, the JSX render
   block, and the inline union casts.
10. `frontend/package.json` for the driver dependency, and `public/logos/<newdb>.svg`.

`app/api/connections/test/route.ts` needs no change — it dispatches through `getNodeConnector`. Start
from the closest existing connector rather than a blank file: server DB with host/port/user/password →
`postgres-connector.ts`; cloud warehouse with a JSON key → `bigquery-connector.ts`; AWS service →
`athena-connector.ts`; local file engine → `duckdb-`/`sqlite-connector.ts`; document store →
`mongo-connector.ts`.

**Mongo is the worked example of skipping steps 3–8.** It exists in `getNodeConnector` and in
`profileDatabase`, but not in `DatabaseConnection.type`, `CreateConnectionInput.type`,
`connectionTypeToDialect`, `getSafeConfig` or `CONNECTION_TYPES` — so it cannot be created or edited
through the UI, and nothing type-checked complains. `sqlite` and `internal_db` are likewise missing a
`getSafeConfig` branch.

**`getSafeConfig` is required, not optional.** Its default branch returns `{}`, which hides
*everything* — the client then receives no config at all and the connection view/edit form silently
breaks. Return the non-secret fields only; postgres (host, port, database) is the conservative model,
clickhouse additionally returns `username` on purpose because it is needed to edit and is not a secret
on its own.

**`connectionTypeToDialect` is the one source of truth for a connection's dialect string.** Its
fallback is `?? 'duckdb'`, so an omitted entry does not fail — it silently parses the new engine's SQL
as DuckDB. That string feeds the SQL↔IR round-trip (None-param resolution, the GUI-compat gate) and
`enforceQueryLimit`, so it must be a dialect the parser recognizes, and it is not always the
connector's own name: Athena maps to `presto`, Postgres to `postgres`, CSV/Sheets to `duckdb`.

**`DEV_ONLY_CONNECTION_TYPES` is only for local file engines.** `validateConnectionType`
(`lib/data/helpers/connections.ts`) rejects `duckdb`/`sqlite` outside dev. A real server or warehouse
connector must not be added to that list.

**Column classification is substring keyword matching.** `classifyColumn` (`statistics-engine.ts`)
lowercases the driver's type string and looks for `bool`, the temporal family
(`date`/`timestamp`/`time`/`datetime`/`interval`), `uuid`, the string family
(`text`/`varchar`/`character`/`string`/`char`), and the numeric family. An engine whose type names
contain none of those keywords falls through to the distinct-ratio heuristics and is classified
wrongly — extend the function rather than accepting the default.

## Gotchas

- **Cancellation is best-effort and engine-dependent, but the bound does reach the connector.**
  `runQueryStream` passes `QUERY_SERVER_TIMEOUT_MS` (180 s) as the connector's `timeoutMs`, so
  DuckDB/SQLite (`conn.interrupt()`), ClickHouse (`max_execution_time`) and Mongo (`maxTimeMS`)
  cancel for real; engines with no cancel primitive ignore it. Separately, `withServerTimeout` races
  the *materialization* so the caller and its semaphore slot are freed either way. `0` disables both:
  the connector then receives `undefined` rather than a zero-millisecond deadline. It used to pass
  `undefined` unconditionally, which meant every abandoned query kept running on the warehouse —
  pinned now by `lib/connections/__tests__/run-query-timeout.test.ts`.
- **DuckDB is sandboxed at instance creation**: `SET allowed_paths = [<db file>]` then
  `SET enable_external_access = false`, in that order, applied once per instance and inherited by
  every later connection. `lib/connections/__tests__/duckdb-security.test.ts` pins that
  `read_csv_auto`, `ATTACH`, and `glob` on arbitrary paths are blocked. A corrupt WAL is deleted and
  the open retried.
- **`enforceQueryLimit` is applied inside `runQueryStream`, not at the route.** `/api/query`, MCP, and
  headless reads inherit the cap without doing anything. Benchmark agent tools
  (`agents/benchmark-analyst/db-tools.ts`, `explore-dataset.ts`) call it themselves before dispatch —
  applying it twice is harmless — and skip it for Mongo, since it is a SQL parser.
- **`QueryResult.finalQuery` is for display only.** It comes from `inlineSqlParams`
  (`lib/sql/inline-params.ts`); the engine received a prepared statement plus bound values. It
  doubles quotes and leaves backslashes alone, which is faithful on Postgres/DuckDB/SQLite/Athena
  but **not** on ClickHouse/BigQuery/MySQL, where a backslash escapes the next character. Harmless
  only because the string is never executed — anything building SQL to *run* must use
  `escapeSqlLiteral` (`lib/sql/sql-literal.ts`).
- **Hand-built SQL must escape per dialect, and `fuzzy-search.ts` is the one place that still
  hand-builds it.** `fuzzyMatch` splices the caller's search term into `LIKE '%…%'` and
  `CONTAINS_SUBSTR(col, '…')` text rather than binding it, so `escapeFuzzyTerm(term, dialect)`
  takes the dialect and doubles backslashes on the engines that process them. Two paths reach such
  an engine: the explicit `bigquery` branch, and the `default:` branch — where ClickHouse and MySQL
  land, since neither is dispatched by name. It returns the escaped *body*, without quotes, because
  callers own the surrounding `'%…%'`. The dialect camps live in `lib/sql/sql-literal.ts`
  (`dialectProcessesBackslashEscapes`) so there is a single definition; an unknown dialect is
  assumed to process escapes. Pinned by `lib/connections/__tests__/fuzzy-escape-dialect.test.ts`
  (dialect split) and `fuzzy-escape-truncation.test.ts` (the length cap must be applied to the raw
  value, or truncation splits an escape pair and reopens the literal).
- **`ConnectionsAPI.getRawByName` is the hot-path lookup**, not `FilesAPI.loadFile`: it returns raw
  config including credential refs and never triggers schema profiling. Guarded by
  `app/api/query/__tests__/query-route-no-profiling.test.ts`.
- **Live introspection happens once, at schema-refresh time.** `lib/data/loaders/connection-loader.ts`
  calls `connector.getSchema()` then `profileDatabase()` and stores the enriched schema on the
  connection document; every later schema read (`load-schema.ts`, `SearchDBSchema`,
  `fuzzy-match-tool.ts`) is an O(1) document read.

## Key files

| Task | File |
|---|---|
| The connector contract, streaming + bounded drains | `lib/connections/base.ts` |
| Connector factory (the only one) | `lib/connections/index.ts` |
| Connection resolution, secrets, row cap, timeout | `lib/connections/run-query.ts` |
| DuckDB sandboxing / instance reuse | `lib/connections/duckdb-registry.ts` |
| SQLite-over-DuckDB attach | `lib/connections/sqlite-via-duckdb-registry.ts` |
| Chunked DuckDB streaming (DuckDB, SQLite, CSV) | `lib/connections/duckdb-stream.ts`, `lib/connections/duckdb-query.ts` |
| `:name` rewrite grammar (all dialects) | `lib/connections/named-to-positional.ts` |
| Column profiling / `ColumnMeta` | `lib/connections/statistics-engine.ts` |
| Index introspection | `lib/connections/duckdb-indexes.ts`, `lib/connections/postgres-connector.ts` |
| Mongo's row cap (`enforceMongoLimit`) | `lib/connections/mongo-connector.ts` |
| MCP / server-tool entry (uncached) | `lib/connections/execute-query.server.ts` |
| Fuzzy value matching for agents | `lib/connections/fuzzy-match-tool.ts`, `lib/connections/fuzzy-search.ts` |
| Proof the DuckDB sandbox holds | `lib/connections/__tests__/duckdb-security.test.ts` |
| Proof bounded drains stop the cursor | `lib/connections/__tests__/bounded-drain.test.ts` |
