/**
 * SQL Schema Completions
 *
 * Provides autocomplete suggestions for table names, column names, and schema names
 * based on available database schema using node-sql-parser for SQL parsing.
 */

import { Parser } from 'node-sql-parser';
import { DatabaseWithSchema } from '@/lib/types';

// Use PostgreSQL parser as default (most compatible with DuckDB syntax)
const parser = new Parser();
const PARSER_OPTIONS = { database: 'PostgreSQL' };

/**
 * Table information for autocomplete
 */
export interface TableInfo {
  name: string;
  schema: string;
  database: string;
  columns: ColumnInfo[];
}

/**
 * Column information for autocomplete
 */
export interface ColumnInfo {
  name: string;
  type: string;
  table: string;
  schema: string;
  database: string;
}

/**
 * Extract table aliases from SQL using AST
 * Returns: { alias: tableName } mapping
 *
 * Handles aliases like:
 * - FROM users u -> { u: 'users' }
 * - FROM users AS u -> { u: 'users' }
 * - JOIN orders o ON ... -> { o: 'orders' }
 */
export function extractTableAliases(sql: string): Record<string, string> {
  try {
    const ast = parser.astify(sql, PARSER_OPTIONS);
    const aliases: Record<string, string> = {};

    // Handle single statement or array
    const statements = Array.isArray(ast) ? ast : [ast];

    for (const stmt of statements) {
      extractAliasesFromNode(stmt, aliases);
    }

    return aliases;
  } catch {
    // Ignore parse errors (incomplete SQL is common during typing)
    return {};
  }
}

/**
 * Recursively extract aliases from AST node
 */
function extractAliasesFromNode(node: any, aliases: Record<string, string>): void {
  if (!node || typeof node !== 'object') return;

  // Handle FROM clause
  if (node.from && Array.isArray(node.from)) {
    for (const table of node.from) {
      if (table.as && table.table) {
        aliases[table.as] = table.table;
      }
    }
  }

  // Handle WITH clause (CTEs)
  if (node.with && Array.isArray(node.with)) {
    for (const cte of node.with) {
      if (cte.name && cte.name.value) {
        // CTEs are treated as table names (no alias mapping needed)
      }
    }
  }

  // Recurse into subqueries
  if (node.ast) {
    extractAliasesFromNode(node.ast, aliases);
  }

  // Handle UNION and other set operations
  if (node._next) {
    extractAliasesFromNode(node._next, aliases);
  }
}

/**
 * Get all tables from schema data
 */
export function getAllTables(schemas: DatabaseWithSchema[]): TableInfo[] {
  const tables: TableInfo[] = [];

  for (const db of schemas) {
    for (const schema of db.schemas) {
      for (const table of schema.tables) {
        tables.push({
          name: table.table,
          schema: schema.schema,
          database: db.databaseName,
          columns: table.columns.map(col => ({
            name: col.name,
            type: col.type,
            table: table.table,
            schema: schema.schema,
            database: db.databaseName
          }))
        });
      }
    }
  }

  return tables;
}

/**
 * Get all columns from all tables in schema data
 */
export function getAllColumns(schemas: DatabaseWithSchema[]): ColumnInfo[] {
  const columns: ColumnInfo[] = [];

  for (const db of schemas) {
    for (const schema of db.schemas) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          columns.push({
            name: col.name,
            type: col.type,
            table: table.table,
            schema: schema.schema,
            database: db.databaseName
          });
        }
      }
    }
  }

  return columns;
}

/**
 * Get columns for a specific table (by name or alias)
 */
export function getColumnsForTable(
  tableOrAlias: string,
  aliases: Record<string, string>,
  schemas: DatabaseWithSchema[]
): ColumnInfo[] {
  // Resolve alias to actual table name
  const tableName = aliases[tableOrAlias] || tableOrAlias;

  // Search case-insensitively
  const lowerTableName = tableName.toLowerCase();

  for (const db of schemas) {
    for (const schema of db.schemas) {
      for (const table of schema.tables) {
        if (table.table.toLowerCase() === lowerTableName) {
          return table.columns.map(col => ({
            name: col.name,
            type: col.type,
            table: table.table,
            schema: schema.schema,
            database: db.databaseName
          }));
        }
      }
    }
  }

  return [];
}

