# Adding a New Database Connector

End-to-end checklist for adding a new analytics connector. A connector touches three layers:

1. **Connector layer** (`lib/connections/`) — the driver that runs queries & introspects schema.
2. **Type / dialect system** (`lib/types.ts`, `lib/utils/`, `lib/data/`) — the union of connection-type strings and the dialect mapping that flow through the whole stack.
3. **UI** (`lib/ui/`, `components/views/connection-configs/`, `components/views/ConnectionFormV2.tsx`) — the picker, config form, and validation.

Throughout, the placeholder names are:
- `newdb` — the new connection-type string literal (replace with e.g. `clickhouse`, `snowflake`)
- `NewDb` — the PascalCase name
- `NewDbConnector` — the connector class, in `newdb-connector.ts`
- `NewDbConfig` — the config interface (in `base.ts`) and the config UI component (`NewDbConfig.tsx`)

> **TDD (see CLAUDE.md):** write the failing connector test first (red), then implement to green.
> The connector layer is the easiest to test in isolation — mock the driver client and assert the
> `query()` / `getSchema()` / `testConnection()` return shapes.

The architecture is modular: implement the abstract `NodeConnector` class, then register the new
`newdb` string in ~7 enumerated spots. Miss one union and you get a TS error (caught by
`npm run validate`) or a silent fallthrough to the default branch.

---

## Pick the closest existing template

Copy structure from whichever existing connector is closest to the new engine:

| New engine shape | Template connector | Template config UI |
|---|---|---|
| TCP/HTTP server DB with host/port/user/password (Postgres-like, Snowflake, MySQL) | `postgres-connector.ts` | `PostgreSQLConfig.tsx` |
| Cloud warehouse with a JSON/key credential | `bigquery-connector.ts` | `BigQueryConfig.tsx` |
| AWS service (region + keys + staging) | `athena-connector.ts` | `AthenaConfig.tsx` |
| Local file-based engine | `duckdb-connector.ts` / `sqlite-connector.ts` | `DuckDBConfig.tsx` / `SqliteConfig.tsx` |
| Document store with a non-SQL query language | `mongo-connector.ts` | — |

---

## Step 1 — Add the config shape & dialect to `base.ts`

`frontend/lib/connections/base.ts`

- Add a config interface near the other `*Config` interfaces (line ~69). Mirror an existing one —
  e.g. `PostgresConfig` (line 73) for a server DB:
  ```typescript
  export interface NewDbConfig {
    host: string;
    port?: number;
    database: string;
    username: string;
    password?: string;
  }
  ```
- Add it to `ConnectorConfigMap` (line ~111): `'newdb': NewDbConfig;`
  This automatically extends the `ConnectorDialect` union (line 123).

The contract a connector must implement (`NodeConnector`, line 129):
- `testConnection(includeSchema?)` → `{ success, message, schema? }`
- `query(query, params?, timeoutMs?)` → `QueryResult` (`{ columns, types, rows, finalQuery }`)
- `getSchema()` → `SchemaEntry[]` (`{ schema, tables: [{ table, columns, indexes? }] }`)

`indexes` is optional — leave it `undefined` when the engine has no index concept that maps cleanly
(BigQuery, Athena, CSV already do this — see the doc comment at `base.ts:25`). `timeoutMs` is a
best-effort cancellation hint; honour it if the driver supports it, otherwise ignore it.

---

## Step 2 — Implement the connector

Create `frontend/lib/connections/newdb-connector.ts`, extending `NodeConnector`. Skeleton
(structure follows `postgres-connector.ts`):

```typescript
import 'server-only';
import type { QueryResult, SchemaEntry, TestConnectionResult } from './base';
import { NodeConnector as NodeConnectorBase } from './base';
import { inlineSqlParams } from '@/lib/sql/inline-params';
// import the driver client at the TOP (no inline await import — CLAUDE.md)

export class NewDbConnector extends NodeConnectorBase {
  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      // ping / SELECT 1
      if (includeSchema) {
        const schemas = await this.getSchema();
        return { success: true, message: 'Connection successful', schema: { schemas } };
      }
      return { success: true, message: 'Connection successful' };
    } catch (err: any) {
      return { success: false, message: err?.message ?? String(err) };
    }
  }

  async query(sql: string, params?: Record<string, string | number>, timeoutMs?: number): Promise<QueryResult> {
    const finalQuery = inlineSqlParams(sql, params); // for display/logging — see below
    // run query, then map driver result → { columns, types, rows }
    return { columns, types, rows, finalQuery };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    // introspect columns, group into SchemaEntry[] by schema/database name,
    // excluding the engine's system schemas
  }
}
```

