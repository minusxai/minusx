# frontend/lib/connections

## What this module does

The server-side **execution and introspection tier** for every analytics engine: one `NodeConnector`
subclass per engine (DuckDB, SQLite-via-DuckDB, Postgres, BigQuery, Athena, ClickHouse, Mongo,
CSV/Sheets-via-DuckDB, internal_db), the streaming/materialization contracts they share, `:name`
parameter binding, schema introspection, column profiling (`statistics-engine.ts`), and fuzzy value
matching. It runs queries and describes databases — nothing else.

It does **not** own: connection documents or CRUD (`lib/data/connections.server.ts`), secret
resolution (`lib/secrets/connection-secrets.server.ts`), the row-cap SQL rewrite
(`lib/sql/limit-enforcer.ts`), result caching/SWR (`lib/query-cache/`), the connection-type→sqlglot
dialect map (`lib/types/connections.ts`), or any UI. Every connector and registry here imports
`server-only`; `client/` is browser code, and `named-to-positional.ts` (pure) and
`execute-query.server.ts` carry no guard despite living beside them.

## Architecture

```
caller ─→ run-query.ts :: runQueryStream ── secrets + row cap + internal_db gate ───┐
          ├─ ConnectionsAPI.getRawByName(name, user.mode)   (stored config)         │
          ├─ resolveConnectionSecrets(config)               (@SECRETS → real)       │
          ├─ getNodeConnector(name, type, config)           (index.ts factory)      │
          ├─ enforceQueryLimit(query, {dialect})            (row cap)               │
          └─ connector.queryStream(sql, params, /* no timeoutMs */, paramTypes) ────┘
                            │
   runQuery / runQueryBounded = runQueryStream + withServerTimeout + a drain
                base.ts drains: drainQueryStream (all rows)
                                drainQueryStreamBounded (row/byte budget, backpressure)
```

- **The wall-clock bound is on the materializing wrappers only.** `withServerTimeout`
  (`QUERY_SERVER_TIMEOUT_MS`) wraps `runQuery` and `runQueryBounded`; `runQueryStream` — what
  `app/api/query/route.ts` and the agent-facing `ExecuteQuery`
  (`agents/benchmark-analyst/db-tools.server.ts`) call — has no server-side timeout at all.

- **Direct `getNodeConnector` callers skip part of that chain** and are a real part of production:
  `connection-loader.ts` (schema + profiling), `fuzzy-match-tool.ts` and
  `lib/validation/content-validators.server.ts` resolve secrets themselves but get no row cap and no
  wall-clock bound; `app/api/connections/test` builds a connector from the config in the request
  body; and `lib/mcp/server.ts`'s `ExecuteQuery` calls `connector.query()` on the **stored** config —
  no `resolveConnectionSecrets`, no `enforceQueryLimit`, no `internal_db` mode gate.
- **`base.ts`** is the contract file: `QueryResult` (`columns/types/rows/finalQuery`), `QueryStream`
  (same metadata up front + a lazy `AsyncIterable` of rows), `SchemaEntry`/`SchemaTable`/
  `SchemaColumn`/`TableIndex`/`ColumnMeta`, `groupColumnsIntoSchemaEntries`, `BoundedDrainOptions`,
  the drains, and the abstract `NodeConnector`. **Streaming-first**: `queryStream()` is what
  `run-query.ts` calls. The base class supplies a `queryStream()` that wraps `query()` as a one-shot
  stream, so a connector may implement only `query()` — `InternalDbConnector` is the one that does
  (the document DB has no cursor primitive). **`query()` and `queryStream()` are two independent
  implementations against the same driver in every other connector** — no connector's `query()`
  drains its own stream (`drainQueryStream` is called only by `run-query.ts` and
  `lib/query-cache/execute.server.ts`). Change one path and you must change the other.
- **`testConnection()` is a concrete template method** on `NodeConnector`: it calls the connector's
  abstract `ping()` and optionally attaches `getSchema()`. Implement `ping()`; do not override
  `testConnection()` (`InternalDbConnector` is the one sanctioned exception — different message and
  `schema: null` shape).
