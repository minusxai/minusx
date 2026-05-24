/**
 * Enforce row limits on SQL queries for safety and performance.
 * Uses @polyglot-sql/sdk (WASM) for parsing and regeneration.
 */
import { init, parse, generate, Dialect } from '@polyglot-sql/sdk';

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

/** Row cap applied to queries that arrive without an explicit LIMIT. */
export const DEFAULT_LIMIT = 1000;
/** Hard ceiling: an explicit LIMIT above this is clamped down. */
export const MAX_LIMIT = 10000;

export interface EnforceLimitOptions {
  defaultLimit?: number;
  maxLimit?: number;
  dialect: string;
}

/**
 * Enforces row limits on SQL queries.
 *
 * - If no LIMIT exists: adds LIMIT defaultLimit
 * - If LIMIT exists and exceeds maxLimit: caps at maxLimit
 * - Non-query statements (INSERT, UPDATE, DELETE, CREATE) returned unmodified
 * - Parse errors return original SQL unmodified
 */
export async function enforceQueryLimit(
  sql: string,
  options: EnforceLimitOptions,
): Promise<string> {
  const { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT, dialect } = options;

  await ensureInit();

  let ast;
  try {
    const result = parse(sql, dialect as Dialect);
    if (!result.ast || result.ast.length === 0) return sql;
    ast = result.ast[0];
  } catch {
    return sql;
  }

  // Find root query type
  const rootKey = Object.keys(ast)[0];

  // Non-query statements — return unmodified
  if (!['select', 'union', 'intersect', 'except'].includes(rootKey)) {
    return sql;
  }

  const rootNode = ast[rootKey];

  // Limit enforcement is best-effort: any failure in mutating/regenerating the
  // AST must fall back to the original SQL — never throw, never emit a JSON blob.
  try {
    // For UNION/INTERSECT/EXCEPT, the LIMIT may be on the compound node or
    // on the last SELECT branch (polyglot puts it on the last branch)
    if (rootKey === 'union' || rootKey === 'intersect' || rootKey === 'except') {
      return handleCompoundLimit(ast, rootKey, rootNode, defaultLimit, maxLimit, dialect, sql);
    }

    // Simple SELECT
    return handleSelectLimit(ast, rootNode, defaultLimit, maxLimit, dialect, sql);
  } catch {
    return sql;
  }
}

function handleSelectLimit(
  ast: any,
  selectNode: any,
  defaultLimit: number,
  maxLimit: number,
  dialect: string,
  originalSql: string,
): string {
  if (selectNode.limit) {
    // LIMIT exists — check if over max
    const currentLimit = extractLimitValue(selectNode.limit);
    if (currentLimit !== null && currentLimit > maxLimit) {
      selectNode.limit = { this: { literal: { literal_type: 'number', value: String(maxLimit) } } };
    }
  } else {
    // No LIMIT — add default
    selectNode.limit = { this: { literal: { literal_type: 'number', value: String(defaultLimit) } } };
  }

  return regenerateSql(ast, dialect) ?? originalSql;
}

function handleCompoundLimit(
  ast: any,
  rootKey: string,
  rootNode: any,
  defaultLimit: number,
  maxLimit: number,
  dialect: string,
  originalSql: string,
): string {
  // For compound queries, polyglot may put LIMIT on the rightmost SELECT
  // Check the compound node first, then the last branch
  if (rootNode.limit) {
    const currentLimit = extractLimitValue(rootNode.limit);
    if (currentLimit !== null && currentLimit > maxLimit) {
      rootNode.limit = { this: { literal: { literal_type: 'number', value: String(maxLimit) } } };
    }
    return regenerateSql(ast, dialect) ?? originalSql;
  }

  // Check last SELECT branch
  const lastSelect = findLastSelect(rootNode);
  if (lastSelect?.limit) {
    const currentLimit = extractLimitValue(lastSelect.limit);
    if (currentLimit !== null && currentLimit > maxLimit) {
      lastSelect.limit = { this: { literal: { literal_type: 'number', value: String(maxLimit) } } };
    }
    return regenerateSql(ast, dialect) ?? originalSql;
  }

  // No LIMIT found — polyglot can't add LIMIT to compound AST nodes,
  // so regenerate and append LIMIT to the SQL string. If regeneration fails
  // (null), return the original query untouched — don't append a LIMIT to a
  // query we couldn't safely re-parse.
  const regenerated = regenerateSql(ast, dialect);
  if (regenerated === null) return originalSql;
  return `${regenerated}\nLIMIT ${defaultLimit}`;
}

function findLastSelect(node: any): any {
  if (node.right?.select) return node.right.select;
  if (node.right) return findLastSelect(node.right);
  return null;
}

function extractLimitValue(limitNode: any): number | null {
  // polyglot: { this: { literal: { value: '10' } } }
  const inner = limitNode.this ?? limitNode;
  if (inner?.literal?.value) {
    try { return parseInt(inner.literal.value); } catch { return null; }
  }
  if (limitNode?.literal?.value) {
    try { return parseInt(limitNode.literal.value); } catch { return null; }
  }
  return null;
}

/**
 * Regenerate SQL from a (possibly mutated) AST. Returns `null` on failure —
 * generate() threw, or produced no SQL — so callers fall back to the original
 * query. NEVER returns JSON.stringify(ast): that would be sent to the DB as
 * `{...}` and fail with `Syntax error: Unexpected "{" at [1:1]`.
 */
function regenerateSql(ast: any, dialect: string): string | null {
  try {
    const result = generate([ast], dialect as Dialect);
    if (result.sql?.[0]) {
      let sql = result.sql[0];
      // Fix parameter placeholders — polyglot may transform :param syntax
      // Restore :param format for all dialects
      sql = sql.replace(/\$(\w+)/g, ':$1');      // $param → :param (duckdb)
      sql = sql.replace(/@(\w+)/g, ':$1');        // @param → :param (bigquery)
      sql = sql.replace(/%\((\w+)\)s/g, ':$1');   // %(param)s → :param (postgres)
      return sql;
    }
  } catch {
    // fall through
  }
  return null;
}
