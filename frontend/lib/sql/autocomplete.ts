/**
 * SQL Autocomplete Engine using @polyglot-sql/sdk (WASM).
 * Ported from backend/sql_utils/autocomplete.py.
 */
import { init, parse, Dialect } from '@polyglot-sql/sdk';
import type { DatabaseWithSchema } from '@/lib/types';

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

export interface CompletionItem {
  label: string;
  kind: string; // "column" | "table" | "schema" | "alias" | "cte" | "keyword"
  detail?: string;
  documentation?: string;
  insert_text: string;
  sort_text?: string;
}

interface SchemaTable {
  table: string;
  columns: Array<{ name: string; type: string }>;
}

interface SchemaObj {
  schema: string;
  tables: SchemaTable[];
}

// ---------------------------------------------------------------------------
// Context detection (regex-based, runs before parsing)
// ---------------------------------------------------------------------------

function needsColumnCompletion(text: string): boolean {
  const patterns = [
    /\bSELECT(\s+\w*)?$/i,
    /\bWHERE(\s+\w+)*(\s+\w*)?$/i,
    /\bGROUP\s+BY(\s+\w+)*(\s+\w*)?$/i,
    /\bORDER\s+BY(\s+\w+)*(\s+\w*)?$/i,
    /\bHAVING(\s+\w*)?$/i,
    /\bON(\s+\w*)?$/i,
    /\bLIKE\s+\w*$/i,
    /\bNOT\s+LIKE\s+\w*$/i,
    /\bOR\s+\w*$/i,
    /\bAND\s+\w*$/i,
    /,\s*\w*\s*$/,
  ];
  return patterns.some(p => p.test(text));
}

function needsCommaPrefix(text: string): boolean {
  const matches = [...text.matchAll(/\b(SELECT|GROUP\s+BY|ORDER\s+BY)\b/gi)];
  if (matches.length === 0) return false;
  const lastMatch = matches[matches.length - 1];
  const clauseTail = text.slice(lastMatch.index! + lastMatch[0].length);
  if (/\b(FROM|WHERE|HAVING|JOIN)\b/i.test(clauseTail)) return false;
  return /\w\s+$/.test(clauseTail) && !/,\s*$/.test(clauseTail);
}