**Implementation notes / gotchas:**
- **`finalQuery` & params:** SQL connectors produce `finalQuery` via `inlineSqlParams(sql, params)` —
  this is the literal-substituted SQL shown to users/LLMs (`QueryResult.finalQuery` doc at `base.ts:55`).
  Separately, the driver needs the params in *its* binding form. Existing connectors convert `:name`
  to the driver's placeholder: Postgres → `$N` (`namedToPositional`), BigQuery → `@name`, Athena → `?`.
  Match whatever the new driver expects (or inline literals directly).
- **Schema introspection:** query the engine's catalog (`information_schema.columns`, a `system.*`
  table, a catalog API, etc.), group into `SchemaEntry[]` by schema/database, and **exclude system
  schemas** (Postgres excludes `pg_catalog`/`information_schema` — `postgres-connector.ts:67`).
- **Type strings:** map driver column types into `QueryResult.types`. Column classification in
  `statistics-engine.ts:classifyColumn` is keyword-based (`bool`, `date`/`timestamp`, `text`/`varchar`,
  numeric…) — verify the new engine's type names contain matchable keywords, or extend that function.
- **Connection reuse:** Postgres/DuckDB cache pools/instances in `*-registry.ts`. Add a
  `newdb-registry.ts` if the client is expensive to create per-call; skip it if it's cheap.

---

## Step 3 — Register in the factory & re-exports

`frontend/lib/connections/index.ts`

- Import: `import { NewDbConnector } from './newdb-connector';`
- Add the config type to the type re-export block (line ~12) and `export { NewDbConnector };` (line ~30).
- Add a branch to `getNodeConnector()` (line 48):
  ```typescript
  if (type === 'newdb') {
    return new NewDbConnector(name, config);
  }
  ```

---

## Step 4 — Add `newdb` to all connection-type unions & dialect maps

The literal must be added to **every** enumerated union, or TS errors / the value silently falls through:

| File | Location | What |
|---|---|---|
| `lib/types.ts` | `DatabaseConnection.type` (~884) | add `\| 'newdb'` |
| `lib/types.ts` | `DatabaseConnectionCreate.type` (~890) | add `\| 'newdb'` |
| `lib/types.ts` | `ConnectionContent.type` (~951) | add `\| 'newdb'` |
| `lib/types.ts` | `connectionTypeToDialect()` map (~1350) | add `newdb: '<sqlglot-dialect-name>'` |
| `lib/utils/connection-dialect.ts` | `switch` (~4) | add `case 'newdb': return '<sqlglot-dialect-name>';` |
| `lib/data/connections.interface.ts` | `CreateConnectionInput.type` (~84) + update interface (~90) | add `\| 'newdb'` |

> ⚠️ There are **two** `connectionTypeToDialect` functions (`lib/types.ts` and
> `lib/utils/connection-dialect.ts`) — and they already disagree on Athena (`presto` vs `awsathena`).
> Update **both**. The dialect string feeds the SQL IR round-trip used by the parameter system
> (`applyNoneParams` in `app/api/query/route.ts`), so it must be a dialect sqlglot recognizes.

---

## Step 5 — `getSafeConfig` (credential filtering)

`frontend/lib/data/helpers/connections.ts` → `getSafeConfig` (line ~49)

Add a branch returning only non-secret fields (**never** passwords / keys / tokens):
```typescript
if (type === 'newdb') {
  return { host: config.host, port: config.port, database: config.database };
}
```
This is **required** — the default `return {}` hides *everything*, which breaks the view/edit form
(the client gets no config back to render). Mirror the postgres branch (line ~62), which drops
`username`/`password`.

`DEV_ONLY_CONNECTION_TYPES` (line 15) is only for local file engines (duckdb/sqlite, blocked in
production by `validateConnectionType`). A real server/warehouse connector should **not** be listed there.

---

## Step 6 — Profiling / statistics engine

`frontend/lib/connections/statistics-engine.ts` → `profileDatabase()` switch (line 72)

