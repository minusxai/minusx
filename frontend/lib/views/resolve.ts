/**
 * View resolution — turns `FROM _views.<name>` into an inlined CTE.
 *
 * Views are VIRTUAL: nothing exists in the warehouse. A query that reads a view
 * is rewritten in IR land (parse → rewrite table refs → emit CTEs → generate),
 * so the engine only ever sees ordinary SQL with a `WITH` clause. That is why
 * `_views` is dialect-safe: no warehouse ever needs a schema by that name, and
 * every SQL dialect we support has CTEs.
 *
 * Views may read other views: dependencies are resolved recursively, emitted
 * once each, topologically ordered (a dependency's CTE precedes its dependent).
 * Cycles and unknown views are hard errors — never a silent wrong answer.
 *
 * Fast path: SQL that mentions no view is returned BYTE-IDENTICAL (never even
 * parsed), so existing queries keep their exact text, cache keys, and behavior —
 * including exotic SQL our parser can't handle (BigQuery wildcard tables, etc).
 */

import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { isCompoundQueryIR } from '@/lib/sql/ir-types';
import { VIEWS_SCHEMA, type ViewDef } from '@/lib/types/views';
import type { AnyQueryIR, QueryIR, TableReference } from '@/lib/sql/ir-types';

/**
 * A view whose SQL is known. Question-backed views are hydrated from their
 * question before resolution (lib/views/views.server.ts) — the resolver itself
 * never touches the database.
 */
export type HydratedView = ViewDef & { sql: string };

export class ViewResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewResolutionError';
  }
}

/** Cheap pre-check: does this SQL mention the views schema at all? */
export const mentionsViews = (sql: string): boolean =>
  new RegExp(`${VIEWS_SCHEMA}\\s*\\.`, 'i').test(sql);

/** The CTE identifier a view compiles to. Prefixed to avoid colliding with user CTEs. */
const cteName = (viewName: string): string => `${VIEWS_SCHEMA}_${viewName}`;

const isViewRef = (t: TableReference | undefined): boolean =>
  !!t && (t.schema ?? '').toLowerCase() === VIEWS_SCHEMA;

/** Every table reference in a simple query (FROM + JOINs). */
const tableRefs = (ir: QueryIR): TableReference[] =>
  [ir.from, ...(ir.joins ?? []).map((j) => j.table)].filter(Boolean) as TableReference[];

