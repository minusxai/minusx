# Query cache — SWR, lease, blobs

The durable result cache that wraps query execution: the `query_cache` control plane (row access, the
execution lease, SWR classification), the data plane (gzipped-JSONL blobs in the object store), the
JSONL codec that is both the wire format and the at-rest format, and the guest-share authorization
gate.

It does **not** decide *what* to execute — the caller supplies an `execute: () => Promise<QueryStream>`
thunk — and it does not own the `query_cache` DDL (that is the `QUERY_CACHE` entry in
`lib/database/schema/tables.ts`, declared `scope: 'per-namespace'`).

The two modules it sits between have their own docs: `frontend/lib/sql/CLAUDE.md` (pure text/AST work,
no I/O — the None semantics, LIMIT enforcement, whitelist validation) and
`frontend/lib/connections/CLAUDE.md` (driver contact, the connectors, the row-cap seam). The layering
is strict and one-way: **neither `lib/sql` nor `lib/connections` imports anything from here.** This
module imports `QueryResult`/`QueryStream` types from `lib/connections/base` and `isValidParamName`
from `lib/sql/none-params`, and nothing else.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## Entry points

`execute.server.ts` exports three shapes of the same resolve-then-serve flow. There is **no
`executeQueryCached` symbol** despite that name appearing in the file's own header comment:

| Function | Returns | Used by |
|---|---|---|
| `getCachedJsonlStream` | a `Readable` of JSONL | `app/api/query/route.ts` (the browser path) |
| `getCachedResultBounded` | a `QueryResult` clipped to a row/byte budget | `agents/benchmark-analyst/db-tools.server.ts` |
| `getCachedResult` | a fully materialized `QueryResult` | nothing in production today |

All three call the same private `resolve()`, so the classification, lease and degrade behaviour below
are identical regardless of which one you use.

## The cache key

`${mode}:${getQueryHash(query, params, connectionName)}`, optionally suffixed with `hashContent` of the
key-sorted `parameterTypes` when any are declared (omitted entirely otherwise, so existing keys stay
valid). **Mode-scoped, not user-scoped** — identical SQL+params in the same mode shares one blob
across all users and guests, which is safe *only because authorization happens before the cache is
touched*. `parameterTypes` are folded in because they change how a value binds at the warehouse (a
BigQuery `date` param binds as a real `DATE`), and the fold is canonicalized so map order does not
fork the key.

## SWR, the lease, and the blob

`classifyCacheRow` (`swr.ts`) is pure: `miss` (no row or no blob) / `fresh` (`now < revalidateAt`) /
`stale` (`now < expireAt`, serve + background revalidate) / `expired`. Windows come from
`resolveCachePolicy` (`policy.server.ts`) — the request's `cachePolicy` (which the client forwards
from the question's `content.cachePolicy`) overriding `QUERY_CACHE_REVALIDATE_MS` (20 min) and
`QUERY_CACHE_EXPIRY_MS` (1 hr), with expiry clamped to at least revalidate.

The lease is an `INSERT … ON CONFLICT DO UPDATE … WHERE lease_expires_at < now` in `store.server.ts`:
the winner executes, losers `waitForReady` and read the winner's blob, and a crashed holder's lease is
steal-able. The winner heartbeats at `QUERY_CACHE_LEASE_MS / 3` (floor 5 s; the lease defaults to
2 min) so a long query never lapses its own lease, and a loser's wait budget is
`QUERY_SERVER_TIMEOUT_MS + QUERY_CACHE_LEASE_MS` so it never gives up on a live winner. A claim never
clears `blob_ref`, so a stale row keeps serving while it is refreshed. Hard-expired rows plus their
blobs are swept opportunistically from the hot path (`maybeSweepExpired`, throttled to once per
10 min) — there is no cron.

On a miss the connector's `QueryStream` is piped straight through `queryStreamToJsonl` → gzip →
`putStream`, never materialized; `markReady` then records `blobRef`, `finalQuery`, row/col counts and
byte size.

**Failure contract:** **execution** errors propagate (the route turns them into 400) and release the
lease; **cache-infra** errors (object store or DB) degrade to a direct materialized execution that
serves data uncached. A blob that vanished between index read and blob read also re-executes.

## The guest gate

`guest-query.server.ts` is the boundary that makes public shares safe: an anonymous viewer's
`(query, connection)` pair must literally appear in the file at `filePath` — inline queries via
`extractInlineFileQueries` (`lib/data/file-queries.ts`), saved ones via the file's `references`
column — matched after whitespace normalization. The query is therefore *frozen by membership* and
param values are *bound, never concatenated*. `sanitizeGuestParams` coerces values to
`string | number | null` and drops params whose *name* is not identifier-shaped.

## Gotchas

- **Whitelist validation runs before the cache serve, not after.** The cache key has no `filePath`, so
  validating after a cache hit would let a user replay a query authorized under one file's context from
  a file where it is now denied. Nothing pins this — it is statement order in
  `app/api/query/route.ts`, so keep it there.
- **View inlining runs before the cache key is computed.** Editing a view's body changes the resolved
  SQL and therefore the key, invalidating stale results for free. Non-view queries take a byte-identical
  fast path and are never parsed. Pinned by `app/api/views/__tests__/query-route-views.test.ts`
  ("editing a view body BUSTS the cache").
- **The client's `getQueryHash` and the server's cache key are not the same key.** The client hashes the
  raw query; the server hashes the post-view-resolution query and prefixes `getUserKey(user)` — the
  namespace's *mode level*, e.g. `mx/org`, not the bare mode — plus the `parameterTypes` fold.
  `getQueryHash` uses `JSON.stringify(params)`, so it is param-insertion-order-sensitive by
  construction; in practice `buildQueryParamValues` emits keys in declaration order, which is what
  keeps it stable.
