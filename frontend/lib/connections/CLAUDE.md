# Connections — the analytics data plane

Driver contact: one `NodeConnector` implementation per engine (DuckDB, SQLite, Postgres, BigQuery,
Athena, ClickHouse, Mongo, CSV/Google-Sheets, internal_db), connection resolution, the row-cap seam,
schema introspection and column profiling. It does not own connection *documents* (those are files in
`frontend/lib/data`), SQL parsing (`frontend/lib/sql`, see its `CLAUDE.md`), or the result cache
(`frontend/lib/query-cache`, documented in the root `CLAUDE.md`).

The execution pipeline and the cache that wraps it are included below, because a connector change is
almost always a change to how the cache calls it.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## The execution pipeline

```
browser  lib/file-state/query-results.ts  ── POST /api/query ─┐
agent    agents/**/db-tools.server.ts ─ getCachedResultBounded┤
MCP      lib/mcp/server.ts ─ executeQuery ─ runQuery ─────────┤ (no cache)
server   lib/file-state/file-state.server.ts ─ runQueryBounded┘ (no cache)
                                                   │
app/api/query/route.ts                             │
  guest gate (assertGuestQueryAllowed)             │
  whitelist validate (validateQueryTables)  ← BEFORE any cache serve
  dialect (ConnectionsAPI.getRawByName)            │
  view inlining (lib/views/resolve.ts)      ← BEFORE the cache key
  ──► getCachedJsonlStream(execute)                │
        classifyCacheRow → fresh | stale | expired | miss
          fresh  → blob stream
          stale  → blob stream + backgroundRevalidate()
          else   → claimLease → execute() → JSONL → gzip → object store → markReady
                                                   ▼
                                   execute() = applyNoneParams  (lib/sql/none-params.ts)
                                             → runQueryStream   (lib/connections/run-query.ts)
                                             → enforceQueryLimit (lib/sql/limit-enforcer.ts)
                                             → connector.queryStream()
```

Everything is **streaming-first**. `NodeConnector.queryStream()` returns `{columns, types, finalQuery,
rows: AsyncIterable}`; `query()` is the materialized convenience built on it via `drainQueryStream`.
`queryStreamToJsonl` pipes connector → JSONL → gzip → object store with peak RAM of one chunk, and the
same blob is streamed back to the client. Agent consumers use `drainQueryStreamBounded` /
`getCachedResultBounded`, which stop pulling at a row/byte budget — because the stream is pull-based,
stopping also stops the connector cursor.

## Connectors

`getNodeConnector(name, type, config)` in `lib/connections/index.ts` is the only factory; unknown
types return `null` and `runQueryStream` throws. Each connector rewrites `:name` placeholders into its
driver's form through the shared grammar in `named-to-positional.ts` — `$N` positional (Postgres,
DuckDB, SQLite, internal_db), `@name` (BigQuery), `?` (Athena), `{name:Type}` (ClickHouse). Mongo
ignores params entirely: its "query" is JSON `{collection, pipeline}` and its row cap is
`enforceMongoLimit`, a hand-written mirror of `enforceQueryLimit`'s 1000/10000 contract.

DuckDB, SQLite, and CSV/Sheets all execute *through DuckDB*: `duckdb-registry.ts` keys one
`DuckDBInstance` per absolute file path, `sqlite-via-duckdb-registry.ts` attaches SQLite files via
`sqlite_scanner` (deliberately avoiding better-sqlite3 blocking the event loop), and `csv-connector.ts`
builds an in-memory instance with `httpfs` views over S3 objects. All three share
`duckdb-stream.ts` for chunked streaming and `duckdb-query.ts` for interrupt-based timeouts.
`internal-db-connector.ts` runs against the *document* DB via `getModules().db.exec`, is gated to
`mode === 'internals'` in `run-query.ts`, parses every statement and rejects any write root key, and
deliberately does not override `queryStream` (no cursor primitive exists there).

Schema introspection returns `SchemaEntry[]` (schema → tables → columns), optionally with `indexes`
(Postgres via `pg_index`, DuckDB/SQLite via `duckdb_indexes()`; absent elsewhere — an honest absence,
not a fabricated empty list). `statistics-engine.ts` enriches those columns with `ColumnMeta`
(category, null counts, top values, min/max) and dispatches per connector type; unknown types pass
through unprofiled rather than issuing speculative queries. ClickHouse profiling is metadata-only
(`system.columns`) and never scans rows.
