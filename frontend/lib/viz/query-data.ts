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
