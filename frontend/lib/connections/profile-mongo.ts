import 'server-only';

import type { QueryResult, SchemaColumn, ColumnMeta } from './base';

/**
 * Mongo dialect handler for `profileDatabase`. Samples up to 100 documents
 * per collection (one $sample pipeline per collection) and derives
 * `ColumnMeta` per field — `nullCount`, `nDistinct`, `topValues`,
 * `category`, plus numeric `min/max/avg` and temporal `minDate/maxDate`.
 *
 * Mongo is schemaless, so a "null" for a given field combines:
 *   - documents where the field is explicitly `null`, and
 *   - documents where the field is missing entirely (key not present).
 *
 * Nested values (`OBJECT`, `ARRAY`) are not unpacked — their inner shape
 * surfaces via sample rows the LLM sees during note-writing. They report
 * as `category: 'other'`.
 */

type QueryFn = (sql: string) => Promise<QueryResult>;

type EnrichedTable = { schema: string; table: string; columns: SchemaColumn[] };
type TableEntry = { schema: string; table: string; columns: Array<{ name: string; type: string }> };

const SAMPLE_SIZE = 100;
const TOP_VALUES_LIMIT = 20;
const CATEGORICAL_ABSOLUTE_MAX = 100;
const CATEGORICAL_RATIO_MAX = 0.5; // permissive for 100-doc samples

type Classification = 'categorical' | 'numeric' | 'temporal' | 'text' | 'other';

/** Build a Mongo `{collection, pipeline}` query string for one $sample call. */
export function buildSampleQuery(collection: string, size: number = SAMPLE_SIZE): string {
  return JSON.stringify({ collection, pipeline: [{ $sample: { size } }] });
}

/**
 * Pick a category for a Mongo field given its inferred type and sampled
 * cardinality. Mirrors statistics-engine's classifier intent but operates
 * over Mongo's SQL-style type labels (`TEXT`, `INTEGER`, `REAL`,
 * `BOOLEAN`, `TIMESTAMP`, `OBJECT`, `ARRAY`, `UNKNOWN`).
 */
function classifyMongo(type: string, nDistinct: number, nonNullCount: number): Classification {
  const t = type.toUpperCase();
  if (t === 'TIMESTAMP') return 'temporal';
  if (t === 'INTEGER' || t === 'REAL') return 'numeric';
  if (t === 'OBJECT' || t === 'ARRAY' || t === 'BOOLEAN' || t === 'UNKNOWN') return 'other';
  // TEXT below: categorical if low cardinality, else text.
  if (t === 'TEXT') {
    const ratio = nonNullCount > 0 ? nDistinct / nonNullCount : 1;
    if (nDistinct <= CATEGORICAL_ABSOLUTE_MAX || ratio <= CATEGORICAL_RATIO_MAX) {
      return 'categorical';
    }
    return 'text';
  }
  return 'other';
}

/** Stringifiable JS value -> key for distinct counting / top-values. */
function bucketKey(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return `s:${v}`;
  if (typeof v === 'number') return `n:${v}`;
  if (typeof v === 'boolean') return `b:${v}`;
  // Skip nested for top-values — too noisy and not Comparable for a "top" sense
  return null;
}

/** Re-extract the original (untagged) value for emission in topValues. */
function rawFromKey(key: string): string | number | boolean {
  if (key.startsWith('n:')) return Number(key.slice(2));
  if (key.startsWith('b:')) return key.slice(2) === 'true';
  return key.slice(2);
}

/**
 * Build the meta for one column from its sampled non-null values, using
 * an already-decided classification.
 */
function buildMeta(
  classification: Classification,
  rowCount: number,
  nonNullValues: unknown[],
  nullCount: number,
): ColumnMeta | undefined {
  const meta: ColumnMeta = { category: classification };
  if (nullCount > 0) meta.nullCount = nullCount;

  if (classification === 'categorical') {
    const counts = new Map<string, number>();
    for (const v of nonNullValues) {
      const k = bucketKey(v);
      if (k === null) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    meta.nDistinct = counts.size;
    if (counts.size > 0 && rowCount > 0) {
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_VALUES_LIMIT);
      meta.topValues = sorted.map(([k, count]) => ({
        value: rawFromKey(k),
        count,
        fraction: count / rowCount,
      }));
    }
  } else if (classification === 'numeric') {
    const nums = nonNullValues.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (nums.length > 0) {
      meta.min = Math.min(...nums);
      meta.max = Math.max(...nums);
      meta.avg = nums.reduce((s, n) => s + n, 0) / nums.length;
    }
  } else if (classification === 'temporal') {
    const dates = nonNullValues
      .map((v) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null))
      .filter((v): v is string => v !== null)
      .sort();
    if (dates.length > 0) {
      meta.minDate = dates[0];
      meta.maxDate = dates[dates.length - 1];
    }
  }

  // If a category column had no extractable distinct values, the only thing
  // populated is `category` (+ optional nullCount). That's still informative.
  return meta;
}

/** Profile a single collection given its sample rows. Returns enriched cols. */
function enrichCollection(
  cols: Array<{ name: string; type: string }>,
  rows: Record<string, unknown>[],
): SchemaColumn[] {
  if (rows.length === 0) {
    return cols.map((c) => ({ name: c.name, type: c.type }));
  }

  return cols.map((col) => {
    const nonNullValues: unknown[] = [];
    let nullCount = 0;
    for (const row of rows) {
      const v = Object.prototype.hasOwnProperty.call(row, col.name) ? row[col.name] : undefined;
      if (v == null) {
        nullCount += 1;
      } else {
        nonNullValues.push(v);
      }
    }

    const nonNullCount = nonNullValues.length;
    const distinctApprox = (() => {
      const seen = new Set<string>();
      for (const v of nonNullValues) {
        const k = bucketKey(v);
        if (k !== null) seen.add(k);
      }
      return seen.size || nonNullCount; // fallback for non-scalar values
    })();

    const classification = classifyMongo(col.type, distinctApprox, nonNullCount);
    const meta = buildMeta(classification, rows.length, nonNullValues, nullCount);
    return { name: col.name, type: col.type, meta };
  });
}

/**
 * Top-level mongo profiler. Runs one $sample pipeline per collection via
 * the provided queryFn; per-collection failures degrade to plain columns
 * (no meta) so a single broken collection doesn't take down the whole
 * profile.
 */
export async function profileMongo(
  tables: TableEntry[],
  queryFn: QueryFn,
): Promise<EnrichedTable[]> {
  const out: EnrichedTable[] = [];
  for (const t of tables) {
    try {
      const result = await queryFn(buildSampleQuery(t.table));
      out.push({
        schema: t.schema,
        table: t.table,
        columns: enrichCollection(t.columns, result.rows ?? []),
      });
    } catch {
      // Connection blip or aggregation error — emit plain columns so the
      // table still surfaces in the catalog.
      out.push({
        schema: t.schema,
        table: t.table,
        columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
      });
    }
  }
  return out;
}