- **Registries** hold expensive driver handles process-wide: `duckdb-registry.ts` (one
  `DuckDBInstance` per absolute file path — two instances on one file is an exclusive-lock error),
  `sqlite-via-duckdb-registry.ts` (in-memory DuckDB with the SQLite file `ATTACH`ed READ_ONLY as
  `db`), `pg-registry.ts` (one `Pool` per `connection_string`, or per host:port:db:user when the
  config is field-based), `clickhouse-registry.ts` (one HTTP client per url|db|user), and a
  `MongoClient`-per-URI map inside `mongo-connector.ts`. `csv-connector.ts` keeps its own in-memory
  DuckDB per `JSON.stringify(files)` cache key.
- **The DuckDB family** — `DuckDbConnector`, `SqliteConnector`, `CsvConnector` (CSV *and*
  Google Sheets) — all execute on DuckDB and share `duckdb-stream.ts` (chunked `conn.stream()` →
  JSON-safe rows), `duckdb-query.ts` (interrupt-based timeout + error normalization), and
  `duckdb-indexes.ts` (`duckdb_indexes()` → `TableIndex[]`).
- **Params**: `named-to-positional.ts` centralizes the `:name` matching *grammar* (incl. the
  `(?<!:)` lookbehind that protects `::cast`); each connector supplies only its replacement form —
  Postgres/DuckDB/SQLite/internal_db → `$N` (`namedToPositional`), BigQuery → `@name`, Athena → `?`,
  ClickHouse → `{name:Type}`. Separately, every connector sets `finalQuery` via
  `inlineSqlParams` (`lib/sql/inline-params.ts`) — a display/LLM string, never what the driver runs.
- **Schema → profile**: `connectionLoader` (`lib/data/loaders/connection-loader.ts`) calls
  `connector.getSchema()` then `profileDatabase(type, schemas, sql => connector.query(sql))` and
  caches the enriched result on the connection document. `load-schema.ts` (`loadConnectionSchema`,
  used by `SearchDBSchema`) reads `content.schema.schemas` back **through `connectionLoader`**, so
  it is an O(1) read only when a cached schema exists: with no cached schema it blocks on live
  introspection, and a stale cache is served immediately while a refresh runs in the background.
  `statistics-engine.ts` dispatches per type: `postgresql` → `pg_stats`/`pg_class`; duckdb/csv/
  google-sheets → `SUMMARIZE`; bigquery → `INFORMATION_SCHEMA` descriptions only; sqlite →
  `profileGeneric`; clickhouse → `system.columns` metadata only; mongo → `profile-mongo.ts`
  ($sample); unknown → pass-through, no enrichment.
- **Thin wrappers over a connector**: `execute-query.server.ts` (`executeQuery`) is the body of the
  **MCP** server's `ExecuteQuery` tool only — the agent-facing `ExecuteQuery`/`SearchDBSchema` tools
  live in `agents/benchmark-analyst/db-tools.server.ts` and go through `runQueryStream` +
  `loadConnectionSchema`. `fuzzy-match-tool.ts` loads the connection, validates the column is
  text/categorical, and calls `fuzzy-search.ts`. `client/` is the only browser-side code here —
  `fetch` helpers for the connection-test, CSV upload/register, and Google Sheets import/reimport
  API routes.

**Adding a connector.** Write a new `<engine>-connector.ts` here (extend `NodeConnector`: `ping`,
`query`, `getSchema`, normally `queryStream`), then register the type string in each of these — a missed
union is a `npm run validate` TS error, a missed map entry is a silent fallthrough:

| Where | What |
|---|---|
| `lib/connections/index.ts` | `getNodeConnector` branch (this file exports only the factory + `NodeConnector` — no per-connector re-exports) |
| `lib/types/connections.ts` | `DatabaseConnection.type` and `ConnectionContent.type` unions + a `connectionTypeToDialect` entry (must be a dialect `@polyglot-sql/sdk` accepts; falls back to `duckdb`) |
| `lib/data/connections.interface.ts` | `CreateConnectionInput.type` union |
| `lib/data/helpers/connections.ts` | `getSafeConfig` branch — **required**; the default `{}` hides everything and breaks the edit form |
| `lib/connections/statistics-engine.ts` | `profileDatabase` case (omit → schema without stats) |
| `lib/ui/connection-type-options.ts` | picker entry + type union, plus a `public/logos/<type>.svg` |
| `components/views/connection-configs/` | a new `<Engine>Config.tsx` + its `index.ts` export |
| `components/views/ConnectionFormV2.tsx` | every per-type branch: `connectionJson` redaction, `isFormValidForTest`, `handleTypeChange` (+ default config), `handleTest`, `handleSaveClick`, the JSX block, and the inline union casts |