function needsTableCompletion(text: string): boolean {
  const patterns = [
    /\bFROM\s+\w*$/i,
    /\bJOIN\s+\w*$/i,
    /\bINTO\s+\w*$/i,
    /\bUPDATE\s+\w*$/i,
  ];
  return patterns.some(p => p.test(text));
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/** Recursively find all table references in an AST node */
function findAllTables(node: any): Array<{ name: string; schema: string | null; alias: string | null }> {
  const tables: Array<{ name: string; schema: string | null; alias: string | null }> = [];
  walkAst(node, (key, value) => {
    if (key === 'table' && value?.name?.name) {
      tables.push({
        name: value.name.name,
        schema: value.schema?.name ?? null,
        alias: value.alias?.name ?? null,
      });
    }
  });
  return tables;
}

/** Extract tables from only FROM and JOIN clauses of the main SELECT (not subqueries/CTEs) */
function extractTablesInScope(selectNode: any): string[] {
  const tables: string[] = [];
  if (!selectNode) return tables;

  // FROM clause
  if (selectNode.from?.expressions) {
    for (const expr of selectNode.from.expressions) {
      if (expr.table?.name?.name) {
        tables.push(expr.table.name.name);
      }
    }
  }

  // JOIN clauses
  if (selectNode.joins) {
    for (const join of selectNode.joins) {
      if (join.this?.table?.name?.name) {
        tables.push(join.this.table.name.name);
      }
    }
  }

  return tables;
}

/** Extract table alias → table name mappings */
function extractTableAliases(selectNode: any): Map<string, string> {
  const aliases = new Map<string, string>();
  if (!selectNode) return aliases;

  const processTable = (tableNode: any) => {
    if (tableNode?.table?.name?.name && tableNode?.table?.alias?.name) {
      aliases.set(tableNode.table.alias.name, tableNode.table.name.name);
    }
  };

  // FROM clause
  if (selectNode.from?.expressions) {
    for (const expr of selectNode.from.expressions) {
      processTable(expr);
    }
  }

  // JOINs
  if (selectNode.joins) {
    for (const join of selectNode.joins) {
      processTable(join.this);
    }
  }

  return aliases;
}

/** Extract SELECT aliases (e.g. COUNT(*) AS total_orders → "total_orders") */
function extractSelectAliases(selectNode: any): string[] {
  const aliases: string[] = [];
  if (!selectNode?.expressions) return aliases;

  for (const expr of selectNode.expressions) {
    if (expr.alias?.alias?.name) {
      aliases.push(expr.alias.alias.name);
    }
  }
  return aliases;
}

/** Extract CTE names and their column lists */
function extractCteInfo(ast: any): Map<string, string[]> {
  const ctes = new Map<string, string[]>();
  const withNode = ast?.select?.with ?? ast?.with;
  if (!withNode?.ctes) return ctes;

  for (const cte of withNode.ctes) {
    const cteName = cte.alias?.name;
    if (!cteName) continue;

    const columns: string[] = [];
    const cteSelect = cte.this?.select;
    if (cteSelect?.expressions) {
      for (const expr of cteSelect.expressions) {
        if (expr.alias?.alias?.name) {
          columns.push(expr.alias.alias.name);
        } else if (expr.column?.name?.name) {
          columns.push(expr.column.name.name);
        } else if ('star' in expr) {
          columns.push('*');
        }
      }
    }
    ctes.set(cteName, columns);
  }
  return ctes;
}

/** Walk AST recursively, calling fn for each key-value pair */
function walkAst(node: any, fn: (key: string, value: any) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, fn);
    return;
  }
  for (const key of Object.keys(node)) {
    fn(key, node[key]);
    if (node[key] && typeof node[key] === 'object') {
      walkAst(node[key], fn);
    }
  }
}

/** Get the main select node from the AST */
function getSelectNode(ast: any): any {
  if (!ast) return null;
  if (ast.select) return ast.select;
  return null;
}

// ---------------------------------------------------------------------------
// Completion generators
// ---------------------------------------------------------------------------

function getColumnCompletions(
  selectNode: any,
  schemaData: DatabaseWithSchema[],
  textBeforeCursor: string,
): CompletionItem[] {
  const tablesInScope = extractTablesInScope(selectNode);
  const suggestions: CompletionItem[] = [];
  let idx = 0;

  // SELECT aliases come first
  const aliasLabels = new Set<string>();
  for (const alias of extractSelectAliases(selectNode)) {
    if (!aliasLabels.has(alias.toLowerCase())) {
      suggestions.push({
        label: alias,
        kind: 'alias',
        detail: '  (SELECT alias)',
        insert_text: alias,
        sort_text: String(idx).padStart(5, '0'),
      });
      idx++;
      aliasLabels.add(alias.toLowerCase());
    }
  }

  // CTE info
  const cteColumns = extractCteInfo({ select: selectNode });
  // Also check parent-level with block (CTE defined at top level)
  const cteNamesLower = new Set([...cteColumns.keys()].map(n => n.toLowerCase()));

  // Schema table columns
  for (const db of schemaData) {
    for (const schema of (db.schemas ?? []) as SchemaObj[]) {
      for (const table of schema.tables ?? []) {
        // Filter by tables in scope
        if (tablesInScope.length > 0 && !tablesInScope.some(t => t.toLowerCase() === table.table.toLowerCase())) {
          continue;
        }
        // Skip if shadowed by CTE
        if (cteNamesLower.has(table.table.toLowerCase())) continue;

        for (const col of table.columns ?? []) {
          if (!aliasLabels.has(col.name.toLowerCase())) {
            suggestions.push({
              label: col.name,
              kind: 'column',
              detail: `  ${table.table}`,
              documentation: `Column from ${schema.schema}.${table.table}`,
              insert_text: col.name,
              sort_text: String(idx).padStart(5, '0'),
            });
          }
          idx++;
        }
      }
    }
  }

  // CTE columns
  for (const [cteName, columns] of cteColumns) {
    if (tablesInScope.length > 0 && !tablesInScope.some(t => t.toLowerCase() === cteName.toLowerCase())) {
      continue;
    }
    for (const colName of columns) {
      if (!aliasLabels.has(colName.toLowerCase())) {
        suggestions.push({
          label: colName,
          kind: 'cte',
          detail: `  ${cteName} (CTE)`,
          documentation: `Column from CTE ${cteName}`,
          insert_text: colName,
          sort_text: String(idx).padStart(5, '0'),
        });
      }
      idx++;
    }
  }

  return suggestions;
}

