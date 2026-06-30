/**
 * Query Execution, Cache & Params Arch V2 — shared contracts.
 *
 * See docs/Query Execution, Cache, & Params Arch V2.md. These types are the
 * single source of truth for the durable, cross-instance query cache that
 * replaces the in-process `queryCache`/`queryInflight` maps.
 *
 * Two planes:
 *   - control plane: the `query_cache` index row (Postgres/PGLite) — small,
 *     queried, leased, TTL'd. Modeled by {@link QueryCacheRow}.
 *   - data plane: the result blob (object store) — pure get/set, streamed.
 *     Modeled by {@link QueryCacheBlobStore}.
 */
import type { Readable } from 'stream';
import type { QueryResult } from '@/lib/connections/base';

/**
 * Per-file cache windows. Stored on `QuestionContent.cachePolicy` and copied
 * onto a `published_queries` row at publish time. Both fields are milliseconds.
 *
 * - `revalidateMs`: results younger than this are served as-is (fresh).
 * - `expiryMs`: results older than this are never served — execution blocks.
 *
 * Between the two windows a result is "stale-valid": served immediately while a
 * background revalidation refreshes it.
 */
export interface CachePolicy {
  revalidateMs: number;
  expiryMs: number;
}

/** Lifecycle of a cache index row. */
export type QueryCacheStatus = 'pending' | 'ready';

/**
 * A row in the `query_cache` control-plane table. The big result payload is NOT
 * here — it lives in the object store at `blobRef`; this row is the index +
 * lease + SWR windows.
 */
export interface QueryCacheRow {
  /** `${scope}:${queryHash}` — scope is the mode (authenticated) or `pub:{queryId}` (public). */
  cacheKey: string;
  query: string;
  connectionName: string;
  /** Resolved param values used to produce the blob (post None-resolution). */
  params: Record<string, string | number | null>;
  /** Object-store key of the gzipped-JSONL blob, or null while pending. */
  blobRef: string | null;
  finalQuery: string | null;
  rowCount: number | null;
  colCount: number | null;
  byteSize: number | null;
  status: QueryCacheStatus;
  /** Epoch ms. */
  createdAt: number;
  revalidateAt: number;
  expireAt: number;
  /** Execution-lease TTL (epoch ms). A row whose lease has passed is steal-able. */
  leaseExpiresAt: number;
}

/**
 * Result of a lease claim attempt against a cache key.
 * - `won`: this caller holds the lease and must execute + write the blob.
 * - `lost`: another caller holds a live lease; wait then read the blob.
 */
export interface LeaseClaim {
  won: boolean;
  row: QueryCacheRow;
}

/**
 * Data plane. Stream-first by contract so connector-level streaming can drop in
 * later without changing callers. v1 implementations may buffer internally
 * (results are row-capped) but the interface never forces a full in-RAM copy on
 * the caller.
 */
export interface QueryCacheBlobStore {
  /** Stream a gzipped-JSONL blob in. Resolves once fully written. */
  putStream(ref: string, body: Readable): Promise<{ byteSize: number }>;
  /** Stream a gzipped-JSONL blob out, or null if the ref is missing. */
  getStream(ref: string): Promise<Readable | null>;
  /** Convenience: fully read + decode a blob into a QueryResult (used by tests / small reads). */
  getResult(ref: string): Promise<QueryResult | null>;
  delete(ref: string): Promise<void>;
}

/**
 * The JSONL header line — the first line of every blob and of the wire body.
 * Carries everything the client needs before the rows arrive.
 */
export interface JsonlHeader {
  columns: string[];
  types: string[];
  finalQuery: string;
  rowCount: number;
}

/**
 * Optional validation rule on a query param. Type-validation alone is the
 * security floor (declared params only, bound not concatenated); these are
 * defense-in-depth. There is no published_queries table — a public (guest)
 * request derives its spec from the file's declared `parameters` (name+type),
 * so `rules` are absent unless the question schema later carries them.
 */
export interface ParamRule {
  /** Max string length (text params). */
  maxLength?: number;
  /** Closed set of allowed values; anything else is rejected. */
  enum?: Array<string | number>;
  /** Inclusive numeric bounds (number params). */
  min?: number;
  max?: number;
  /** Anchored regex source the value must fully match (text params). */
  pattern?: string;
}

/** One param a caller may override, with its validation contract (derived from the file's params). */
export interface QueryParamSpec {
  name: string;
  type: 'text' | 'number' | 'date';
  rules?: ParamRule;
}