/**
 * Get columns for a schema.table reference (e.g., "public.users")
 */
export function getColumnsForQualifiedTable(
  schemaName: string,
  tableName: string,
  schemas: DatabaseWithSchema[]
): ColumnInfo[] {
  const lowerSchemaName = schemaName.toLowerCase();
  const lowerTableName = tableName.toLowerCase();

  for (const db of schemas) {
    for (const schema of db.schemas) {
      if (schema.schema.toLowerCase() === lowerSchemaName) {
        for (const table of schema.tables) {
          if (table.table.toLowerCase() === lowerTableName) {
            return table.columns.map(col => ({
              name: col.name,
              type: col.type,
              table: table.table,
              schema: schema.schema,
              database: db.databaseName
            }));
          }
        }
      }
    }
  }

  return [];
}

/**
 * Get tables within a specific schema
 */
export function getTablesInSchema(
  schemaName: string,
  schemas: DatabaseWithSchema[]
): TableInfo[] {
  const lowerSchemaName = schemaName.toLowerCase();
  const tables: TableInfo[] = [];

  for (const db of schemas) {
    for (const schema of db.schemas) {
      if (schema.schema.toLowerCase() === lowerSchemaName) {
        for (const table of schema.tables) {
          tables.push({
            name: table.table,
            schema: schema.schema,
            database: db.databaseName,
            columns: table.columns.map(col => ({
              name: col.name,
              type: col.type,
              table: table.table,
              schema: schema.schema,
              database: db.databaseName
            }))
          });
        }
      }
    }
  }

  return tables;
}

/**
 * Get all schema names from schema data
 */
export function getAllSchemas(schemas: DatabaseWithSchema[]): string[] {
  const schemaNames = new Set<string>();

  for (const db of schemas) {
    for (const schema of db.schemas) {
      schemaNames.add(schema.schema);
    }
  }

  return Array.from(schemaNames);
}

/**
 * Determine if the cursor position needs column completion
 * Based on SQL context keywords
 */
