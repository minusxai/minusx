# Tasks — needed future cleanups

Known, deliberate gaps (not bugs) — real follow-up work scoped out to keep
the original change bounded.

## Query timeout: remaining DB connectors

`ExecuteQuery` has a `timeout` arg and `NodeConnector.query` carries
`timeoutMs`. DuckDB-family connectors honor it (`runDuckDbWithTimeout`);
these accept but ignore it — wire each one:

- [ ] **PostgresConnector** — `SET LOCAL statement_timeout` in a txn (avoid leaking onto pooled connections).
- [ ] **BigQueryConnector** — pass `jobTimeoutMs` to the query job.
- [x] **MongoConnector** — `maxTimeMS` option. Done alongside the native-pipeline rewrite: `query()` passes `{ maxTimeMS: timeoutMs }` to `aggregate()`.
- [ ] **AthenaConnector** — poll-with-deadline + `StopQueryExecution` (no native interrupt).

Acceptance: slow query + small `timeout` rejects with an "exceeded the Ns
timeout" error; TDD test per connector.

## Query timeout: wire it through the production ExecuteQuery path

`BaseExecuteQuery` honors `timeout` on the benchmark path (`local.query`).
The production `ExecuteQuery` (`db-tools.server.ts`) routes through
`_executeFallback` → `runQuery`, which does **not** forward `timeoutMs` —
so the production tool currently hides the `timeout` param entirely
(`ExecuteQueryParamsNoTimeout` + `EXECUTE_QUERY_DESCRIPTION` without the
timeout note) rather than advertising a capability it doesn't deliver.

- [ ] Thread `timeoutMs` through `_executeFallback` → `runQuery` → the
      underlying connector's `query(sql, params, timeoutMs)`.
- [ ] Then restore the full schema on `db-tools.server.ts::ExecuteQuery`
      — drop the `static override schema`, let it inherit `BaseExecuteQuery`'s
      schema (with `timeout`), and delete the `ExecuteQueryParamsNoTimeout`
      / `EXECUTE_QUERY_DESCRIPTION` split if no longer needed.

Depends on the connector wiring above (DuckDB/SQLite already honor
`timeoutMs`; Postgres/BigQuery/Mongo/Athena are the gating items).
