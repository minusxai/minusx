# Query Execution, Cache, & Params Arch V2

Status: **design** (not yet implemented). Supersedes the in-process `queryCache`/`queryInflight` maps in `app/api/query/route.ts`.

## Goals

1. **No full result in server RAM.** The server is a *pipe*: connector rows stream through to the client and to the cache. No in-process result map — not even an LRU.
2. **Durable, cross-instance cache** on a stale-while-revalidate (SWR) basis, with **per-file** revalidate/expiry windows.
3. **Bounded public access.** A public story exposes a **`queryId`** (frozen query + connection + param contract), never raw SQL. Anonymous callers send `{queryId, params}`; params are validated by type+rules and bound, never concatenated.

## Non-goals (deferred)

- DuckDB cross-connection joins / Parquet materialization layer (phase 2 — see end).
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
| `cache_key` PK | `${scope}:${queryHash}` — scope = `userKey` (authenticated) or `pub:{queryId}` (public) |
| `query`, `connection_name`, `params` JSONB | what produced it |
| `final_query`, `row_count`, `col_count`, `byte_size` | metadata (kept here, not in the blob) |
| `blob_ref` | object-store key |
| `status` | `pending` \| `ready` |
| `created_at`, `revalidate_at`, `expire_at` | SWR windows |
| `lease_expires_at` | execution lease TTL (see §4) |

Sweeper deletes rows past `expire_at` + their blobs. Index on `expire_at`.

### `published_queries` (public contract — separate lifecycle)

Durable, admin-managed, **revocable**. Minted when a story is made public.

| column | purpose |
|---|---|
| `query_id` PK | opaque public handle (nanoid) |
| `file_id`, `file_version`, `mode` | provenance |
| `query`, `connection_name` | **frozen** server-side |
| `param_spec` JSONB | `[{name, type, rules}]` — allowlist the caller may override |
| `default_params` JSONB | defaults |
| `cache_policy` JSONB | `{revalidateMs, expiryMs}` (authoritative; copied from the file at publish) |
| `created_by`, `revoked` | admin/audit |

Two tables, two lifecycles: `published_queries` is the *definition*; `query_cache` is *ephemeral materialization*. The public path resolves the former into a concrete `(query, params)`, then uses the latter like any other query.

---

## 3. SWR state machine

After resolving the `query_cache` row by `cache_key`:

- **Fresh** (`now < revalidate_at`) → `getStream(blob_ref)` → response. **No lease.**
- **Stale-valid** (`revalidate_at ≤ now < expire_at`) → stream the stale blob **now** + fire-and-forget a background **revalidation** (an execution → takes the lease). On success, write new blob, bump `revalidate_at`/`expire_at`.
- **Expired / miss** (`now ≥ expire_at` or no row) → **execute** (lease) and stream the fresh result.

**Per-file windows:** `QuestionContent.cachePolicy?: { revalidateMs?, expiryMs? }` (add to `atlas-schemas.ts`). Defaults via env-overridable constants in `lib/config.ts`: `QUERY_CACHE_REVALIDATE_MS = 20*60_000`, `QUERY_CACHE_EXPIRY_MS = 60*60_000`. Clamped server-side. For the public path, the policy comes from `published_queries.cache_policy` (a viewer can't set it).

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

## 6. Public `queryId` path (closes the anon-SQL hole)

```
POST /api/q/{queryId}  { params }
  → load published_queries[queryId]            (404 if missing/revoked)
  → validate params against param_spec         (type + rules; reject unknown keys)
  → build concrete (query, params) from FROZEN query
  → SWR via query_cache, key = `pub:{queryId}:{hash(normalizedParams)}`
  → stream JSONL (result only; raw SQL never leaves the server)
```

- The guest/share path **stops calling `/api/query` with raw SQL**; public stories execute via `queryId`.
- Public cache entries are scoped by `queryId` (+ normalized params), **shared across all anonymous viewers** — the cache doubles as load-shedding + access control.
- Params are **bound, not string-concatenated** (security-critical invariant — verify per connector).

---

## Phase 2 (deferred): Parquet materialization layer

For DuckDB cross-connection joins, a *separate* uncapped layer: full tables streamed per-connector → **Parquet** on S3 (or DuckDB `COPY … TO 's3://'` directly), produced by background compaction. Parquet (not Arrow) for columnar + stats + predicate pushdown on repeated scans. Independent of the interactive JSONL cache above.

---

## Build order (TDD)

1. **Contracts:** `QueryCacheBlobStore`, `query_cache` + `published_queries` schema (+ migration, `update-workspace-template`), `cachePolicy` on `QuestionContent`, JSONL stream codec.
2. **Tests (red):** SWR transitions, lease win/lose + stuck-lease steal, JSONL round-trip, param validation/rejection, public path returns no SQL.
3. **Impl (green):** streaming `/api/query`, blob store (S3 + local), lease, SWR, agent re-route, `/api/q/{queryId}`.
4. Full suite, push, browser-verify.