function getTableCompletions(
  ast: any,
  schemaData: DatabaseWithSchema[],
): CompletionItem[] {
  const suggestions: CompletionItem[] = [];
  let idx = 0;
  const seenSchemas = new Set<string>();

  for (const db of schemaData) {
    for (const schema of (db.schemas ?? []) as SchemaObj[]) {
      const schemaName = schema.schema;

      if (!seenSchemas.has(schemaName)) {
        suggestions.push({
          label: schemaName,
          kind: 'schema',
          detail: '  (schema)',
          insert_text: schemaName,
          sort_text: String(idx).padStart(5, '0'),
        });
        idx++;
        seenSchemas.add(schemaName);
      }

      for (const table of schema.tables ?? []) {
        suggestions.push({
          label: table.table,
          kind: 'table',
          detail: `  ${schemaName}`,
          insert_text: table.table,
          sort_text: String(idx).padStart(5, '0'),
        });
        idx++;

        const qualifiedName = `${schemaName}.${table.table}`;
        suggestions.push({
          label: qualifiedName,
          kind: 'table',
          detail: '  (qualified)',
          insert_text: qualifiedName,
          sort_text: String(idx).padStart(5, '0'),
        });
        idx++;
      }
    }
  }

  // CTEs
  const cteColumns = extractCteInfo(ast);
  for (const cteName of cteColumns.keys()) {
    suggestions.push({
      label: cteName,
      kind: 'cte',
      detail: '  (CTE)',
      insert_text: cteName,
      sort_text: String(idx).padStart(5, '0'),
    });
    idx++;
  }

  return suggestions;
}

function getDotCompletions(
  selectNode: any,
  ast: any,
  schemaData: DatabaseWithSchema[],
  textBeforeCursor: string,
): CompletionItem[] {
  const searchText = textBeforeCursor.slice(-200);
  const match = searchText.match(/(\w+)\.\w*$/);
  if (!match) return [];

  const prefix = match[1];
  const suggestions: CompletionItem[] = [];
  let idx = 0;

  // Check if prefix is a schema name
  for (const db of schemaData) {
    for (const schema of (db.schemas ?? []) as SchemaObj[]) {
      if (schema.schema.toLowerCase() === prefix.toLowerCase()) {
        for (const table of schema.tables ?? []) {
          suggestions.push({
            label: table.table,
            kind: 'table',
            detail: `  ${schema.schema}`,
            documentation: `Table in ${schema.schema} schema`,
            insert_text: table.table,
            sort_text: String(idx).padStart(5, '0'),
          });
          idx++;
        }
        return suggestions;
      }
    }
  }

  // Not a schema — check table.column or alias.column
  const aliasMap = extractTableAliases(selectNode);
  const actualTable = aliasMap.get(prefix) ?? prefix;

  for (const db of schemaData) {
    for (const schema of (db.schemas ?? []) as SchemaObj[]) {
      for (const table of schema.tables ?? []) {
        if (table.table.toLowerCase() === actualTable.toLowerCase()) {
          for (const col of table.columns ?? []) {
            suggestions.push({
              label: col.name,
              kind: 'column',
              detail: `  ${table.table}`,
              documentation: col.type,
              insert_text: col.name,
              sort_text: String(idx).padStart(5, '0'),
            });
            idx++;
          }
          return suggestions;
        }
      }
    }
  }

  // Check CTEs
  const cteColumns = extractCteInfo(ast);
  if (cteColumns.has(prefix)) {
    for (const colName of cteColumns.get(prefix)!) {
      suggestions.push({
        label: colName,
        kind: 'cte',
        detail: `  ${prefix} (CTE)`,
        insert_text: colName,
        sort_text: String(idx).padStart(5, '0'),
      });
      idx++;
    }
  }

  return suggestions;
}

