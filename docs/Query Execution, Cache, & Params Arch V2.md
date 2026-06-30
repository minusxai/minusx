# Query Execution, Cache, & Params Arch V2

Status: **design** (not yet implemented). Supersedes the in-process `queryCache`/`queryInflight` maps in `app/api/query/route.ts`.

## Goals

1. **No full result in server RAM.** The server is a *pipe*: connector rows stream through to the client and to the cache. No in-process result map — not even an LRU.
2. **Durable, cross-instance cache** on a stale-while-revalidate (SWR) basis, with **per-file** revalidate/expiry windows.
3. **Bounded public access.** A guest of a public story may execute **only by file id** — `{fileId, params}`, never raw SQL. The server uses the file's frozen query; params are validated by their declared type and **bound**, never concatenated. No second table — the contract is the published file (§6).

## Non-goals (deferred)

- Connector-level streaming (connectors still return materialized, row-capped results) + DuckDB cross-connection joins (phase 2 — see end). JSONL suffices for joins; no Parquet.
- Raising the 10k row cap (`lib/sql/limit-enforcer.ts`) — stays as-is; it keeps single results bounded.

---

## 1. Format: JSONL everywhere

One format for the wire **and** at-rest, so the stream tees to both branches with **zero divergence**:

```
connector row-stream ──▶ JSONL encoder ──▶ tee ──┬──▶ gzip ──▶ S3 / local-file   (cache write)
                                                 └──▶ HTTP response body          (to client)
```

- **Wire:** `/api/query` returns a **streamed JSONL body** — a metadata preamble line `{columns, types, finalQuery, totalRows?}` then one JSON object per row. Errors stay non-200 JSON (unchanged envelope). Replaces today's buffered `NextResponse.json`.
- **At-rest:** **JSONL + gzip** blob in the object store. A cache read streams it back through gunzip straight to the client.
- **Why not Arrow:** only DuckDB + BigQuery are Arrow-native; the other 6 connectors yield row objects, so "Arrow everywhere" needs encoding work anyway *and* a client `apache-arrow` dep + type-mapping. JSONL is trivially produced from any connector, needs no client dep, keeps the existing `{columns,types,rows}` shape, and DuckDB can still read it (`read_ndjson`).
- **Client change:** parse JSONL incrementally at the fetch boundary into the existing `QueryResult` shape — downstream consumers (Redux `queryResultsSlice`, viz, params, query-hash, snapshots) unchanged.

Peak server RAM = **one row/batch**, never the whole result.

---

## 2. Storage: control plane (Postgres) + data plane (object store)

Split by access pattern. The blob is pure get/set → object store. The index is queried/leased/TTL'd → Postgres.

### Blob store (data plane) — stream-first interface

```ts
interface QueryCacheBlobStore {
  put(ref: string, body: Readable): Promise<void>;   // streams in (S3 multipart / fs.createWriteStream)
  getStream(ref: string): Promise<Readable | null>;  // streams out
  delete(ref: string): Promise<void>;
}
// S3QueryCacheBlobStore (hosted) | LocalFileQueryCacheBlobStore (open-source, under data/)
```

- Hosted: `@aws-sdk/lib-storage` `Upload` (multipart, no full-object buffer). Open-source: local file. Mirrors the existing S3/PGLite/DuckDB local-vs-hosted split.

### `query_cache` (control plane) — the index + lease

| column | purpose |
|---|---|
| `cache_key` PK | `${mode}:${queryHash}` — `queryHash = getQueryHash(query, params, conn)` (the same id stored as `queryResultId`). Mode-scoped, shared by authenticated + guest runs. |
| `query`, `connection_name`, `params` JSONB | what produced it |
| `final_query`, `row_count`, `col_count`, `byte_size` | metadata (kept here, not in the blob) |
| `blob_ref` | object-store key |
| `status` | `pending` \| `ready` |
| `created_at`, `revalidate_at`, `expire_at` | SWR windows |
| `lease_expires_at` | execution lease TTL (see §4) |

Sweeper deletes rows past `expire_at` + their blobs. Index on `expire_at`.

