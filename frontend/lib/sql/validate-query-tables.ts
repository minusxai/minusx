/**
 * Server-side SQL table whitelist validator.
 *
 * Uses @polyglot-sql/sdk (WASM) for local SQL parsing — replaces the previous
 * Python backend call. Parse errors are silently allowed — the execution layer
 * surfaces them. CTE names are excluded because they are defined within the
 * query itself.
 */

import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { init, parse, generate, Dialect } from '@polyglot-sql/sdk';

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

export type WhitelistEntry = {
  schema: string;
  tables: Array<{ table: string }>;
};

/**
 * Validate that every table referenced in `sql` is covered by `whitelist`.
 * Pure local implementation using polyglot WASM — no Python backend needed.
 *
 * @returns An error string if any table is blocked, or `null` if the query is allowed.
 */
export async function validateQueryTablesLocal(
  sql: string,
  whitelist: WhitelistEntry[],
): Promise<string | null> {
  if (!whitelist || whitelist.length === 0) return null;
  if (!sql.trim()) return null;

  await ensureInit();

  let ast;
  try {
    const result = parse(sql, 'duckdb' as Dialect);
    if (!result.ast || result.ast.length === 0) return null;
    ast = result.ast[0];
  } catch {
    return null; // unparseable → allow through
  }

  // Collect CTE names — they are virtual tables, not real ones
  const cteNames = new Set<string>();
  collectCteNames(ast, cteNames);

  // Build allowed lookup: table_name (lower) → set of allowed schema names (lower)
  const allowed = new Map<string, Set<string>>();
  for (const entry of whitelist) {
    const schema = (entry.schema ?? '').toLowerCase();
    for (const t of entry.tables ?? []) {
      const tableName = (typeof t === 'string' ? t : t.table ?? '').toLowerCase();
      if (!tableName) continue;
      if (!allowed.has(tableName)) allowed.set(tableName, new Set());
      allowed.get(tableName)!.add(schema);
    }
  }

  // Walk all table references in the AST
  const tables: Array<{ name: string; schema: string | null; sql: string }> = [];
  collectTableRefs(ast, tables);

  const blocked = new Set<string>();
  for (const ref of tables) {
    const name = ref.name.toLowerCase();
    if (!name || cteNames.has(name)) continue;
    if (!allowed.has(name)) {
      blocked.add(ref.sql);
    } else if (ref.schema && !allowed.get(name)!.has(ref.schema.toLowerCase())) {
      blocked.add(ref.sql);
    }
  }

  if (blocked.size > 0) {
    return `Query references tables outside the allowed schema: ${[...blocked].join(', ')}`;
  }
  return null;
}

/**
 * Validate that every table referenced in `sql` is covered by `whitelist`.
 * Delegates to validateQueryTablesLocal (WASM).
 *
 * @returns An error string if any table is blocked, or `null` if the query is allowed.
 */
export async function validateQueryTables(
  sql: string,
  whitelist: WhitelistEntry[],
  _user: EffectiveUser
): Promise<string | null> {
  return validateQueryTablesLocal(sql, whitelist);
}

/** Recursively collect CTE alias names from the AST */
function collectCteNames(node: any, names: Set<string>): void {
  if (!node || typeof node !== 'object') return;

  // Check for 'with' block containing ctes
  if (node.with?.ctes) {
    for (const cte of node.with.ctes) {
      if (cte.alias?.name) {
        names.add(cte.alias.name.toLowerCase());
      }
    }
  }
  // Also check inside select.with
  if (node.select?.with?.ctes) {
    for (const cte of node.select.with.ctes) {
      if (cte.alias?.name) {
        names.add(cte.alias.name.toLowerCase());
      }
    }
  }
}

/** Recursively collect all table references from the AST */
function collectTableRefs(
  node: any,
  tables: Array<{ name: string; schema: string | null; sql: string }>,
): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectTableRefs(item, tables);
    }
    return;
  }

  // Found a table node
  if ('table' in node && node.table?.name?.name) {
    const t = node.table;
    const name = t.name.name;
    const schema = t.schema?.name ?? null;
    const sqlStr = schema ? `${schema}.${name}` : name;
    tables.push({ name, schema, sql: sqlStr });
  }

  // Recurse into all values
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (val && typeof val === 'object') {
      collectTableRefs(val, tables);
    }
  }
}
