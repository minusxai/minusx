import 'server-only';

import type { ColumnMeta } from '@/lib/connections/base';
import type { FlatColumn } from './schema';

/** Settings driving join discovery. Defaults are tuned for the typical
 *  benchmark dataset; callers can override per phase. */
export interface JoinDiscoveryOpts {
  /** Minimum overlap (fraction of the smaller side) to accept a join. */
  overlapThreshold?: number;
  /** Columns whose max value length exceeds this are rejected as narrative
   *  text — joining on narrative is meaningless and produces noise. */
  maxValueLength?: number;
  /** Text columns with `nDistinct` at or below this are rejected as
   *  status-enum joins (low-card joins produce N×M cross-products). */
  minTextDistinct?: number;
  /** Integer columns with `nDistinct` at or below this are rejected.
   *  Integer columns with few distinct values (e.g. `is_open`, status
   *  codes, counts ≤ ~100) overlap by chance across unrelated tables —
   *  the typical false-positive shape. A real integer FK is usually a
   *  surrogate-key column with thousands of distinct values. */
  minIntegerDistinct?: number;
  /** Per-column sample size for the verify step (passed through to the
   *  caller-supplied fetcher; the helper itself doesn't fetch). */
  sampleSize?: number;
}

const DEFAULTS: Required<JoinDiscoveryOpts> = {
  overlapThreshold: 0.1,
  maxValueLength: 256,
  minTextDistinct: 5,
  minIntegerDistinct: 100,
  sampleSize: 200,
};

/** A verified join between two columns. */
export interface JoinFinding {
  left: FlatColumn;
  right: FlatColumn;
  overlap: number;
  kind: 'direct' | 'prefix-strip';
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Coerce a sampled value to a stable string key for set membership. Null
 *  and undefined are filtered out (they never participate in a join). */
function asKey(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/** Fraction of distinct values in the smaller side that appear in the
 *  larger side. Yields 1.0 when the smaller set is fully contained. */
export function computeOverlap(a: unknown[], b: unknown[]): number {
  const aSet = new Set<string>();
  const bSet = new Set<string>();
  for (const v of a) { const k = asKey(v); if (k !== null) aSet.add(k); }
  for (const v of b) { const k = asKey(v); if (k !== null) bSet.add(k); }
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let inter = 0;
  const smaller = aSet.size < bSet.size ? aSet : bSet;
  const larger = aSet.size < bSet.size ? bSet : aSet;
  for (const k of smaller) if (larger.has(k)) inter += 1;
  return inter / smaller.size;
}

/** Longest common prefix shared by every value in the list (stringified). */
export function commonPrefix(values: unknown[]): string {
  if (values.length === 0) return '';
  const strs = values.map((v) => (v == null ? '' : String(v)));
  let prefix = strs[0];
  for (let i = 1; i < strs.length && prefix.length > 0; i++) {
    const s = strs[i];
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j += 1;
    prefix = prefix.slice(0, j);
  }
  return prefix;
}

/** Strip `prefix` from every value (no-op for values that don't start with it). */
function stripPrefix(values: unknown[], prefix: string): unknown[] {
  if (prefix.length === 0) return values;
  return values.map((v) => (typeof v === 'string' && v.startsWith(prefix) ? v.slice(prefix.length) : v));
}

/** Maximum string length among a set of values. Non-string values count
 *  as their JSON length so an `OBJECT`/`ARRAY` column doesn't sneak past
 *  the narrative-text guard. */
function maxStringLength(values: unknown[]): number {
  let max = 0;
  for (const v of values) {
    const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
    if (s.length > max) max = s.length;
  }
  return max;
}

// ─── Type / cardinality filters ──────────────────────────────────────────────

// Integer-FK family is distinct from decimal family — joining `users.id`
// (INTEGER) to `orders.amount` (NUMERIC) is a type accident, not a real FK.
const INTEGER_TYPE_KEYWORDS = ['INT', 'BIGINT', 'SMALLINT', 'TINYINT'];
const DECIMAL_TYPE_KEYWORDS = ['NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE', 'FLOAT', 'NUMBER'];
const TEXT_TYPE_KEYWORDS = ['VARCHAR', 'TEXT', 'STRING', 'CHAR', 'CHARACTER'];
const SKIP_TYPE_KEYWORDS = ['BOOL', 'TIMESTAMP', 'DATE', 'TIME', 'INTERVAL'];

type TypeFamily = 'integer' | 'decimal' | 'text' | 'other';

function typeFamily(t: string): TypeFamily {
  const u = t.toUpperCase();
  if (SKIP_TYPE_KEYWORDS.some((k) => u.includes(k))) return 'other';
  if (INTEGER_TYPE_KEYWORDS.some((k) => u.includes(k))) return 'integer';
  if (DECIMAL_TYPE_KEYWORDS.some((k) => u.includes(k))) return 'decimal';
  if (TEXT_TYPE_KEYWORDS.some((k) => u.includes(k))) return 'text';
  return 'other';
}
function isTextType(t: string): boolean { return typeFamily(t) === 'text'; }
function isJoinableType(t: string): boolean { return typeFamily(t) !== 'other'; }

/** Two columns are join-eligible by type when they share a TypeFamily. */
function typesMatch(a: string, b: string): boolean {
  const fa = typeFamily(a);
  const fb = typeFamily(b);
  return fa === fb && fa !== 'other';
}

function metaKey(c: FlatColumn): string {
  return `${c.connection}.${c.schema}.${c.table}.${c.column}`;
}

function pairKey(a: FlatColumn, b: FlatColumn): string {
  // Canonical: order endpoints lexicographically so (A,B) and (B,A) collapse.
  const ka = metaKey(a);
  const kb = metaKey(b);
  return ka < kb ? `${ka}<>${kb}` : `${kb}<>${ka}`;
}

/**
 * Propose candidate join pairs. Filters by:
 *   - both columns joinable type (numeric or text, never bool/timestamp)
 *   - same type bucket (numeric ↔ numeric, text ↔ text)
 *   - text-only: `nDistinct > minTextDistinct` (skip status-enum joins)
 *   - excludes self (same column of same table)
 *   - deduplicated canonically
 *
 * Pure — does not fetch data. Pair-membership decisions that need actual
 * values (`max length`, `overlap`) happen in `verifyJoin`.
 */
export function proposeJoinCandidates(
  schema: FlatColumn[],
  stats: Map<string, ColumnMeta>,
  opts: JoinDiscoveryOpts = {},
): Array<[FlatColumn, FlatColumn]> {
  const cfg = { ...DEFAULTS, ...opts };
  const usable = schema.filter((c) => isJoinableType(c.type));

  const out: Array<[FlatColumn, FlatColumn]> = [];
  const seen = new Set<string>();

  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i];
      const b = usable[j];
      // Skip same-table pairs entirely: within-table column overlap is
      // almost never a meaningful join relationship (engagement columns
      // like `useful`/`funny`/`cool` overlap by construction; pivot
      // joins on the same table are anti-patterns).
      if (
        a.connection === b.connection &&
        a.schema === b.schema &&
        a.table === b.table
      ) continue;
      if (!typesMatch(a.type, b.type)) continue;

      // Per-family cardinality floor when stats are available. Missing
      // stats → admit (the overlap probe in `verifyJoin` is the safety
      // net). Both sides must clear the threshold.
      const ma = stats.get(metaKey(a));
      const mb = stats.get(metaKey(b));
      if (isTextType(a.type)) {
        if (
          (ma?.nDistinct !== undefined && ma.nDistinct <= cfg.minTextDistinct) ||
          (mb?.nDistinct !== undefined && mb.nDistinct <= cfg.minTextDistinct)
        ) continue;
      } else {
        // Integer / numeric family.
        if (
          (ma?.nDistinct !== undefined && ma.nDistinct <= cfg.minIntegerDistinct) ||
          (mb?.nDistinct !== undefined && mb.nDistinct <= cfg.minIntegerDistinct)
        ) continue;
      }

      const key = pairKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  }
  return out;
}