Driver deps go at the top of the file — no `await import()`. Miss one of these registration spots and
you get either a TypeScript error (caught by `npm run validate`) or a silent fallthrough to the
default branch — the silent case is why the table above is exhaustive rather than illustrative.

## Gotchas

- **BigQuery date params must bind as real DATE VALUES.** `bigQueryParams` uses `BigQuery.date(v)`
  for a declared `date` param; binding a string with `types: {p: 'DATE'}` nulls the value inside
  `@google-cloud/bigquery`. Non-YMD values fall back to a plain string; `null` params still need an
  explicit `STRING` type. Locked by `__tests__/bigquery-param-types.test.ts`.
- **`paramTypes` only reaches connectors from `app/api/query/route.ts`.** `runQuery` /
  `runQueryBounded` do not forward it, so agent-issued BigQuery date filters get string binding.
- **The per-statement `timeoutMs` argument is never supplied in the app.** `runQueryStream` passes
  `undefined`, and profiling/fuzzy pass a bare `sql => connector.query(sql)`; only the benchmark
  harness (`agents/benchmark-analyst/db-tools.ts`) sets it. So DuckDB's `conn.interrupt()` timer does
  not arm on app request paths, and `/api/query` — which goes through `runQueryStream` — has **no**
  server-side time bound; its only timeout is the browser-side abort in
  `lib/file-state/query-results.ts`.
- **Timeouts abandon, they do not cancel.** `withServerTimeout` on `runQuery`/`runQueryBounded`
  (`QUERY_SERVER_TIMEOUT_MS`, default 180s, `0` disables) unblocks the caller while the warehouse
  query keeps running. DuckDB's interrupt timer is guarded by a `settled` flag — interrupting a
  connection being torn down is a native double-free.
- **`csv-connector.ts` does NOT use the shared grammar** — it has its own `/:([a-zA-Z_]\w*)/g`
  replace with no `(?<!:)` lookbehind, so `col::text` is mangled into `col:$1` on CSV/Sheets
  connections. It also re-pushes a value per occurrence instead of reusing the index.
- **Missing params never fail loudly.** `namedToPositional` pushes `null`; ClickHouse inlines the
  literal text `NULL`; **Athena pushes the four-character string `'NULL'`** as a bound value.
- **DuckDB security settings are instance-level and one-shot.** `allowed_paths` (file-backed) /
  `allowed_directories` (CSV in-memory) must be `SET` *before* `enable_external_access = false`, and
  are applied once at instance creation — they persist across every later connection, so connectors
  must not re-apply them per connection. See `__tests__/duckdb-security.test.ts`.
- **`getOrCreateDuckDbInstance` ignores `accessMode` on a cache hit** — the first caller for a path
  decides READ_ONLY vs READ_WRITE for the whole process.
- **An abandoned `QueryStream` leaks its connection/cursor.** Cleanup lives in the generator's
  `finally`; `break`ing out of a `for await` runs it, never starting iteration does not. Postgres
  (first cursor batch), ClickHouse (names+types rows), and Mongo (up to 200 sampled documents)
  additionally read eagerly before returning.
- **Mongo is not SQL.** `query` is a JSON string `{collection, pipeline}`, `params` are ignored, and
  the row cap comes from `enforceMongoLimit` inside the connector (`enforceQueryLimit` upstream is a
  no-op on unparseable input). `getNodeConnector('…','mongo',…)` works, but `mongo` is absent from
  every connection-type union and the UI picker — it is reachable only via the benchmark harness,
  which builds connectors from its own config. MongoClients are cached per URI and never closed.
