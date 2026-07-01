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
    // LIMIT exists — cap it only if over max, then regenerate.
    const currentLimit = extractLimitValue(selectNode.limit);
    if (currentLimit !== null && currentLimit > maxLimit) {
      selectNode.limit = { this: { literal: { literal_type: 'number', value: String(maxLimit) } } };
      return regenerateSql(ast, dialect) ?? originalSql;
    }
    // LIMIT already within bounds — return the query UNCHANGED. Regenerating valid SQL through the
    // parser is a needless round-trip that has caused real corruption (JSON `$`-keys rewritten to
    // `:param`, date/param literals mangled — see limit-enforcer-json-path tests). Only rewrite the
    // SQL when we must actually add or cap a LIMIT. Most agent queries already include a LIMIT, so
    // this also removes the transform from the common path.
    return originalSql;
  }

  // No LIMIT — add the default (requires regeneration).
  selectNode.limit = { this: { literal: { literal_type: 'number', value: String(defaultLimit) } } };
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
 * Restore `:param` placeholders that polyglot rendered in a dialect-native form
 * (`$param` duckdb, `@param` bigquery, `%(param)s` postgres), applying the
 * substitution ONLY to text outside string/identifier literals. Quoted regions
 * are emitted verbatim so `$`/`@` that are part of string data — e.g. a JSON
 * path key `'$."$current_url"'` or an email `'a@b.com'` — are never mistaken
 * for a placeholder.
 *
 * Quote handling: `'`/`"` are strings, backticks are identifiers; the doubled
 * quote (`''`/`""`) escape is universal. Backslash escapes (`\'`) are only
 * honored for dialects that actually use them (BigQuery/MySQL); treating `\`
 * as an escape under Postgres/DuckDB (which don't, outside E-strings) would
 * mis-track a trailing-backslash literal and swallow the rest of the query.
 */
function restoreParamPlaceholders(sql: string, dialect: string): string {
  const honorBackslash = dialect === 'bigquery' || dialect === 'mysql';
  let out = '';
  let buf = '';
  const flush = () => {
    out += buf
      .replace(/\$(\w+)/g, ':$1')      // $param → :param (duckdb)
      .replace(/@(\w+)/g, ':$1')        // @param → :param (bigquery)
      .replace(/%\((\w+)\)s/g, ':$1');  // %(param)s → :param (postgres)
    buf = '';
  };

  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    // Single/double quotes are string literals; backticks are identifiers.
    // Placeholders never appear inside any of these — copy them through as-is.
    if (c === "'" || c === '"' || c === '`') {
      flush();
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const ch = sql[i];
        if (honorBackslash && ch === '\\' && i + 1 < n) {  // \' / \\ escape
          out += ch + sql[i + 1];
          i += 2;
          continue;
        }
        if (ch === quote) {
          if (sql[i + 1] === quote) {          // doubled-quote escape ('' / "")
            out += ch + sql[i + 1];
            i += 2;
            continue;
          }
          out += ch;
          i++;
          break;                               // closing quote
        }
        out += ch;
        i++;
      }
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return out;
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
      // Fix parameter placeholders — polyglot may transform :param syntax into
      // the dialect's native form. Restore :param, but ONLY outside string
      // literals: a `$`/`@` inside a string literal is data, not a placeholder
      // (e.g. PostHog JSON keys like '$."$current_url"'), and must survive.
      return restoreParamPlaceholders(result.sql[0], dialect);
    }
  } catch {
    // fall through
  }
  return null;
}