async function parse(sql: string, dialect: string): Promise<AnyQueryIR> {
  try {
    return await parseSqlToIrLocal(sql, dialect);
  } catch (err) {
    throw new ViewResolutionError(
      `could not parse SQL that references ${VIEWS_SCHEMA}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Names of the views a SQL statement reads directly (not transitively).
 * Recurses into the statement's own CTE bodies — the IR stores those as raw
 * SQL, so a view read from inside a user's `WITH` is invisible to a shallow
 * scan (and would otherwise never be inlined).
 */
export async function extractViewRefs(sql: string, dialect: string): Promise<string[]> {
  if (!mentionsViews(sql)) return [];
  const ir = await parse(sql, dialect);
  const queries = isCompoundQueryIR(ir) ? ir.queries : [ir];
  const names = new Set<string>();
  for (const q of queries) {
    for (const ref of tableRefs(q)) {
      if (isViewRef(ref)) names.add(ref.table);
    }
    for (const cte of q.ctes ?? []) {
      for (const nested of await extractViewRefs(cte.raw_sql, dialect)) names.add(nested);
    }
  }
  return [...names];
}

/** Point every `_views.x` reference at its CTE instead — including inside CTE bodies. */
async function rewriteRefs(ir: AnyQueryIR, dialect: string): Promise<AnyQueryIR> {
  const queries = isCompoundQueryIR(ir) ? ir.queries : [ir as QueryIR];
  for (const q of queries) {
    for (const ref of tableRefs(q)) {
      if (isViewRef(ref)) {
        ref.table = cteName(ref.table);
        delete ref.schema;
      }
    }
    for (const cte of q.ctes ?? []) {
      if (mentionsViews(cte.raw_sql)) cte.raw_sql = await rewriteSql(cte.raw_sql, dialect);
    }
  }
  return ir;
}

/** Parse → rewrite view refs → regenerate. */
async function rewriteSql(sql: string, dialect: string): Promise<string> {
  const ir = await rewriteRefs(await parse(sql, dialect), dialect);
  return irToSqlLocal(ir, dialect);
}

/**
 * Resolve a view's body to SQL with its own view references rewritten to CTE
 * names — the body goes INSIDE a CTE, so its dependencies are hoisted to the
 * top-level CTE list by the caller.
 *
 * A column whitelist is applied by PROJECTION: the body is wrapped so only the
 * exposed columns survive. This is real enforcement — a deselected column
 * ceases to exist downstream (the engine itself rejects a query that names it),
 * unlike hiding a raw table's column, which merely conceals it.
 */
async function viewBodySql(v: HydratedView, dialect: string): Promise<string> {
  const body = mentionsViews(v.sql) ? await rewriteSql(v.sql, dialect) : v.sql;
  // undefined = expose all. An explicit list projects to it; an EMPTY list means
  // the view was turned off — expose nothing (a column-less relation).
  if (!v.whitelistedColumns) return body;
  if (v.whitelistedColumns.length === 0) {
    // View turned off: a valid relation that yields no rows and no usable columns.
    return `SELECT NULL AS _off FROM (\n${body}\n) AS ${cteName(v.name)}_src WHERE 1 = 0`;
  }
  const cols = v.whitelistedColumns.join(', ');
  return `SELECT ${cols} FROM (\n${body}\n) AS ${cteName(v.name)}_src`;
}

/**
 * Rewrite `sql` so every view it reads (transitively) is inlined as a CTE.
 * Returns the SQL unchanged when it references no views.
 */
export async function resolveViewsInSql(
  sql: string,
  dialect: string,
  views: HydratedView[],
): Promise<string> {
  if (!mentionsViews(sql)) return sql; // fast path: untouched, unparsed

  const byName = new Map(views.map((v) => [v.name, v]));

  // Depth-first walk over the dependency graph: emits dependencies before
  // dependents (topological order) and detects cycles via the active path.
  const ordered: HydratedView[] = [];
  const done = new Set<string>();
  const active: string[] = [];

  const visit = async (name: string): Promise<void> => {
    if (done.has(name)) return;
    if (active.includes(name)) {
      throw new ViewResolutionError(
        `circular view reference: ${[...active, name].join(' → ')}`,
      );
    }
    const v = byName.get(name);
    if (!v) {
      throw new ViewResolutionError(`unknown view "${VIEWS_SCHEMA}.${name}"`);
    }
    active.push(name);
    for (const dep of await extractViewRefs(v.sql, dialect)) {
      await visit(dep);
    }
    active.pop();
    done.add(name);
    ordered.push(v);
  };

  for (const name of await extractViewRefs(sql, dialect)) {
    await visit(name);
  }

  const ir = await rewriteRefs(await parse(sql, dialect), dialect);
  const viewCtes = await Promise.all(
    ordered.map(async (v) => ({ name: cteName(v.name), raw_sql: await viewBodySql(v, dialect) })),
  );

  // View CTEs come first: the user's own CTEs may read them, never the reverse.
  if (isCompoundQueryIR(ir)) {
    // A compound (UNION) query has no top-level CTE slot — wrap each branch's
    // refs are already rewritten; attach the CTEs to the first branch, which is
    // where the generator emits the WITH clause.
    ir.queries[0].ctes = [...viewCtes, ...(ir.queries[0].ctes ?? [])];
  } else {
    const simple = ir as QueryIR;
    simple.ctes = [...viewCtes, ...(simple.ctes ?? [])];
  }
  return irToSqlLocal(ir, dialect);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A view name becomes a SQL identifier — keep it boring. */
const VALID_NAME = /^[a-z_][a-z0-9_]*$/i;

/**
 * Validate a context version's own views against the views it can already see.
 * `visible` is every OTHER view in scope — inherited from ancestors AND defined
 * by descendants (an ancestor adding a colliding name would retroactively break
 * a child, so uniqueness is enforced across the whole tree, per connection).
 */
export function validateViews(own: ViewDef[], visible: ViewDef[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const v of own) {
    const at = `View "${v.name || '(unnamed)'}"`;
    if (!v.name || !VALID_NAME.test(v.name)) {
      errors.push(`${at}: name must start with a letter or underscore and contain only letters, numbers and underscores`);
    }
    if (!v.sql?.trim()) errors.push(`${at}: SQL is empty`);
    if (!v.connection) errors.push(`${at}: missing connection`);

    const key = `${v.connection}|${v.name}`;
    if (seen.has(key)) errors.push(`${at}: defined twice in this context`);
    seen.add(key);

    const clash = visible.find((o) => o.connection === v.connection && o.name === v.name);
    if (clash) {
      errors.push(`${at}: name is already used by an inherited or descendant view on "${v.connection}" — view names are unique per connection`);
    }
  }
  return errors;
}