- **SQLite runs on DuckDB's `sqlite_scanner`**, so the SQL dialect and column types are DuckDB's
  (INTEGER→BIGINT, TEXT→VARCHAR, REAL→DOUBLE) while `connectionTypeToDialect('sqlite')` still returns
  `'sqlite'` for limit enforcement and the IR round-trip. `USE db` is per-connection state and must be
  re-issued on every fresh connection (`queryStream` does it explicitly).
- **`internal_db` is doubly gated**: `runQueryStream` rejects it unless `user.mode === 'internals'`,
  and `assertReadOnly` parses the SQL and rejects anything unparseable or write-shaped. (The gate
  lives in `run-query.ts`, so a direct `getNodeConnector` caller only gets `assertReadOnly`.)
- **Postgres profiling degrades to plain columns** when `pg_stats` is empty (no `ANALYZE`, or the
  role lacks SELECT) — `PG_FALLBACK_TO_GENERIC` is off deliberately. `connection-loader` then keeps
  the previously cached schema rather than clobbering it with `[]`. `BQ_DEEP_SCAN` is likewise off:
  BigQuery profiling is descriptions-only, and ClickHouse profiling never scans rows (full scans on
  billion-row tables exhaust server memory).
- **`profileGeneric` and `fetchTopValues` are sequential on purpose.** A `Promise.all` fan-out issues
  N×M concurrent queries against one DuckDB instance / one PG pool and locks it up.
- **`classifyColumn` is keyword-matching on the driver's type strings.** An engine whose type names
  lack `int`/`text`/`date`/… substrings is classified by cardinality instead: `id_unique` when
  `nDistinct/rowCount >= 0.5` (including every column of a table whose `rowCount` is 0), otherwise
  `unknown`. Both map to `category: 'other'`, so the agent sees no useful stats either way.
- **`fuzzy-search.ts` interpolates the search term as a SQL literal** (escaped, 200-char clipped), not
  a bound param — anything added there must stay inside `escapeLiteral`/`escapeIdent`. In
  `fuzzyPostgres` the substring promise's `.catch` is attached *immediately*; deferring it past an
  `await` makes an unhandled rejection kill the Node process.
- **ESLint**: module-level `new Map`/`new Set` are banned (every registry carries an
  `eslint-disable-next-line no-restricted-syntax` justifying its key scoping), as are `await import()`
  and direct `process.env`. Separately (runtime, not lint) `duckdb`/`sqlite` are
  `DEV_ONLY_CONNECTION_TYPES` in `lib/data/helpers/connections.ts` — `validateConnectionType` rejects
  them outside dev.

## Code pointers

| Task | File |
|---|---|
| Change a shared contract (QueryResult/QueryStream/SchemaEntry/ColumnMeta/drains) | `base.ts` |
| Add/route a connection type | `index.ts` (`getNodeConnector`) |
| Touch the guarded execution seam (row cap, secret resolution, wall clock) | `run-query.ts` |
| Change `:name` binding grammar | `named-to-positional.ts` |
| DuckDB / CSV / SQLite streaming or timeout behavior | `duckdb-stream.ts`, `duckdb-query.ts` |
| DuckDB instance lifetime, WAL recovery, sandbox settings | `duckdb-registry.ts`, `sqlite-via-duckdb-registry.ts` |
| Postgres pooling / OID→type map / index introspection | `pg-registry.ts`, `postgres-connector.ts` |
| BigQuery job polling, paging, param typing | `bigquery-connector.ts` |
| Column stats & descriptions per engine | `statistics-engine.ts`, `profile-mongo.ts` |
| Cached-schema read used by `SearchDBSchema` | `load-schema.ts` |
| Fuzzy value lookup (SQL generation per engine) | `fuzzy-search.ts`, `fuzzy-match-tool.ts` |
| The MCP server's `ExecuteQuery` body | `execute-query.server.ts` |
| Browser-side test / upload / import helpers | `client/connection-test.ts`, `client/csv-upload.ts`, `client/google-sheets.ts` |
| Contract regressions to read before editing | `__tests__/query-stream.test.ts`, `__tests__/bounded-drain.test.ts`, `__tests__/named-to-positional.test.ts`, `__tests__/duckdb-security.test.ts`, `__tests__/bigquery-param-types.test.ts` |
