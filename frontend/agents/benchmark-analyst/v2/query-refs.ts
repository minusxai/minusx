// Extracted from explore-dataset.ts — pure helpers for query reference interpolation
// Used by both V1 ExploreDataset and V2 ExecuteQuery tools

/**
 * Replace `$label.column_name` references in a SQL query with actual values
 * from a previous query's result. E.g. `$revenue.track_id` → `4233, 5281, 10838`.
 *
 * Returns bare comma-separated values (no wrapping parens) so the agent's
 * SQL `IN ($revenue.track_id)` produces `IN (4233, 5281, 10838)`.
 *
 * - `label` matches the query's `label` field (case-sensitive).
 * - String values are single-quote escaped; numbers are bare.
 * - If the referenced label/column doesn't exist or has no rows, the
 *   replacement is `NULL` so the query still parses.
 */
export function interpolateRefs(
  sql: string,
  labeledResults: Map<string, Record<string, unknown>[]>,
): string {
  return sql.replace(/\$([a-zA-Z_]\w*)\.(\w+)/g, (_match, label, column) => {
    const rows = labeledResults.get(label);
    if (!rows || rows.length === 0) return 'NULL';

    const values = rows
      .map((r) => r[column])
      .filter((v) => v != null);

    if (values.length === 0) return 'NULL';

    const formatted = values.map((v) =>
      typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`,
    );
    return formatted.join(', ');
  });
}

/**
 * Mongo analog of `interpolateRefs` for native `{collection,pipeline}` JSON.
 * Replaces `$label.column` tokens with a JSON array literal of the referenced
 * column's values, so `{"$in": "$revenue.id"}` becomes `{"$in": [4233,5281]}`
 * — still valid JSON.
 *
 * The surrounding quotes are optional: the LLM frequently writes the SQL-habit
 * form `{"$in": $revenue.id}` (unquoted) instead of `{"$in": "$revenue.id"}`.
 * Both are interpolated to the same JSON array, so the unquoted form also
 * yields valid JSON the connector can run.
 *
 * Only *known* labels are interpolated. This is deliberate: a Mongo nested
 * field reference like `"$user.name"` matches the same `$x.y` shape, so an
 * unknown label is left untouched and treated as a field path by Mongo.
 * A missing/empty column interpolates to `[]` (a `$in: []` matches nothing).
 */
export function interpolateMongoRefs(
  json: string,
  labeledResults: Map<string, Record<string, unknown>[]>,
): string {
  return json.replace(/"?\$([a-zA-Z_]\w*)\.(\w+)"?/g, (match, label, column) => {
    const rows = labeledResults.get(label);
    if (!rows) return match; // unknown label — leave as a Mongo field path
    const values = rows.map((r) => r[column]).filter((v) => v != null);
    return JSON.stringify(values);
  });
}

/**
 * Detect an artificially small result cap. SQL: a `LIMIT n` clause with
 * `n < 1000`. Mongo: a terminal `{$limit:n}` pipeline stage with `n < 1000`.
 * Returns the offending limit, or `null` if none (and `null` on un-parseable
 * Mongo JSON — `MongoConnector.query` surfaces that error with more context).
 */
export function detectLowLimit(rawQuery: string, isMongo: boolean): number | null {
  if (isMongo) {
    let pipeline: unknown;
    try {
      pipeline = (JSON.parse(rawQuery) as { pipeline?: unknown }).pipeline;
    } catch {
      return null;
    }
    if (!Array.isArray(pipeline) || pipeline.length === 0) return null;
    const last = pipeline[pipeline.length - 1] as Record<string, unknown>;
    return typeof last?.$limit === 'number' && last.$limit < 1000 ? last.$limit : null;
  }
  const m = rawQuery.match(/\bLIMIT\s+(\d+)\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n < 1000 ? n : null;
}
