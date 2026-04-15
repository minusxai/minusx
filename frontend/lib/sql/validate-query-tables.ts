/**
 * Client-side SQL table whitelist validator.
 *
 * Uses node-sql-parser to extract table references from a SQL query and
 * check them against a whitelist.  Mirrors the Python SQLGlot validator in
 * backend/sql_utils/table_validator.py so both LLM and GUI execution paths
 * enforce the same rules.
 *
 * Parse errors are silently allowed — the execution layer surfaces them.
 * CTE names are excluded because they are defined within the query itself.
 */

import { Parser } from 'node-sql-parser';

const PARSER_OPTIONS = { database: 'PostgreSQL' };

export type WhitelistEntry = {
  schema: string;
  tables: Array<{ table: string }>;
};

/**
 * Validate that every table referenced in `sql` is covered by `whitelist`.
 *
 * @returns An error string if any table is blocked, or `null` if the query is allowed.
 */
export function validateQueryTables(sql: string, whitelist: WhitelistEntry[]): string | null {
  if (!whitelist || whitelist.length === 0) return null;

  const parser = new Parser();
  let tableList: string[];
  let cteNames: Set<string>;

  try {
    tableList = parser.tableList(sql, PARSER_OPTIONS);

    // Extract CTE aliases so we don't flag them as missing from the whitelist
    const ast = parser.astify(sql, PARSER_OPTIONS);
    cteNames = new Set<string>();
    const asts = Array.isArray(ast) ? ast : [ast];
    for (const a of asts) {
      const withClauses = (a as any).with;
      if (Array.isArray(withClauses)) {
        for (const cte of withClauses) {
          const name = cte?.name?.value ?? cte?.name;
          if (typeof name === 'string') cteNames.add(name.toLowerCase());
        }
      }
    }
  } catch {
    // Unparseable SQL — allow through; execution layer will surface the error
    return null;
  }

  // Build allowed map: tableName → set of allowed schema names ('' = any schema)
  const allowed = new Map<string, Set<string>>();
  for (const entry of whitelist) {
    const schema = (entry.schema || '').toLowerCase();
    for (const t of entry.tables) {
      const tableName = t.table.toLowerCase();
      if (!allowed.has(tableName)) allowed.set(tableName, new Set());
      allowed.get(tableName)!.add(schema);
    }
  }

  // tableList entries look like: "select::schemaOrNull::tableName"
  const blocked: string[] = [];
  for (const entry of tableList) {
    const parts = entry.split('::');
    if (parts.length < 3) continue;
    const schemaRaw = parts[1];
    const tableName = parts[2]?.toLowerCase();
    if (!tableName) continue;

    // Skip CTE-defined names
    if (cteNames.has(tableName)) continue;

    const schemaName = (!schemaRaw || schemaRaw === 'null') ? '' : schemaRaw.toLowerCase();

    if (!allowed.has(tableName)) {
      blocked.push(schemaName ? `${schemaName}.${tableName}` : tableName);
    } else if (schemaName) {
      const allowedSchemas = allowed.get(tableName)!;
      // OK if schema matches OR if the table was whitelisted without a schema qualifier
      if (!allowedSchemas.has(schemaName) && !allowedSchemas.has('')) {
        blocked.push(`${schemaName}.${tableName}`);
      }
    }
  }

  if (blocked.length > 0) {
    const unique = [...new Set(blocked)];
    return `Query references tables outside the allowed schema: ${unique.join(', ')}`;
  }
  return null;
}
