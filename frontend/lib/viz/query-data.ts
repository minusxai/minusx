/**
 * Query-result → viz-column mapping: SQL type strings (as emitted by the connectors)
 * to the inferred visualization kind used by the validator and (later) the builder.
 */
import type { VizColumnKind, VizResultColumn } from './types';

const NUMERIC = /\b(int|integer|bigint|smallint|tinyint|float|double|decimal|numeric|real|number)\b/i;
const TEMPORAL = /\b(date|datetime|timestamp|time)\b/i;
const BOOLEAN = /\b(bool|boolean)\b/i;
const TEXTUAL = /\b(varchar|char|text|string|uuid|enum)\b/i;

export function sqlTypeToVizKind(sqlType: string): VizColumnKind {
  const t = sqlType ?? '';
  if (BOOLEAN.test(t)) return 'boolean';
  if (TEMPORAL.test(t)) return 'temporal';
  if (NUMERIC.test(t)) return 'quantitative';
  if (TEXTUAL.test(t)) return 'nominal';
  return 'unknown';
}

/** Zip QueryResult.columns with QueryResult.types; missing types map to 'unknown'. */
export function toVizColumns(columns: string[], types: string[]): VizResultColumn[] {
  return columns.map((name, i) => ({ name, kind: types[i] != null ? sqlTypeToVizKind(types[i]) : 'unknown' }));
}

// ISO-8601 date / datetime — how the connectors emit DATE/TIMESTAMP values into JSONL
// rows (e.g. '2024-01-01' or '2024-01-01T00:00:00.000Z').
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Infer a column kind from a single (non-null) cell value. */
export function inferVizKindFromValue(value: unknown): VizColumnKind {
  if (value == null) return 'unknown';
  if (value instanceof Date) return 'temporal';
  if (typeof value === 'number') return Number.isFinite(value) ? 'quantitative' : 'unknown';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return ISO_DATE.test(value) ? 'temporal' : 'nominal';
  return 'unknown';
}

/**
 * Infer viz column kinds from result ROWS (first non-null value per column). Used at
 * render time, where DB type metadata isn't threaded to the recipe but the data is —
 * lets a recipe pick a temporal vs. ordinal axis from the actual column type instead of
 * a format-string guess. Empty rows → no columns (recipe falls back to its format heuristic).
 */
export function inferVizColumnsFromRows(rows: Record<string, unknown>[]): VizResultColumn[] {
  if (!rows || rows.length === 0) return [];
  const names = Object.keys(rows[0] ?? {});
  return names.map(name => {
    let kind: VizColumnKind = 'unknown';
    for (const row of rows) {
      if (row[name] != null) { kind = inferVizKindFromValue(row[name]); break; }
    }
    return { name, kind };
  });
}