function getSchemaDotCompletionsFallback(
  schemaData: DatabaseWithSchema[],
  textBeforeCursor: string,
): CompletionItem[] {
  const searchText = textBeforeCursor.slice(-200);
  const match = searchText.match(/(\w+)\.\w*$/);
  if (!match) return [];

  const prefix = match[1];
  const suggestions: CompletionItem[] = [];
  let idx = 0;

  // Check schema name
  for (const db of schemaData) {
    for (const schema of (db.schemas ?? []) as SchemaObj[]) {
      if (schema.schema.toLowerCase() === prefix.toLowerCase()) {
        for (const table of schema.tables ?? []) {
          suggestions.push({
            label: table.table,
            kind: 'table',
            detail: `  ${schema.schema}`,
            documentation: `Table in ${schema.schema} schema`,
            insert_text: table.table,
            sort_text: String(idx).padStart(5, '0'),
          });
          idx++;
        }
        return suggestions;
      }
    }
  }

  // Check table name
  for (const db of schemaData) {
    for (const schema of (db.schemas ?? []) as SchemaObj[]) {
      for (const table of schema.tables ?? []) {
        if (table.table.toLowerCase() === prefix.toLowerCase()) {
          for (const col of table.columns ?? []) {
            suggestions.push({
              label: col.name,
              kind: 'column',
              detail: `  ${table.table}`,
              documentation: col.type ?? '',
              insert_text: col.name,
              sort_text: String(idx).padStart(5, '0'),
            });
            idx++;
          }
          return suggestions;
        }
      }
    }
  }

  return [];
}

function getAllColumnsUnfiltered(schemaData: DatabaseWithSchema[]): CompletionItem[] {
  const suggestions: CompletionItem[] = [];
  let idx = 0;
  for (const db of schemaData) {
    for (const schema of (db.schemas ?? []) as SchemaObj[]) {
      for (const table of schema.tables ?? []) {
        for (const col of table.columns ?? []) {
          suggestions.push({
            label: col.name,
            kind: 'column',
            detail: `  ${table.table}`,
            documentation: `Column from ${schema.schema}.${table.table}`,
            insert_text: col.name,
            sort_text: String(idx).padStart(5, '0'),
          });
          idx++;
        }
      }
    }
  }
  return suggestions;
}

function getAllTablesUnfiltered(schemaData: DatabaseWithSchema[]): CompletionItem[] {
  const suggestions: CompletionItem[] = [];
  let idx = 0;
  const seenSchemas = new Set<string>();

  for (const db of schemaData) {
    for (const schema of (db.schemas ?? []) as SchemaObj[]) {
      const schemaName = schema.schema;
      if (!seenSchemas.has(schemaName)) {
        suggestions.push({
          label: schemaName,
          kind: 'schema',
          detail: '  (schema)',
          insert_text: schemaName,
          sort_text: String(idx).padStart(5, '0'),
        });
        idx++;
        seenSchemas.add(schemaName);
      }
      for (const table of schema.tables ?? []) {
        suggestions.push({
          label: table.table,
          kind: 'table',
          detail: `  ${schemaName}`,
          insert_text: table.table,
          sort_text: String(idx).padStart(5, '0'),
        });
        idx++;
      }
    }
  }
  return suggestions;
}