export function needsColumnCompletion(textBeforeCursor: string): boolean {
  // Match patterns where column completion makes sense
  const patterns = [
    /\bSELECT\s+$/i,                    // SELECT
    /\bSELECT\s+.*,\s*$/i,              // SELECT col1,
    /\bSELECT\s+\w*$/i,                 // SELECT col (partial typing)
    /\bWHERE\s+$/i,                      // WHERE
    /\bWHERE\s+\w*$/i,                  // WHERE col (partial typing)
    /\bWHERE\s+.*\bAND\s+$/i,           // WHERE x AND
    /\bWHERE\s+.*\bAND\s+\w*$/i,        // WHERE x AND col (partial)
    /\bWHERE\s+.*\bOR\s+$/i,            // WHERE x OR
    /\bWHERE\s+.*\bOR\s+\w*$/i,         // WHERE x OR col (partial)
    /\bHAVING\s+$/i,                     // HAVING
    /\bHAVING\s+\w*$/i,                 // HAVING col (partial)
    /\bORDER\s+BY\s+$/i,                 // ORDER BY
    /\bORDER\s+BY\s+\w*$/i,             // ORDER BY col (partial)
    /\bORDER\s+BY\s+.*,\s*$/i,          // ORDER BY col1,
    /\bORDER\s+BY\s+.*,\s*\w*$/i,       // ORDER BY col1, col (partial)
    /\bGROUP\s+BY\s+$/i,                 // GROUP BY
    /\bGROUP\s+BY\s+\w*$/i,             // GROUP BY col (partial)
    /\bGROUP\s+BY\s+.*,\s*$/i,          // GROUP BY col1,
    /\bGROUP\s+BY\s+.*,\s*\w*$/i,       // GROUP BY col1, col (partial)
    /\bON\s+$/i,                         // ON (for JOIN conditions)
    /\bON\s+\w*$/i,                     // ON col (partial)
    /\bSET\s+$/i,                        // SET (for UPDATE)
    /\bVALUES\s*\(\s*$/i,               // VALUES (
    /\(\s*$/,                            // After open paren (function args, subquery)
    /\(\s*\w*$/,                         // Inside function: count(col or count(
    /,\s*\w*$/,                          // After comma with partial: func(a, b
    /=\s*$/,                             // After equals
    /=\s*\w*$/,                          // After equals with partial
    /[<>]\s*$/,                          // After comparison operators
    /[<>]\s*\w*$/,                       // After comparison with partial
    /!=\s*$/,                            // After not equals
    /!=\s*\w*$/,                         // After not equals with partial
    /\bIN\s*\(\s*$/i,                   // IN (
    /\bIN\s*\(\s*\w*$/i,                // IN (col (partial)
    /\bBETWEEN\s+$/i,                   // BETWEEN
    /\bBETWEEN\s+\w*$/i,                // BETWEEN col (partial)
    /\bCASE\s+$/i,                       // CASE
    /\bWHEN\s+$/i,                       // WHEN
    /\bWHEN\s+\w*$/i,                   // WHEN col (partial)
    /\bTHEN\s+$/i,                       // THEN
    /\bELSE\s+$/i,                       // ELSE
  ];

  return patterns.some(pattern => pattern.test(textBeforeCursor));
}

/**
 * Determine if the cursor position needs table completion
 */
export function needsTableCompletion(textBeforeCursor: string): boolean {
  const patterns = [
    /\bFROM\s+$/i,                       // FROM
    /\bFROM\s+\w+$/i,                    // FROM tab (partial)
    /\bJOIN\s+$/i,                       // JOIN
    /\bJOIN\s+\w+$/i,                    // JOIN tab (partial)
    /\bINNER\s+JOIN\s+$/i,              // INNER JOIN
    /\bINNER\s+JOIN\s+\w+$/i,           // INNER JOIN tab (partial)
    /\bLEFT\s+JOIN\s+$/i,               // LEFT JOIN
    /\bLEFT\s+JOIN\s+\w+$/i,            // LEFT JOIN tab (partial)
    /\bRIGHT\s+JOIN\s+$/i,              // RIGHT JOIN
    /\bRIGHT\s+JOIN\s+\w+$/i,           // RIGHT JOIN tab (partial)
    /\bOUTER\s+JOIN\s+$/i,              // OUTER JOIN
    /\bOUTER\s+JOIN\s+\w+$/i,           // OUTER JOIN tab (partial)
    /\bCROSS\s+JOIN\s+$/i,              // CROSS JOIN
    /\bCROSS\s+JOIN\s+\w+$/i,           // CROSS JOIN tab (partial)
    /\bINTO\s+$/i,                       // INTO
    /\bINTO\s+\w+$/i,                   // INTO tab (partial)
    /\bUPDATE\s+$/i,                     // UPDATE
    /\bUPDATE\s+\w+$/i,                 // UPDATE tab (partial)
    // Comma in FROM clause (only if FROM is present and no SELECT/WHERE after)
    /\bFROM\s+[\w.]+\s*,\s*$/i,         // FROM table,
    /\bFROM\s+[\w.]+\s*,\s*\w*$/i,      // FROM table, tab (partial)
  ];

  return patterns.some(pattern => pattern.test(textBeforeCursor));
}

/**
 * Check if we're in a context where we might need schema completion
 * (after a schema name followed by a dot)
 */
export function extractDotContext(textBeforeCursor: string): { prefix: string; partial: string } | null {
  // Match: word followed by dot, optionally followed by partial word
  // e.g., "SELECT u." -> { prefix: 'u', partial: '' }
  // e.g., "SELECT users.na" -> { prefix: 'users', partial: 'na' }
  const match = textBeforeCursor.match(/(\w+)\.(\w*)$/);
  if (match) {
    return {
      prefix: match[1],
      partial: match[2]
    };
  }
  return null;
}
