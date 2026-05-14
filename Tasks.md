# Tasks — needed future cleanups

Known, deliberate gaps (not bugs) — real follow-up work scoped out to keep
the original change bounded.

## Query timeout: remaining DB connectors

`ExecuteQuery` has a `timeout` arg and `NodeConnector.query` carries
`timeoutMs`. DuckDB-family connectors honor it (`runDuckDbWithTimeout`);
these accept but ignore it — wire each one:

- [ ] **PostgresConnector** — `SET LOCAL statement_timeout` in a txn (avoid leaking onto pooled connections).
- [ ] **BigQueryConnector** — pass `jobTimeoutMs` to the query job.
- [ ] **MongoConnector** — `maxTimeMS` option (thread through QueryLeaf).
- [ ] **AthenaConnector** — poll-with-deadline + `StopQueryExecution` (no native interrupt).

Acceptance: slow query + small `timeout` rejects with an "exceeded the Ns
timeout" error; TDD test per connector.