/**
 * Verify a candidate pair given samples from each side. Two passes:
 *   1. Direct overlap.
 *   2. If direct miss, strip the longest common prefix from each side
 *      and retry (catches `<prefix>_<id>` ↔ `<otherprefix>_<id>` patterns
 *      where the same logical ID is encoded with mismatched prefixes).
 *
 * Returns `null` if neither pass meets `overlapThreshold` or if either
 * side has values longer than `maxValueLength` (narrative-text guard).
 */
export function verifyJoin(
  left: FlatColumn,
  right: FlatColumn,
  sampleA: unknown[],
  sampleB: unknown[],
  opts: JoinDiscoveryOpts = {},
): { overlap: number; kind: 'direct' | 'prefix-strip' } | null {
  const cfg = { ...DEFAULTS, ...opts };

  if (maxStringLength(sampleA) > cfg.maxValueLength) return null;
  if (maxStringLength(sampleB) > cfg.maxValueLength) return null;

  const direct = computeOverlap(sampleA, sampleB);
  if (direct >= cfg.overlapThreshold) return { overlap: direct, kind: 'direct' };

  const prefixA = commonPrefix(sampleA);
  const prefixB = commonPrefix(sampleB);
  if (prefixA.length === 0 && prefixB.length === 0) return null;

  const strippedA = stripPrefix(sampleA, prefixA);
  const strippedB = stripPrefix(sampleB, prefixB);
  const stripped = computeOverlap(strippedA, strippedB);
  if (stripped >= cfg.overlapThreshold) return { overlap: stripped, kind: 'prefix-strip' };

  return null;
}

// ─── Top-level discovery ─────────────────────────────────────────────────────

/** A callback that yields up to `sampleSize` distinct values for one
 *  column. Returns an empty array on error or unsupported column; never
 *  throws (errors are caller-handled and absorbed). */
export type FetchSampleValues = (col: FlatColumn) => Promise<unknown[]>;

/**
 * Propose → fetch (deduped) → verify, returning every verified join.
 * Samples are fetched exactly once per column even when the column
 * participates in multiple candidate pairs. Per-column fetch errors are
 * isolated — they invalidate joins involving that column but never
 * abort the whole pass.
 */
export async function discoverJoins(
  schema: FlatColumn[],
  stats: Map<string, ColumnMeta>,
  fetchSample: FetchSampleValues,
  opts: JoinDiscoveryOpts = {},
): Promise<JoinFinding[]> {
  const candidates = proposeJoinCandidates(schema, stats, opts);
  if (candidates.length === 0) return [];

  // Dedupe sample fetches per (connection, schema, table, column).
  const sampleCache = new Map<string, Promise<unknown[]>>();
  const sampleFor = (c: FlatColumn): Promise<unknown[]> => {
    const k = metaKey(c);
    let p = sampleCache.get(k);
    if (!p) {
      p = fetchSample(c).catch(() => [] as unknown[]);
      sampleCache.set(k, p);
    }
    return p;
  };

  const findings: JoinFinding[] = [];
  for (const [a, b] of candidates) {
    const [sampleA, sampleB] = await Promise.all([sampleFor(a), sampleFor(b)]);
    if (sampleA.length === 0 || sampleB.length === 0) continue;
    const v = verifyJoin(a, b, sampleA, sampleB, opts);
    if (v) findings.push({ left: a, right: b, ...v });
  }
  return findings;
}