- **`meta.rowCount` stays authoritative under bounded reads.** `getCachedResultBounded` returns few rows
  but reports the true total from the cache row / JSONL header, so an agent is told the real size.
  `truncated` is what says the rows were clipped.
- **`forceRefresh` is refused for guests** (the route ANDs it with `!user.guest`), so a public share
  cannot be used to hammer the warehouse. It skips classification entirely but is still lease-guarded.
- **`createQueryCacheBlobStore()` is async** and defaults to `await createObjectStore()`, so blob keys
  are namespaced by construction — the injectable factory that used to let one deployment opt in is
  gone. Tests inject via `CachedExec.blobStore`.
- **A `claimLease` that *throws* is coerced to `{won: true}`** (losing the race normally returns
  `won: false` and waits). Together with the `.catch(() => null)` on the cache read, a control-plane
  outage degrades to "everybody executes", never to "nobody executes".

## Design notes

**Why JSONL, and why one codec for both directions.** The connector row-stream is JSONL-encoded exactly
once and tee'd — gzip → object store, and → the HTTP response body — so the at-rest format and the wire
format *cannot* diverge: a body is a metadata header line (`{columns, types, finalQuery}`, plus
`rowCount` only when it is already known — the streaming writer emits the header before it has
counted, so `rowCount()` is read afterwards and stored on the cache row instead) followed by one JSON
object per row. `jsonl.ts` is pure and client-safe so the browser decodes the same
bytes; `jsonl-stream.server.ts` holds the Node-only stream/gzip halves. Errors stay non-200 JSON in the
existing envelope rather than riding the stream. Arrow was rejected deliberately: only DuckDB and
BigQuery are Arrow-native, so every other connector would need encoding work anyway, and it would cost a
client-side `apache-arrow` dependency plus a type-mapping layer.

**Row/byte budgets bound reads, never the write.** On a miss, `getCachedResultBounded` still executes and
stores the *complete* result through `putStream` and only then reads it back under the budget — bounding
the write instead would persist a truncated blob that every later reader is served as if it were
complete. Only the degrade path (cache infra down, or a vanished blob) drains bounded, and it stores
nothing. The same rule is why there is no in-process result map on the server — not even an LRU: peak
server RAM on the write path is one chunk, and anything that materializes a whole result server-side to
hold onto it is outside the design.

**The execution lease is a row lease, not a Postgres advisory lock, and it is taken only for execution.**
Advisory locks are neither pool-safe (the lock follows the connection, not the request) nor available on
PGLite, so the claim is a single `INSERT … ON CONFLICT … DO UPDATE … WHERE lease_expires_at < now()`
against `query_cache`. Fresh serves and the immediate half of a stale serve take no lease at all — only
a miss, an expired entry, a `forceRefresh`, and a background revalidation do; a read never blocks behind
a writer. `lease_expires_at` is mandatory rather than an optimization: without a steal-able expiry, a
winner that crashes mid-execution hangs every waiter forever. On PGLite (single writer) the whole
mechanism is a graceful no-op that costs one cheap round-trip; it earns its keep only on multi-instance
Postgres.

## Boundaries with other areas

| Other area | Direction | Contract |
|---|---|---|
| `app/api/query/route.ts` | calls in | The only browser entry. Guest gate → whitelist validation → dialect → view inlining → `getCachedJsonlStream`. Returns `application/x-ndjson` with `X-Cache`/`X-Cached-At`/`X-Row-Count`. |
| `lib/file-state/query-results.ts` | calls in | Builds the request body, keys by `getQueryHash`, gates concurrency on `querySemaphore`, and decodes with `decodeJsonl`. It calls `response.text()`, so the client buffers even though the server streams. |
| `agents/benchmark-analyst/db-tools.server.ts` | calls in | `getCachedResultBounded` — char-budgeted agent reads. |
| `lib/mcp/server.ts` | — | `executeQuery` (`lib/connections/execute-query.server.ts`) → `runQuery`. **Bypasses this module entirely.** |
| `lib/file-state/file-state.server.ts` | — | `executeQueriesForFile` uses `applyNoneParams` + `runQueryBounded` directly. Also uncached. |
| `lib/object-store` | called by | `blob-store.ts` streams gzipped JSONL through `putStream`/`getStream`. |
| `lib/database/schema/tables.ts` | schema owner | Declares `QUERY_CACHE` (per-namespace, PK `cache_key`, index on `expire_at`); this module only reads/writes rows. |
| `lib/app-event-registry` | via the route | Exactly one `AppEvents.QUERY_EXECUTED` per request, built from `CachedMeta` so hits and misses are both recorded. |

## Key files

| Task | File |
|---|---|
| Cached execution, SWR flow, lease heartbeat, degrade paths, GC | `lib/query-cache/execute.server.ts` |
| Pure SWR classification | `lib/query-cache/swr.ts` |
| `query_cache` row access + lease SQL | `lib/query-cache/store.server.ts` |
| Policy window resolution + clamping | `lib/query-cache/policy.server.ts` |
| Blob read/write, bounded blob decode | `lib/query-cache/blob-store.ts` |
| Wire/at-rest format | `lib/query-cache/jsonl.ts` (pure), `lib/query-cache/jsonl-stream.server.ts` (Node) |
| Public-share query authorization | `lib/query-cache/guest-query.server.ts` |
| Row/meta/policy types | `lib/query-cache/types.ts` |