// ---------------------------------------------------------------------------
// Parse helper
// ---------------------------------------------------------------------------

function tryParse(sql: string, dialect: Dialect): any {
  try {
    const result = parse(sql, dialect);
    if (result.ast && result.ast.length > 0) return result.ast[0];
  } catch {
    // parse failed
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getCompletionsLocal(
  query: string,
  cursorOffset: number,
  schemaData: DatabaseWithSchema[],
  connectionType?: string,
): Promise<CompletionItem[]> {
  const textBeforeCursor = query.slice(0, cursorOffset);

  // Fast path: @reference completion (frontend handles these)
  if (textBeforeCursor.trimEnd().endsWith('@')) return [];

  // Context detection BEFORE parsing
  const isColumnContext = needsColumnCompletion(textBeforeCursor);
  const isTableContext = needsTableCompletion(textBeforeCursor);
  const words = textBeforeCursor.split(/\s+/).filter(Boolean);
  const isDotContext = words.length > 0 && words[words.length - 1].includes('.');

  await ensureInit();

  const dialect = (connectionType ?? 'duckdb') as Dialect;

  // Error-tolerant parse — polyglot returns null AST for incomplete SQL,
  // so we try progressively stripped versions of the query.
  let ast: any = null;
  let selectNode: any = null;

  ast = tryParse(query, dialect);

  if (!ast) {
    // Strip incomplete trailing clause from end of query and retry.
    // Use progressively aggressive stripping to handle CTE queries
    // where a naive global regex would strip FROM inside the CTE.
    const stripPatterns = [
      // Strip just the trailing partial token/keyword
      /\b(WHERE|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|ON|AND|OR|LIKE|NOT\s+LIKE|FROM|JOIN|INTO|UPDATE)\s*\w*\s*$/i,
      // Strip trailing comma + partial
      /,\s*\w*\s*$/,
    ];
    for (const pattern of stripPatterns) {
      if (ast) break;
      const stripped = query.replace(pattern, '').trim();
      if (stripped && stripped !== query.trim()) {
        ast = tryParse(stripped, dialect);
      }
    }
  }

  if (!ast && isDotContext) {
    // For dot notation, try removing the "prefix." to make it parseable
    const dotFixed = query.replace(/(\w+)\.\s*$/, '').trim();
    if (dotFixed && dotFixed !== query.trim()) {
      ast = tryParse(dotFixed, dialect);
    }
    // Also try replacing broken SELECT with dummy + FROM clause
    if (!ast) {
      const fromIdx = query.search(/\bFROM\b/i);
      if (fromIdx > 0) {
        ast = tryParse('SELECT 1 ' + query.slice(fromIdx), dialect);
      }
    }
  }

  if (ast) {
    selectNode = getSelectNode(ast);
  }

  if (!ast) {
    // Fallback: no parseable SQL at all
    if (isDotContext && schemaData.length > 0) {
      return getSchemaDotCompletionsFallback(schemaData, textBeforeCursor);
    } else if (isColumnContext && schemaData.length > 0) {
      return getAllColumnsUnfiltered(schemaData);
    } else if (isTableContext && schemaData.length > 0) {
      return getAllTablesUnfiltered(schemaData);
    }
    return [];
  }

  // Determine completion context
  if (isDotContext) {
    return getDotCompletions(selectNode, ast, schemaData, textBeforeCursor);
  } else if (isColumnContext) {
    const suggestions = getColumnCompletions(selectNode, schemaData, textBeforeCursor);
    if (needsCommaPrefix(textBeforeCursor)) {
      for (const s of suggestions) {
        s.insert_text = ', ' + s.insert_text;
      }
    }
    return suggestions;
  } else if (isTableContext) {
    return getTableCompletions(ast, schemaData);
  }

  return [];
}