### No second table — the public contract is the published file

There is intentionally **one** new table. The public "contract" is not stored separately; it is **derived from the published file at request time** (see §6). This reuses the existing share/guest system (`meta.shares[]` + nonce + `resolveShare` + the guest JWT pinned to the story folder) as the revocable access boundary, and the question file's own `query` / `connection_name` / `parameters` / `cachePolicy` as the frozen contract. The cost: no opaque query handle (access keys off `fileId`, gated by `canAccessFile`), no public-only param *rules* unless the question schema carries them, and edits reflect live (no version-freeze) — all acceptable, and mostly desirable, for a BI tool where the publisher is the editor.

---

## 3. SWR state machine

After resolving the `query_cache` row by `cache_key`:

- **Fresh** (`now < revalidate_at`) → `getStream(blob_ref)` → response. **No lease.**
- **Stale-valid** (`revalidate_at ≤ now < expire_at`) → stream the stale blob **now** + fire-and-forget a background **revalidation** (an execution → takes the lease). On success, write new blob, bump `revalidate_at`/`expire_at`.
- **Expired / miss** (`now ≥ expire_at` or no row) → **execute** (lease) and stream the fresh result.

**Per-file windows:** `QuestionContent.cachePolicy?: { revalidateMs?, expiryMs? }` (add to `atlas-schemas.ts`). Defaults via env-overridable constants in `lib/config.ts`: `QUERY_CACHE_REVALIDATE_MS = 20*60_000`, `QUERY_CACHE_EXPIRY_MS = 60*60_000`. Clamped server-side. For the guest path, the policy is read from the file's `cachePolicy` server-side (a guest can't set it).

---

## 4. Execution lease (lease ⟺ execution, never reads)

Concurrent identical **misses/revalidations** must not all hit the warehouse. Coordinate via a **row lease in `query_cache`**, not an advisory lock (pool-safe + PGLite-safe):

1. Claim: `INSERT … (status='pending', lease_expires_at=now()+ttl) ON CONFLICT (cache_key) DO UPDATE … WHERE query_cache.lease_expires_at < now()` — winner gets the row.
2. **Winner** executes → streams to S3 (tee) → flips `status='ready'`, sets `blob_ref` + windows.
3. **Losers** poll the row, then stream the `ready` blob from S3.

- **Reads never lease** (fresh serve, and the immediate stale-serve). Only executions (miss + background revalidation) lease.
- **Stuck-lease guard:** `lease_expires_at` TTL — a crashed winner's lease is steal-able. Mandatory, or losers hang.
- **PGLite:** single-process/single-writer → requests serialize on one connection, so the lease is a graceful no-op. It earns its keep only on hosted multi-instance Postgres.
- **Cost:** +1 cheap PG round-trip per execution; negligible vs the query.

---

## 5. Consumers — one blob, two readers

- **UI (`/api/query`)** — full streamed consumer. Streams JSONL → client renders table/chart from the (capped) set.
- **Agent (`ExecuteQuery`, `agents/benchmark-analyst/db-tools.server.ts`)** — currently calls `runQuery` **directly, bypassing the cache**. Re-route it through the same cache so agent + UI share blobs and SWR. The LLM is a **finite materialized consumer**, so:
  - **Text:** decode JSONL until the char budget (`compressQueryResult`) is hit, then **stop and close the stream** — tail never materializes. (On a cache *miss*, the S3 tee branch still drains fully so the cached blob is complete.)
  - **Chart viz:** `renderChartToJpeg` needs all points → drains the full (capped) stream, renders, discards. **No early-stop for charts.** This is why the row cap stays meaningful post-streaming.
- `maxChars` is a *rendering* param, not a *data* param → does **not** affect `cache_key` (same blob, different slice).

---

## 6. Public (guest) path — derive from file (closes the anon-SQL hole)

A guest may **only** execute by file id; raw-SQL execution is rejected for guests.

