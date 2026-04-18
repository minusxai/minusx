/**
 * Infer output column names and types from a SQL query using @polyglot-sql/sdk (WASM).
 * Replaces the Python sqlglot-based column_inferrer for the /api/infer-columns route.
 */
import { init, parse, generate, Dialect } from '@polyglot-sql/sdk';

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

export interface InferredColumn {
  name: string;
  type: string;
}

export interface InferColumnsResult {
  columns: InferredColumn[];
  error?: string;
}

interface SchemaColumn {
  name: string;
  type: string;
}

interface SchemaTable {
  table: string;
  columns: SchemaColumn[];
}

interface SchemaObj {
  schema: string;
  tables: SchemaTable[];
}

interface SchemaEntry {
  databaseName: string;
  schemas: SchemaObj[];
}

/**
 * Infer output column names and types from a SQL query.
 * Does not execute the query — uses static analysis only.
 */
export async function inferColumnsLocal(
  query: string,
  schemaData: SchemaEntry[],
  dialect: string,
): Promise<InferColumnsResult> {
  const stripped = query.trim();
  if (!stripped) {
    return { columns: [] };
  }

  await ensureInit();

  let ast;
  try {
    const result = parse(stripped, dialect as Dialect);
    if (!result.ast || result.ast.length === 0) {
      return { columns: [], error: 'Could not parse SQL' };
    }
    ast = result.ast;
  } catch (e: any) {
    return { columns: [], error: e.message ?? String(e) };
  }

  // Find the outermost SELECT statement
  const selectStmt = findSelect(ast[0]);
  if (!selectStmt) {
    return { columns: [], error: 'Could not find SELECT statement' };
  }

  const expressions = selectStmt.expressions;
  if (!expressions || !Array.isArray(expressions)) {
    return { columns: [] };
  }

  const columns: InferredColumn[] = [];
  for (const expr of expressions) {
    const key = getExprType(expr);

    if (key === 'star') {
      expandStar(schemaData, columns);
      continue;
    }

    if (key === 'alias') {
      const alias = expr.alias;
      const colName = alias.alias?.name ?? generateSql(expr, dialect);
      const inner = alias.this;
      columns.push({ name: colName, type: inferType(inner, schemaData, dialect) });
    } else if (key === 'column') {
      const colName = expr.column.name?.name ?? 'unknown';
      columns.push({ name: colName, type: inferType(expr, schemaData, dialect) });
    } else {
      // Fallback: use generate to get expression SQL as name
      const colName = generateSql(expr, dialect);
      columns.push({ name: colName, type: inferType(expr, schemaData, dialect) });
    }
  }

  return { columns };
}

/** Get the top-level expression type key (e.g. 'alias', 'column', 'star', 'count') */
function getExprType(expr: any): string {
  return Object.keys(expr)[0];
}

/** Get the inner value of an expression node */
function getExprValue(expr: any): any {
  const key = getExprType(expr);
  return expr[key];
}

/** Find the SELECT node in an AST node (handles CTEs, subqueries, etc.) */
function findSelect(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if ('select' in node) return node.select;
  // Walk into common wrapper structures
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (child && typeof child === 'object' && 'select' in child) {
      return child.select;
    }
  }
  return null;
}

/** Expand SELECT * using schema data, or add a wildcard placeholder */
function expandStar(schemaData: SchemaEntry[], columns: InferredColumn[]): void {
  if (schemaData.length > 0) {
    for (const entry of schemaData) {
      for (const schemaObj of entry.schemas ?? []) {
        for (const table of schemaObj.tables ?? []) {
          for (const col of table.columns ?? []) {
            columns.push({ name: col.name ?? '?', type: col.type ?? 'unknown' });
          }
        }
      }
    }
  } else {
    columns.push({ name: '*', type: 'unknown' });
  }
}

/** Infer the type of a single expression via static analysis */
function inferType(expr: any, schemaData: SchemaEntry[], dialect: string): string {
  const key = getExprType(expr);
  const value = getExprValue(expr);

  // CAST(x AS type) → use the target type
  if (key === 'cast' && value?.to?.data_type) {
    return value.to.data_type.toLowerCase();
  }

  // Literal values
  if (key === 'literal') {
    return value.literal_type === 'number' ? 'number' : 'text';
  }

  // Column reference → look up in schema
  if (key === 'column') {
    const colName = value.name?.name;
    const tableRef = value.table?.name ?? null;
    if (colName) {
      return lookupColumnType(colName, tableRef, schemaData);
    }
  }

  // Aggregate/numeric functions
  const numericFuncs = ['count', 'sum', 'avg', 'min', 'max'];
  if (numericFuncs.includes(key)) {
    return 'number';
  }

  // String functions
  const stringFuncs = ['lower', 'upper', 'trim', 'concat', 'substr', 'substring'];
  if (stringFuncs.includes(key)) {
    return 'text';
  }

  // Date functions
  const dateFuncs = ['date', 'timestamp', 'now', 'current_date', 'current_timestamp', 'date_trunc'];
  if (dateFuncs.includes(key)) {
    return 'timestamp';
  }

  // Generic function node — check by original name
  if (key === 'function' || key === 'anonymous') {
    const funcName = (value.name ?? value.original_name ?? '').toLowerCase();
    if (numericFuncs.some((f) => funcName.includes(f))) return 'number';
    if (['date', 'timestamp', 'now', 'current'].some((f) => funcName.includes(f))) return 'timestamp';
    if (['concat', 'lower', 'upper', 'trim', 'substr'].some((f) => funcName.includes(f))) return 'text';
  }

  return 'unknown';
}

/** Look up a column's type from schema data */
function lookupColumnType(
  colName: string,
  tableRef: string | null,
  schemaData: SchemaEntry[],
): string {
  for (const entry of schemaData) {
    for (const schemaObj of entry.schemas ?? []) {
      for (const table of schemaObj.tables ?? []) {
        if (tableRef && table.table !== tableRef) continue;
        for (const col of table.columns ?? []) {
          if (col.name === colName) return col.type ?? 'unknown';
        }
      }
    }
  }
  return 'unknown';
}

/** Generate SQL string from an AST expression (for fallback naming) */
function generateSql(expr: any, dialect: string): string {
  try {
    const result = generate([{ select: { expressions: [expr], from: null, joins: [], lateral_views: [], where_clause: null, group_by: null, having: null, qualify: null, order_by: null, distribute_by: null, cluster_by: null, sort_by: null, limit: null, offset: null, fetch: null, distinct: false, distinct_on: null, top: null, with: null, sample: null, windows: null, hint: null, connect: null, into: null, locks: [], leading_comments: [] } }], dialect as Dialect);
    if (result.sql?.[0]) {
      // Extract the expression part from "SELECT expr"
      const sql = result.sql[0];
      const match = sql.match(/^SELECT\s+(.+)$/i);
      return match ? match[1] : sql;
    }
  } catch {
    // fallback
  }
  return getExprType(expr);
}