Add a case. For a standard-SQL engine, `profileGeneric` (COUNT(DISTINCT), SUM(CASE WHEN … IS NULL))
usually works — pass the engine's float type name (sqlite uses `'double'`, line 85):
```typescript
case 'newdb':
  enrichedTables = await profileGeneric(allTables, countedQueryFn, '<engine-float-type>');
  break;
```
If the engine has cheap catalog-based stats (like Postgres' `pg_stats` → `profilePostgres`, or
DuckDB's `SUMMARIZE` → `profileDuckDb`), write a dedicated `profileNewDb()`. Without a case, the
`default` branch returns the schema **without** column stats — safe, but no enrichment.

Profiling is triggered during schema refresh in `lib/data/loaders/connection-loader.ts` and cached on
the connection document — no change needed there.

---

## Step 7 — UI: picker, config form, validation

**7a. Connection-type picker** — `frontend/lib/ui/connection-type-options.ts`
- Add `'newdb'` to the `ConnectionTypeOption.type` union (line 2) if not already present.
- Add (or, if already stubbed as `comingSoon`, flip live) the `CONNECTION_TYPES` entry (line 14):
  ```typescript
  {
    type: 'newdb',
    name: 'NewDb',
    logo: '/logos/newdb.svg',          // add the SVG to /public/logos
    comingSoon: false,
    group: 'external-engine',           // or 'minusx-warehouse' for managed/uploaded data
    description: '…',
  },
  ```

**7b. Config form component** — create `frontend/components/views/connection-configs/NewDbConfig.tsx`.
Copy the closest existing one (e.g. `PostgreSQLConfig.tsx` for host/port/user/password). Then add an
export line to `connection-configs/index.ts`.

**7c. Wire into `ConnectionFormV2.tsx`** — this file branches per type; search for an existing type
(e.g. `'postgresql'`) and add a sibling `'newdb'` branch everywhere it appears:
- Import `NewDbConfig` from `./connection-configs` (line 45).
- `connectionJson` redaction builder (line ~331) — add a branch redacting secrets.
- `isFormValidForTest()` (line ~395) — add `else if (content.type === 'newdb')` validation.
- `handleTypeChange` (line 437) — add `'newdb'` to the signature union and, if its default config
  differs from the `?? { host, port, database, username, password }` fallback, add a `configByType` entry.
- `handleTest()` (line ~452) — add a branch calling `testConnection(content.type, config, …)`
  (mirror the postgres branch ~line 514).
- `handleSaveClick()` (line ~603) — add a validation branch (mirror postgres ~line 640).
- JSX render block (line ~1170) — add:
  ```tsx
  {content.type === 'newdb' && (
    <NewDbConfig config={config} onChange={(c) => onChange({ config: c })} mode={mode} />
  )}
  ```
- The inline `as 'bigquery' | …` union cast at line 309 — add `'newdb'`.

> Several inline union-literal casts here are change-amplification hot spots (CLAUDE.md warns against
> explicit key enumeration). Adding `'newdb'` to each is unavoidable, but `npm run validate` flags any
> you miss.

The test API route `app/api/connections/test/route.ts` dispatches via `getNodeConnector` — no change
needed (covered by Step 3).

---

## Step 8 — Driver dependency

`frontend/package.json` — add the engine's official Node client:
```bash
cd frontend && npm install <driver-package>
```
Import it at the **top** of `newdb-connector.ts` — no inline `await import()` (CLAUDE.md).
Existing driver deps for reference: `pg`, `@google-cloud/bigquery`, `@aws-sdk/client-athena`,
`@aws-sdk/client-glue`, `@duckdb/node-api`, `better-sqlite3`, `mongodb`.

---

## Step 9 — Tests (write the connector test FIRST — red → green)

`frontend/lib/connections/__tests__/` — pattern: mock the driver, assert connector behavior. Add to
`connections.test.ts` or create `newdb-connector.test.ts`:
- `vi.mock('<driver-package>')` with a fake client.
- A `NEWDB_BASE_CONFIG` constant.
- `testConnection()` → success / auth-failure / `includeSchema` cases.
- `query()` → correct `columns`/`types`/`rows`; param substitution; `finalQuery` shape.
- `getSchema()` → `SchemaEntry[]` grouped by schema, system schemas excluded.

Run: `npm run test:main -- newdb` then `npm run validate`.

---

## Quick checklist

- [ ] `base.ts` — `NewDbConfig` interface + `ConnectorConfigMap` entry
- [ ] `newdb-connector.ts` — implement `NodeConnector` (`testConnection`/`query`/`getSchema`)
- [ ] `index.ts` — import, re-export, `getNodeConnector` branch
- [ ] `lib/types.ts` — 3 unions (884/890/951) + `connectionTypeToDialect`
- [ ] `lib/utils/connection-dialect.ts` — `case 'newdb'`
- [ ] `lib/data/connections.interface.ts` — 2 unions
- [ ] `lib/data/helpers/connections.ts` — `getSafeConfig` branch (required)
- [ ] `statistics-engine.ts` — `profileDatabase` case
- [ ] `connection-type-options.ts` — add/flip entry to live (+ type union)
- [ ] `NewDbConfig.tsx` + `connection-configs/index.ts` export
- [ ] `ConnectionFormV2.tsx` — all per-type branches + union casts
- [ ] `package.json` — driver dependency
- [ ] `/public/logos/newdb.svg` — add the logo
- [ ] Tests + `npm run validate`