```
POST /api/query  { fileId, params }   (guest session)
  → load file via FilesAPI            (canAccessFile gates it to the guest's shared folder)
  → use the file's FROZEN query + connection_name (body.query is ignored for guests)
  → spec = file.parameters (name+type) → validatePublicParams(spec, file defaults, params)
  → SWR via query_cache, key = `${mode}:${getQueryHash(query, resolvedParams, conn)}`
  → stream JSONL (result only; raw SQL never leaves the server)
```

- The guest/share path **never sends raw SQL** — it sends `{fileId, params}`, and the server uses the file's stored query. Authenticated users keep sending raw SQL on `/api/query` (Explore / in-progress edits); guests are blocked from that mode.
- Cache stays **mode-scoped** (`${mode}:${queryHash}`), so a guest run and an authenticated run of the same question share one blob — load-shedding + cross-viewer sharing for free. A guest can only ever reach keys derivable from files they're authorized for.
- Params are **bound, not string-concatenated** (security-critical invariant — verify per connector).

---

## Connector-level streaming — IMPLEMENTED (streaming-first)

The connector contract is streaming-first: `NodeConnector.queryStream()` is the primary method (`query()` drains it via `drainQueryStream`), and `runQueryStream` is the server seam the cache-write/response path consumes — so the server pipes rows `connector → JSONL → gzip → object store` write-through, **never materializing** (peak RAM = one chunk/batch). `runQuery()` (materialized) just drains the stream, so the agent (which needs the full set for text/chart) still works.

**Streams natively** (driver cursor/stream, true zero-buffer) — **8 of 9 connectors**:
- **DuckDB / SQLite / CSV(parquet)** — `conn.stream()` + `fetchChunk()` + `convertRows(JSDuckDBValueConverter)` (shared `lib/connections/duckdb-stream.ts`); connection held open across iteration, closed in the generator's `finally`. Per-chunk conversion is byte-identical to materialized `getRowObjectsJS()`.
- **Postgres** — `pg-cursor` batched server-side cursor; columns/types from the first read; client released in `finally`.
- **Mongo** — aggregation cursor iteration; columns sampled from the first batch (schemaless); cursor closed in `finally`.
- **BigQuery** — pages `job.getQueryResults` (autoPaginate off); schema from the first response.
- **ClickHouse** — `JSONCompactEachRowWithNamesAndTypes` stream (names+types as the first two rows; typed metadata preserved).
- **Athena** — `GetQueryResults` `NextToken` pagination; header row on the first page only.

**Materialized default wrapper** (correct, buffers the row-capped result): **internal_db** only — it runs through the `getModules().db.exec` abstraction (no cursor), is internals-mode-only, and serves small admin queries.

Tests: real un-mocked DuckDB streaming (multi-chunk, exact-match, lazy, no leak); mock-based control-flow tests for Postgres/Mongo/BigQuery/ClickHouse/Athena; contract tests. Verified live in the browser: miss→hit through the streaming CSV connector.

## Phase 2 (deferred)

### DuckDB cross-connection joins — JSONL is enough; NO Parquet needed
DuckDB reads NDJSON natively (`read_ndjson`/`read_json_auto`), **including gzip** — so the cache blobs we already write are directly join-able: `read_ndjson('s3://…/<key>.jsonl.gz')` over the relevant entries. No Parquet, no recompaction. The cache only does get/put/delete by key (`blob_ref` lives in Postgres) — **no `ListBucket`**. One small detail for when this lands: the blob's first line is a metadata header, so the join read must skip line 1 (or move `columns`/`types` into the `query_cache` row to make the blob pure rows). Parquet stays a *possible future optimization* only if repeated-scan performance on large cached tables becomes a bottleneck (columnar + predicate pushdown) — not a requirement.

---

## Build order (TDD)

1. **Contracts:** `QueryCacheBlobStore`, `query_cache` schema, `cachePolicy` on `QuestionContent`, JSONL stream codec.
2. **Tests (red):** SWR transitions, lease win/lose + stuck-lease steal, JSONL round-trip, param validation/rejection, public path returns no SQL.
3. **Impl (green):** streaming `/api/query`, blob store (S3 + local), lease, SWR, agent re-route, guest file-execution path (`{fileId, params}` + raw-SQL block for guests).
4. Full suite, push, browser-verify.
