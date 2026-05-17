// Pure helpers for `$label.column` reference interpolation, plus a
// process-lifetime session label store.
//
// Labels are scoped two ways:
// 1. **In-call**: a labeled query's result is referenceable by the next
//    `sequential: true` query in the SAME ExecuteQuery call. Held in a local
//    Map the caller constructs.
// 2. **Session**: labels also persist into a module-level store (`sessionLabels`)
//    so a *later* ExecuteQuery call can still reference them. This matches the
//    agent's natural mental model — "I labeled it last call, I can use it now"
//    — and is the only way to chain SQL → Mongo across separate tool calls
//    (handles don't apply to Mongo).
// Both V1 ExploreDataset and V2 ExecuteQuery use the interpolation functions;
// session labels are populated by ExecuteQuery on successful labeled queries.

// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process singleton
const sessionLabels = new Map<string, Record<string, unknown>[]>();

/** Record a label's rows in the session-wide store (per-call calls this on success). */
export function recordSessionLabel(label: string, rows: Record<string, unknown>[]): void {
  sessionLabels.set(label, rows);
}

/** Merge session labels into a per-call labeled-results map. Per-call labels
 *  take precedence (so an in-batch label-redefine doesn't get shadowed). */
export function mergeWithSessionLabels(
  perCall: Map<string, Record<string, unknown>[]>,
): Map<string, Record<string, unknown>[]> {
  const merged = new Map(sessionLabels);
  for (const [k, v] of perCall) merged.set(k, v);
  return merged;
}

/** Clear the session-wide label store (test/reset helper). */
export function clearSessionLabels(): void {
  sessionLabels.clear();
}

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
 * Find `$label.col` references inside a Mongo pipeline JSON that the
 * agent intended as label-substitutions but couldn't be resolved (because
 * the label wasn't in `availableLabels`).
 *
 * Scoped narrowly to `$in` / `$nin` operator values: that context
 * unambiguously expects an array, so `"$x.y"` there is a label ref, not
 * a Mongo field path. Other `$x.y` uses (e.g. inside `$project`) are
 * legitimately Mongo field paths and we leave them alone.
 *
 * Returns the deduped list of unknown label names — empty when none. The
 * caller surfaces a clear error before sending to MongoDB, since the raw
 * engine error ("$in needs an array") doesn't mention the missing label.
 *
 * Returns `[]` on un-parseable input so the engine sees its own error
 * rather than us double-reporting.
 */
export function findUnresolvedMongoLabelRefs(
  rawQuery: string,
  availableLabels: Set<string> | Map<string, unknown>,
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawQuery);
  } catch {
    return [];
  }
  const has = (k: string) =>
    availableLabels instanceof Set ? availableLabels.has(k) : availableLabels.has(k);
  const unknown = new Set<string>();
  const LABEL_REF_RE = /^\$([a-zA-Z_]\w*)\.(\w+)$/;
  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if ((k === '$in' || k === '$nin') && typeof v === 'string') {
          const m = v.match(LABEL_REF_RE);
          if (m && !has(m[1])) unknown.add(m[1]);
        } else {
          walk(v);
        }
      }
    }
  }
  walk(parsed);
  return [...unknown];
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
