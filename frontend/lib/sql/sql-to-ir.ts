/**
 * SQL to IR parser using @polyglot-sql/sdk (WASM).
 * Ported from backend/sql_ir/parser.py.
 */
import { init, parse, generate, Dialect } from '@polyglot-sql/sdk';
import { immutableSet } from '@/lib/utils/immutable-collections';
import type {
  QueryIR, CompoundQueryIR, AnyQueryIR, SelectColumn, TableReference,
  JoinClause, JoinCondition, FilterGroup, FilterCondition,
  GroupByClause, GroupByItem, OrderByClause, CTE,
} from './ir-types';
import { irToSqlLocal } from './ir-to-sql';

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

export class UnsupportedSQLError extends Error {
  features: string[];
  hint?: string;
  constructor(message: string, features: string[] = [], hint?: string) {
    super(message);
    this.name = 'UnsupportedSQLError';
    this.features = features;
    this.hint = hint;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function parseSqlToIrLocal(
  sql: string,
  dialect: string,
): Promise<AnyQueryIR> {
  await ensureInit();

  const result = parse(sql, dialect as Dialect);
  if (!result.ast || result.ast.length === 0) {
    throw new UnsupportedSQLError('Failed to parse SQL', ['PARSE_ERROR']);
  }

  const ast = result.ast[0];

  // Pre-validate: check for unsupported features
  const unsupported = validateSqlForGui(ast);
  if (unsupported.length > 0) {
    const hint = generateHint(unsupported);
    throw new UnsupportedSQLError(
      `SQL contains unsupported features: ${unsupported.join(', ')}`,
      unsupported,
      hint,
    );
  }

  // Check for UNION/compound query
  if ('union' in ast) {
    return parseCompoundQuery(ast, sql, dialect);
  }

  return parseSimpleQuery(ast, sql, dialect);
}

// ---------------------------------------------------------------------------
// Pre-validation (ported from enhanced_validator.py)
// ---------------------------------------------------------------------------

function validateSqlForGui(ast: any): string[] {
  const unsupported: string[] = [];
  const astStr = JSON.stringify(ast);

  // Check for subqueries (look for nested select inside where/from)
  if (ast.select?.where_clause) {
    const whereStr = JSON.stringify(ast.select.where_clause);
    if (whereStr.includes('"select"')) {
      unsupported.push('Subqueries');
    }
  }
  // Subquery in FROM
  if (ast.select?.from?.expressions) {
    for (const expr of ast.select.from.expressions) {
      if ('subquery' in expr || ('select' in expr && !('table' in expr))) {
        unsupported.push('Subqueries');
      }
    }
  }

  // Window functions (polyglot uses "over" key, not "window")
  if (astStr.includes('"over"')) {
    unsupported.push('Window functions');
  }

  // BETWEEN
  if (astStr.includes('"between"')) {
    unsupported.push('BETWEEN (use >= and <= instead)');
  }

  // NOT LIKE, NOT IN, NOT ILIKE
  checkNotOperators(ast, unsupported);

  // Regex operators
  if (astStr.includes('"regexp"') || astStr.includes('"regexp_like"') || astStr.includes('"regex"')) {
    unsupported.push('Regex operators (~, ~*, etc.)');
  }

  // Complex filter expressions (col1 + col2 > value)
  checkComplexFilters(ast, unsupported);

  return [...new Set(unsupported)]; // deduplicate
}

function checkNotOperators(ast: any, unsupported: string[]): void {
  const astStr = JSON.stringify(ast);
  // Walk for "not" nodes wrapping like/in/ilike
  const checkNode = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(checkNode); return; }
    if ('not' in node) {
      const inner = node.not;
      if (inner && typeof inner === 'object') {
        // polyglot wraps in { this: { like: ... } }
        const unwrapped = inner.this ?? inner;
        const innerKey = Object.keys(unwrapped)[0];
        if (innerKey === 'like') unsupported.push('NOT LIKE');
        else if (innerKey === 'in') unsupported.push('NOT IN');
        else if (innerKey === 'ilike' || innerKey === 'i_like') unsupported.push('NOT ILIKE');
      }
    }
    // Also check for NOT IN via in.not flag (polyglot alternative representation)
    if ('in' in node && node.in?.not === true) {
      unsupported.push('NOT IN');
    }
    for (const key of Object.keys(node)) {
      if (node[key] && typeof node[key] === 'object') checkNode(node[key]);
    }
  };
  // Only check WHERE/HAVING
  if (ast.select?.where_clause) checkNode(ast.select.where_clause);
  if (ast.select?.having) checkNode(ast.select.having);
}

function checkComplexFilters(ast: any, unsupported: string[]): void {
  const checkComparison = (cmp: any) => {
    if (!cmp) return;
    const left = cmp.left;
    const right = cmp.right;
    if (isComplexExpression(left) || isComplexExpression(right)) {
      unsupported.push('Complex expressions in filters (e.g., col1 + col2 > 10)');
    }
  };

  const walkFilters = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walkFilters); return; }
    const key = Object.keys(node)[0];
    if (['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'like', 'ilike', 'i_like'].includes(key)) {
      checkComparison(node[key]);
    }
    for (const k of Object.keys(node)) {
      if (node[k] && typeof node[k] === 'object') walkFilters(node[k]);
    }
  };

  if (ast.select?.where_clause) walkFilters(ast.select.where_clause);
  if (ast.select?.having) walkFilters(ast.select.having);
}

function isComplexExpression(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  const key = Object.keys(node)[0];
  // Simple: column, literal, boolean, null, parameter, star, placeholder
  if (['column', 'literal', 'boolean', 'null', 'parameter', 'star', 'placeholder'].includes(key)) return false;
  // Aggregates are simple in HAVING context
  if (['count', 'sum', 'avg', 'min', 'max'].includes(key)) return false;
  // Date functions are simple
  if (['date_trunc', 'timestamp_trunc', 'date', 'current_timestamp', 'current_date'].includes(key)) return false;
  // ROUND and SPLIT_PART are OK
  if (['round', 'split_part'].includes(key)) return false;
  // Arithmetic = complex
  if (['add', 'sub', 'mul', 'div', 'mod'].includes(key)) return true;
  // Cast = complex
  if (key === 'cast') return true;
  // Generic function — check name
  if (key === 'function') {
    const name = node.function?.name?.toUpperCase();
    if (['DATE_TRUNC', 'TIMESTAMP_TRUNC', 'CURRENT_TIMESTAMP', 'SPLIT_PART'].includes(name)) return false;
    return true;
  }
  return false;
}

function generateHint(features: string[]): string {
  if (features.some(f => f.includes('BETWEEN'))) {
    return 'Use >= and <= operators instead of BETWEEN. Switch to SQL mode for advanced features.';
  }
  if (features.some(f => f.includes('Complex'))) {
    return 'Simplify expressions or use SQL mode for complex queries.';
  }
  if (features.some(f => f.includes('Subquer') || f.includes('WITH'))) {
    return 'Remove subqueries/CTEs or use SQL mode for advanced queries.';
  }
  return 'These features are not supported in GUI mode. Use SQL mode for full flexibility.';
}

// ---------------------------------------------------------------------------
// Compound query (UNION / UNION ALL)
// ---------------------------------------------------------------------------

function parseCompoundQuery(ast: any, originalSql: string, dialect: string): CompoundQueryIR {
  const queries: any[] = [];
  const operators: ('UNION' | 'UNION ALL')[] = [];

  function flattenUnion(node: any) {
    if ('union' in node) {
      const u = node.union;
      flattenUnion(u.left);
      // polyglot: all=true → UNION ALL, all=false → UNION
      operators.push(u.all ? 'UNION ALL' : 'UNION');
      flattenUnion(u.right);
    } else {
      queries.push(node);
    }
  }
  flattenUnion(ast);

  // Extract compound-level ORDER BY and LIMIT
  // polyglot puts these on the last SELECT branch, not the union node
  let compoundOrderBy: OrderByClause[] | undefined;
  let compoundLimit: number | undefined;

  const unionNode = ast.union;

  // Check union node first
  if (unionNode.order_by) {
    compoundOrderBy = parseOrderByExpressions(unionNode.order_by, dialect);
  }
  if (unionNode.limit?.this?.literal) {
    try { compoundLimit = parseInt(unionNode.limit.this.literal.value); } catch {}
  } else if (unionNode.limit?.literal) {
    try { compoundLimit = parseInt(unionNode.limit.literal.value); } catch {}
  }

  // Fallback: check last query branch for ORDER BY/LIMIT
  if (queries.length > 0) {
    const lastQuery = queries[queries.length - 1];
    const lastSelect = lastQuery.select ?? lastQuery;
    if (!compoundOrderBy && lastSelect.order_by) {
      compoundOrderBy = parseOrderByExpressions(lastSelect.order_by, dialect);
      lastSelect.order_by = null; // clear so individual query doesn't get it
    }
    if (compoundLimit == null && lastSelect.limit) {
      const limitInner = lastSelect.limit.this ?? lastSelect.limit;
      if (limitInner?.literal) {
        try { compoundLimit = parseInt(limitInner.literal.value); } catch {}
      }
      lastSelect.limit = null; // clear
    }
  }

  const queryIrs = queries.map(q => {
    const selectNode = q.select ?? q;
    return parseSelectToQueryIR(selectNode, dialect);
  });

  return {
    type: 'compound',
    version: 1,
    queries: queryIrs,
    operators,
    order_by: compoundOrderBy,
    limit: compoundLimit,
  };
}

// ---------------------------------------------------------------------------
// Simple query
// ---------------------------------------------------------------------------

function parseSimpleQuery(ast: any, originalSql: string, dialect: string): QueryIR {
  const selectNode = ast.select;
  if (!selectNode) {
    throw new UnsupportedSQLError('No SELECT statement found', ['NO_SELECT']);
  }

  // Check for subqueries (unsupported)
  checkForSubqueries(selectNode);

  return parseSelectToQueryIR(selectNode, dialect);
}

function checkForSubqueries(node: any) {
  // Check FROM for subqueries
  if (node.from?.expressions) {
    for (const expr of node.from.expressions) {
      if ('subquery' in expr || 'select' in expr) {
        throw new UnsupportedSQLError('Subqueries in FROM not supported', ['Subqueries']);
      }
    }
  }
  // Check WHERE for subqueries (IN (SELECT ...))
  if (node.where_clause) {
    const whereStr = JSON.stringify(node.where_clause);
    if (whereStr.includes('"select"')) {
      throw new UnsupportedSQLError('Subqueries in WHERE not supported', ['Subqueries']);
    }
  }
}

function parseSelectToQueryIR(selectNode: any, dialect: string): QueryIR {
  // CTEs
  let ctes: CTE[] | undefined;
  if (selectNode.with?.ctes) {
    ctes = selectNode.with.ctes.map((cte: any) => {
      const cteBody = generateSqlFromAst(cte.this, dialect);
      return { name: cte.alias?.name ?? '', raw_sql: cteBody };
    });
  }

  // DISTINCT
  const distinct = !!selectNode.distinct;

  const select = parseSelectColumns(selectNode, dialect);
  const from = parseFrom(selectNode);
  const joins = parseJoins(selectNode, dialect);
  const where = parseWhere(selectNode, dialect);
  const groupBy = parseGroupBy(selectNode, dialect);
  const having = parseHaving(selectNode, dialect);
  const orderBy = parseOrderBy(selectNode, dialect);
  const limit = parseLimit(selectNode);

  const ir: QueryIR = {
    type: 'simple',
    version: 1,
    distinct,
    ctes: ctes?.length ? ctes : undefined,
    select,
    from,
    joins: joins?.length ? joins : undefined,
    where: where ?? undefined,
    group_by: groupBy ?? undefined,
    having: having ?? undefined,
    order_by: orderBy?.length ? orderBy : undefined,
    limit,
  };

  return ir;
}

// ---------------------------------------------------------------------------
// SELECT columns
// ---------------------------------------------------------------------------

const AGG_TYPES: Record<string, string> = {
  count: 'COUNT', sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX',
};

function parseSelectColumns(selectNode: any, dialect: string): SelectColumn[] {
  const columns: SelectColumn[] = [];
  for (const expr of selectNode.expressions ?? []) {
    columns.push(parseOneSelectExpr(expr, dialect));
  }
  return columns;
}

function parseOneSelectExpr(expr: any, dialect: string): SelectColumn {
  let alias: string | undefined;
  let actual = expr;

  // Unwrap alias
  if ('alias' in expr) {
    alias = expr.alias.alias?.name;
    actual = expr.alias.this;
  }

  const key = Object.keys(actual)[0];

  // Aggregate functions
  if (key in AGG_TYPES) {
    return parseAggregateExpr(actual, key, alias, dialect);
  }

  // Star
  if (key === 'star') {
    return { type: 'column', column: '*', alias };
  }

  // Column
  if (key === 'column') {
    return {
      type: 'column',
      column: actual.column.name?.name ?? actual.column.name,
      table: actual.column.table?.name ?? undefined,
      alias,
    };
  }

  // DATE_TRUNC / TIMESTAMP_TRUNC
  if (key === 'date_trunc' || key === 'timestamp_trunc') {
    const dt = parseDateTruncExpr(actual[key]);
    if (dt) return { ...dt, alias };
  }

  // DATE()
  if (key === 'date') {
    const inner = actual.date.this;
    const colName = inner?.column?.name?.name ?? generateSqlFromAst(inner, dialect);
    const tableName = inner?.column?.table?.name ?? undefined;
    return { type: 'expression', function: 'DATE', column: colName, table: tableName, alias };
  }

  // ROUND(aggregate)
  if (key === 'round') {
    const inner = actual.round.this;
    const innerKey = inner ? Object.keys(inner)[0] : null;
    if (innerKey && innerKey in AGG_TYPES) {
      const aggCol = parseAggregateExpr({ [innerKey]: inner[innerKey] }, innerKey, undefined, dialect);
      const decimals = actual.round.decimals?.literal?.value;
      return {
        ...aggCol,
        alias,
        wrapper_function: 'ROUND',
        wrapper_args: decimals != null ? [parseInt(decimals)] : [],
      };
    }
  }

  // SPLIT_PART
  if (key === 'split_part') {
    const sp = actual.split_part;
    const colExpr = sp.this;
    const colName = colExpr?.column?.name?.name ?? generateSqlFromAst(colExpr, dialect);
    const tableName = colExpr?.column?.table?.name ?? undefined;
    const delimiter = sp.delimiter?.literal?.value ?? sp.args?.[0]?.literal?.value ?? '';
    const partIndex = parseInt(sp.part_index?.literal?.value ?? sp.args?.[1]?.literal?.value ?? '1');
    return {
      type: 'expression',
      function: 'SPLIT_PART',
      column: colName,
      table: tableName,
      function_args: [delimiter, partIndex],
      alias,
    };
  }

  // Generic function node — check for known functions like DATE_TRUNC
  if (key === 'function') {
    const funcName = actual.function.name?.toUpperCase();
    if (funcName === 'DATE_TRUNC' && actual.function.args?.length >= 2) {
      const args = actual.function.args;
      // BigQuery arg order: DATE_TRUNC(col, unit)
      const colArg = args[0];
      const unitArg = args[1];
      const colName = colArg?.column?.name?.name;
      const unitStr = unitArg?.var?.this?.toUpperCase() ?? unitArg?.literal?.value?.toUpperCase();
      if (colName && unitStr && DATE_TRUNC_UNITS.has(unitStr)) {
        return {
          type: 'expression',
          function: 'DATE_TRUNC',
          column: colName,
          table: colArg?.column?.table?.name ?? undefined,
          unit: unitStr as any,
          alias,
        };
      }
    }
  }

  // Fallback: raw SQL
  return {
    type: 'raw',
    raw_sql: generateSqlFromAst(actual, dialect),
    alias,
  };
}

function parseAggregateExpr(actual: any, key: string, alias: string | undefined, dialect: string): SelectColumn {
  const aggValue = actual[key];
  let aggType = AGG_TYPES[key];
  let colName: string | null = null;
  let tableName: string | undefined;

  if (key === 'count') {
    if (aggValue.star) {
      colName = null; // COUNT(*)
    } else if (aggValue.distinct && aggValue.this) {
      aggType = 'COUNT_DISTINCT';
      const inner = aggValue.this;
      if (inner?.column) {
        colName = inner.column.name?.name;
        tableName = inner.column.table?.name ?? undefined;
      } else {
        colName = generateSqlFromAst(inner, dialect);
      }
    } else if (aggValue.this) {
      const inner = aggValue.this;
      if (inner?.column) {
        colName = inner.column.name?.name;
        tableName = inner.column.table?.name ?? undefined;
      } else {
        // Complex COUNT (e.g. COUNT(CASE WHEN ...)) → raw
        return {
          type: 'raw',
          raw_sql: generateSqlFromAst(actual, dialect),
          alias,
        };
      }
    }
  } else {
    // SUM, AVG, MIN, MAX
    const inner = aggValue.this;
    if (inner?.column) {
      colName = inner.column.name?.name;
      tableName = inner.column.table?.name ?? undefined;
    } else if (inner?.star) {
      colName = '*';
    } else {
      // Complex aggregate → raw
      return {
        type: 'raw',
        raw_sql: generateSqlFromAst(actual, dialect),
        alias,
      };
    }
  }

  return {
    type: 'aggregate',
    column: colName,
    table: tableName,
    aggregate: aggType as any,
    alias,
  };
}

// ---------------------------------------------------------------------------
// DATE_TRUNC
// ---------------------------------------------------------------------------

const DATE_TRUNC_UNITS = immutableSet(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'HOUR', 'MINUTE']);

function parseDateTruncExpr(dt: any): SelectColumn | null {
  // Get unit
  let unitStr: string | null = null;
  const unitExpr = dt.unit;
  if (unitExpr?.var) unitStr = unitExpr.var.name?.toUpperCase();
  else if (unitExpr?.literal) unitStr = String(unitExpr.literal.value).toUpperCase();
  else if (typeof unitExpr === 'string') unitStr = unitExpr.toUpperCase();

  // Get column
  const colExpr = dt.this;
  if (unitStr && DATE_TRUNC_UNITS.has(unitStr) && colExpr?.column) {
    return {
      type: 'expression',
      function: 'DATE_TRUNC',
      column: colExpr.column.name?.name,
      table: colExpr.column.table?.name ?? undefined,
      unit: unitStr as any,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// FROM
// ---------------------------------------------------------------------------

function parseFrom(selectNode: any): TableReference {
  const fromExpressions = selectNode.from?.expressions;
  if (!fromExpressions?.length) {
    throw new UnsupportedSQLError('No FROM clause found', ['NO_FROM']);
  }

  const tableExpr = fromExpressions[0];
  if (!tableExpr.table) {
    throw new UnsupportedSQLError('Complex FROM clause not supported', ['COMPLEX_FROM']);
  }

  return {
    table: tableExpr.table.name?.name ?? tableExpr.table.name,
    schema: tableExpr.table.schema?.name ?? undefined,
    alias: tableExpr.table.alias?.name ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// JOINs
// ---------------------------------------------------------------------------

function parseJoins(selectNode: any, dialect: string): JoinClause[] | undefined {
  const joins: JoinClause[] = [];

  for (const joinNode of selectNode.joins ?? []) {
    let joinKind = (joinNode.kind ?? 'Inner').toUpperCase();
    if (joinKind === 'INNER') joinKind = 'INNER';

    if (!['INNER', 'LEFT', 'FULL'].includes(joinKind)) continue;

    const tableExpr = joinNode.this?.table;
    if (!tableExpr) continue;

    const table: TableReference = {
      table: tableExpr.name?.name ?? tableExpr.name,
      schema: tableExpr.schema?.name ?? undefined,
      alias: tableExpr.alias?.name ?? undefined,
    };

    // Parse ON conditions
    let onConditions: JoinCondition[] | undefined;
    let rawOnSql: string | undefined;
    const onExpr = joinNode.on;

    if (onExpr) {
      if (isSimpleJoinOn(onExpr)) {
        onConditions = parseJoinConditions(onExpr);
      } else {
        rawOnSql = generateSqlFromAst(onExpr, dialect);
      }
    }

    joins.push({
      type: joinKind as any,
      table,
      on: onConditions,
      raw_on_sql: rawOnSql,
    });
  }

  return joins.length ? joins : undefined;
}

function isSimpleJoinOn(onExpr: any): boolean {
  // Simple equi-join: all conditions are col = col
  const conditions = flattenAnd(onExpr);
  return conditions.every(c => {
    const key = Object.keys(c)[0];
    if (key !== 'eq') return false;
    const eq = c.eq;
    return eq.left?.column && eq.right?.column;
  });
}

function flattenAnd(expr: any): any[] {
  if (!expr) return [];
  const key = Object.keys(expr)[0];
  if (key === 'and') {
    return [...flattenAnd(expr.and.left), ...flattenAnd(expr.and.right)];
  }
  return [expr];
}

function parseJoinConditions(onExpr: any): JoinCondition[] {
  const conditions: JoinCondition[] = [];
  for (const cond of flattenAnd(onExpr)) {
    const key = Object.keys(cond)[0];
    if (key === 'eq') {
      const eq = cond.eq;
      if (eq.left?.column && eq.right?.column) {
        conditions.push({
          left_table: eq.left.column.table?.name ?? '',
          left_column: eq.left.column.name?.name ?? '',
          right_table: eq.right.column.table?.name ?? '',
          right_column: eq.right.column.name?.name ?? '',
        });
      }
    }
  }
  return conditions;
}

// ---------------------------------------------------------------------------
// WHERE / HAVING
// ---------------------------------------------------------------------------

function parseWhere(selectNode: any, dialect: string): FilterGroup | undefined {
  const whereClause = selectNode.where_clause;
  if (!whereClause) return undefined;
  // polyglot wraps in { this: ... }
  const inner = whereClause.this ?? whereClause;
  return parseFilterExpression(inner, dialect);
}

function parseHaving(selectNode: any, dialect: string): FilterGroup | undefined {
  const havingClause = selectNode.having;
  if (!havingClause) return undefined;
  // polyglot wraps in { this: ... }
  const inner = havingClause.this ?? havingClause;
  return parseFilterExpression(inner, dialect);
}

function parseFilterExpression(expr: any, dialect: string): FilterGroup {
  const key = Object.keys(expr)[0];

  if (key === 'and' || key === 'or') {
    const operator = key.toUpperCase() as 'AND' | 'OR';
    const left = expr[key].left;
    const right = expr[key].right;
    const conditions: (FilterCondition | FilterGroup)[] = [];

    // Flatten nested AND/OR
    for (const child of [left, right]) {
      const childKey = Object.keys(child)[0];
      if (childKey === key) {
        // Same operator → flatten
        const nested = parseFilterExpression(child, dialect);
        conditions.push(...nested.conditions);
      } else if (childKey === 'and' || childKey === 'or') {
        conditions.push(parseFilterExpression(child, dialect));
      } else {
        const cond = parseSingleCondition(child, dialect);
        if (cond) conditions.push(cond);
      }
    }

    return { operator, conditions };
  }

  // Single condition wrapped in AND group
  const cond = parseSingleCondition(expr, dialect);
  return { operator: 'AND', conditions: cond ? [cond] : [] };
}

function parseSingleCondition(expr: any, dialect: string): FilterCondition | null {
  const key = Object.keys(expr)[0];

  // IS NULL / IS NOT NULL (polyglot uses is_null with .not flag)
  if (key === 'is_null') {
    const isNull = expr.is_null;
    const colExpr = isNull.this;
    if (colExpr?.column) {
      return {
        column: colExpr.column.name?.name,
        table: colExpr.column.table?.name ?? undefined,
        operator: isNull.not ? 'IS NOT NULL' : 'IS NULL',
      };
    }
  }

  // NOT(IS NULL) = IS NOT NULL (fallback for different AST shapes)
  if (key === 'not') {
    const inner = expr.not;
    const innerKey = Object.keys(inner)[0];
    if (innerKey === 'is' || innerKey === 'is_null') {
      const isExpr = inner[innerKey];
      const colExpr = isExpr.this;
      if (colExpr?.column) {
        return {
          column: colExpr.column.name?.name,
          table: colExpr.column.table?.name ?? undefined,
          operator: 'IS NOT NULL',
        };
      }
    }
  }

  // Comparison operators
  const CMP_OPS: Record<string, FilterCondition['operator']> = {
    eq: '=', neq: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=', like: 'LIKE', ilike: 'ILIKE', i_like: 'ILIKE',
  };

  if (key in CMP_OPS) {
    return parseComparison(expr[key], CMP_OPS[key], dialect);
  }

  // IN
  if (key === 'in') {
    return parseInCondition(expr.in);
  }

  // IS NULL (sqlglot-style fallback)
  if (key === 'is') {
    const colExpr = expr.is.this;
    if (colExpr?.column) {
      return {
        column: colExpr.column.name?.name,
        table: colExpr.column.table?.name ?? undefined,
        operator: 'IS NULL',
      };
    }
  }

  return null;
}

function parseComparison(comp: any, operator: FilterCondition['operator'], dialect: string): FilterCondition | null {
  const left = comp.left;
  const right = comp.right;

  // Check if left is an aggregate
  let aggregate: FilterCondition['aggregate'];
  let columnExpr = left;

  const leftKey = left ? Object.keys(left)[0] : null;
  if (leftKey && leftKey in AGG_TYPES) {
    const aggVal = left[leftKey];
    if (leftKey === 'count' && aggVal.distinct) {
      aggregate = 'COUNT_DISTINCT';
      columnExpr = aggVal.this;
    } else if (leftKey === 'count' && aggVal.star) {
      aggregate = 'COUNT';
      columnExpr = null;
    } else {
      aggregate = AGG_TYPES[leftKey] as any;
      columnExpr = aggVal.this;
    }
  }

  // Generic function DATE_TRUNC on left (BigQuery style)
  if (leftKey === 'function' && left.function?.name?.toUpperCase() === 'DATE_TRUNC') {
    const args = left.function.args ?? [];
    if (args.length >= 2) {
      const colArg = args[0];
      const unitArg = args[1];
      const colName = colArg?.column?.name?.name;
      const unitStr = unitArg?.var?.this?.toUpperCase() ?? unitArg?.literal?.value?.toUpperCase();
      if (colName && unitStr && DATE_TRUNC_UNITS.has(unitStr)) {
        const rv = parseRightValue(right, dialect);
        return {
          column: colName,
          table: colArg?.column?.table?.name ?? undefined,
          operator,
          function: 'DATE_TRUNC',
          unit: unitStr as any,
          ...rv,
        };
      }
    }
  }

  // DATE_TRUNC on left
  if (leftKey === 'date_trunc' || leftKey === 'timestamp_trunc') {
    const dt = parseDateTruncExpr(left[leftKey]);
    if (dt) {
      const rv = parseRightValue(right, dialect);
      return {
        column: dt.column ?? undefined,
        table: dt.table,
        operator,
        function: 'DATE_TRUNC',
        unit: dt.unit,
        ...rv,
      };
    }
  }

  // Raw column (non-column expression like SPLIT_PART)
  if (columnExpr && !columnExpr.column && !aggregate) {
    const rawColumn = generateSqlFromAst({ [leftKey!]: left[leftKey!] }, dialect);
    const rv = parseRightValue(right, dialect);
    return { operator, raw_column: rawColumn, ...rv } as any;
  }

  // Extract column name
  let colName: string | null | undefined;
  let tableName: string | undefined;

  if (columnExpr === null) {
    colName = null; // COUNT(*)
  } else if (columnExpr?.column) {
    colName = columnExpr.column.name?.name;
    tableName = columnExpr.column.table?.name ?? undefined;
  } else if (columnExpr?.star) {
    colName = null;
  }

  const rv = parseRightValue(right, dialect);

  return {
    column: colName ?? undefined,
    table: tableName,
    aggregate,
    operator,
    ...rv,
  };
}

function parseRightValue(right: any, dialect: string): Partial<FilterCondition> {
  if (!right) return {};
  const rightKey = Object.keys(right)[0];

  if (rightKey === 'placeholder' || rightKey === 'parameter') {
    const ph = right[rightKey];
    return { param_name: ph.name ?? ph.this ?? ph.index };
  }
  if (rightKey === 'literal') {
    const lit = right.literal;
    let value: any = lit.value;
    if (lit.literal_type === 'number') {
      value = String(value).includes('.') ? parseFloat(value) : parseInt(value);
    }
    return { value };
  }
  if (rightKey === 'boolean') {
    const boolVal = right.boolean;
    return { value: typeof boolVal === 'object' ? boolVal.value : boolVal };
  }
  if (rightKey === 'null') {
    return { value: undefined };
  }
  // true/false as column references (polyglot parses `true` as column in some contexts)
  if (rightKey === 'column') {
    const name = right.column.name?.name?.toLowerCase();
    if (name === 'true') return { value: true };
    if (name === 'false') return { value: false };
  }

  // Fallback: raw value
  return { raw_value: generateSqlFromAst(right, dialect) };
}

function parseInCondition(inExpr: any): FilterCondition | null {
  const colExpr = inExpr.this;
  if (!colExpr?.column) return null;

  const values: string[] = [];
  for (const val of inExpr.expressions ?? []) {
    const valKey = Object.keys(val)[0];
    if (valKey === 'literal') {
      values.push(val.literal.value);
    } else {
      values.push(generateSqlFromAst(val, 'duckdb'));
    }
  }

  return {
    column: colExpr.column.name?.name,
    table: colExpr.column.table?.name ?? undefined,
    operator: 'IN',
    value: values,
  };
}

// ---------------------------------------------------------------------------
// GROUP BY
// ---------------------------------------------------------------------------

function parseGroupBy(selectNode: any, dialect: string): GroupByClause | undefined {
  const groupClause = selectNode.group_by;
  if (!groupClause?.expressions?.length) return undefined;

  const columns: GroupByItem[] = [];
  for (const expr of groupClause.expressions) {
    const key = Object.keys(expr)[0];

    if (key === 'column') {
      columns.push({
        type: 'column',
        column: expr.column.name?.name,
        table: expr.column.table?.name ?? undefined,
      });
    } else if (key === 'function' && expr.function?.name?.toUpperCase() === 'DATE_TRUNC') {
      // BigQuery-style generic function DATE_TRUNC
      const args = expr.function.args ?? [];
      if (args.length >= 2) {
        const colArg = args[0];
        const unitArg = args[1];
        const colName = colArg?.column?.name?.name;
        const unitStr = unitArg?.var?.this?.toUpperCase() ?? unitArg?.literal?.value?.toUpperCase();
        if (colName && unitStr && DATE_TRUNC_UNITS.has(unitStr)) {
          columns.push({
            type: 'expression',
            column: colName,
            table: colArg?.column?.table?.name ?? undefined,
            function: 'DATE_TRUNC',
            unit: unitStr as any,
          });
        } else {
          columns.push({ column: generateSqlFromAst(expr, dialect) });
        }
      } else {
        columns.push({ column: generateSqlFromAst(expr, dialect) });
      }
    } else if (key === 'date_trunc' || key === 'timestamp_trunc') {
      const dt = parseDateTruncExpr(expr[key]);
      if (dt) {
        columns.push({
          type: 'expression',
          column: dt.column!,
          table: dt.table,
          function: 'DATE_TRUNC',
          unit: dt.unit,
        });
      } else {
        columns.push({ column: generateSqlFromAst(expr, dialect) });
      }
    } else if (key === 'date') {
      const inner = expr.date.this;
      columns.push({
        type: 'expression',
        column: inner?.column?.name?.name ?? generateSqlFromAst(inner, dialect),
        table: inner?.column?.table?.name ?? undefined,
        function: 'DATE',
      });
    } else if (key === 'literal' && expr.literal.literal_type === 'number') {
      // Positional reference (GROUP BY 1) → resolve from SELECT
      const pos = parseInt(expr.literal.value);
      const selectExprs = selectNode.expressions ?? [];
      if (pos >= 1 && pos <= selectExprs.length) {
        const refExpr = selectExprs[pos - 1];
        const resolved = parseOneSelectExpr(refExpr, dialect);
        if (resolved.type === 'column' && resolved.column) {
          columns.push({ type: 'column', column: resolved.column, table: resolved.table });
        } else if (resolved.type === 'expression') {
          columns.push({
            type: 'expression',
            column: resolved.column!,
            table: resolved.table,
            function: resolved.function as any,
            unit: resolved.unit,
          });
        } else {
          columns.push({ column: generateSqlFromAst(refExpr, dialect) });
        }
      }
    } else {
      columns.push({ column: generateSqlFromAst(expr, dialect) });
    }
  }

  return columns.length ? { columns } : undefined;
}

// ---------------------------------------------------------------------------
// ORDER BY
// ---------------------------------------------------------------------------

function parseOrderBy(selectNode: any, dialect: string): OrderByClause[] | undefined {
  const orderClause = selectNode.order_by;
  if (!orderClause) return undefined;
  return parseOrderByExpressions(orderClause, dialect, selectNode.expressions);
}

function parseOrderByExpressions(
  orderClause: any,
  dialect: string,
  selectExprs?: any[],
): OrderByClause[] {
  const orderBy: OrderByClause[] = [];
  const orderedList = orderClause.expressions ?? orderClause;
  if (!Array.isArray(orderedList)) return orderBy;

  for (const ordered of orderedList) {
    const direction: 'ASC' | 'DESC' = ordered.desc ? 'DESC' : 'ASC';
    const colExpr = ordered.this;
    if (!colExpr) continue;

    const key = Object.keys(colExpr)[0];

    if (key === 'column') {
      orderBy.push({
        type: 'column',
        column: colExpr.column.name?.name,
        table: colExpr.column.table?.name ?? undefined,
        direction,
      });
    } else if (key === 'date_trunc' || key === 'timestamp_trunc') {
      const dt = parseDateTruncExpr(colExpr[key]);
      if (dt) {
        orderBy.push({
          type: 'expression',
          column: dt.column!,
          table: dt.table,
          direction,
          function: 'DATE_TRUNC',
          unit: dt.unit,
        });
      } else {
        orderBy.push({ type: 'raw', raw_sql: generateSqlFromAst(colExpr, dialect), direction });
      }
    } else if (key === 'literal' && colExpr.literal.literal_type === 'number') {
      // Positional reference (ORDER BY 1) → resolve from SELECT
      const pos = parseInt(colExpr.literal.value);
      if (selectExprs && pos >= 1 && pos <= selectExprs.length) {
        const refExpr = selectExprs[pos - 1];
        const resolved = parseOneSelectExpr(refExpr, dialect);
        // Prefer expression type (DATE_TRUNC etc.) over alias
        if (resolved.type === 'expression' && resolved.function) {
          orderBy.push({
            type: 'expression',
            column: resolved.column!,
            table: resolved.table,
            direction,
            function: resolved.function as any,
            unit: resolved.unit,
          });
        } else if (resolved.alias) {
          orderBy.push({ type: 'column', column: resolved.alias, direction });
        } else if (resolved.type === 'column' && resolved.column) {
          orderBy.push({ type: 'column', column: resolved.column, table: resolved.table, direction });
        } else {
          orderBy.push({ type: 'raw', raw_sql: generateSqlFromAst(colExpr, dialect), direction });
        }
      }
    } else {
      orderBy.push({ type: 'raw', raw_sql: generateSqlFromAst(colExpr, dialect), direction });
    }
  }

  return orderBy.length ? orderBy : [];
}

// ---------------------------------------------------------------------------
// LIMIT
// ---------------------------------------------------------------------------

function parseLimit(selectNode: any): number | undefined {
  const limitClause = selectNode.limit;
  if (!limitClause) return undefined;

  // polyglot wraps: { this: { literal: { value: '10' } } }
  const inner = limitClause.this ?? limitClause;
  if (inner?.literal) {
    try { return parseInt(inner.literal.value); } catch { return undefined; }
  }
  if (limitClause.literal) {
    try { return parseInt(limitClause.literal.value); } catch { return undefined; }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSqlFromAst(node: any, dialect: string): string {
  try {
    const result = generate([{ select: { expressions: [node], from: null, joins: [], lateral_views: [], where_clause: null, group_by: null, having: null, qualify: null, order_by: null, distribute_by: null, cluster_by: null, sort_by: null, limit: null, offset: null, fetch: null, distinct: false, distinct_on: null, top: null, with: null, sample: null, windows: null, hint: null, connect: null, into: null, locks: [], leading_comments: [] } }], dialect as Dialect);
    if (result.sql?.[0]) {
      const sql = result.sql[0];
      const match = sql.match(/^SELECT\s+(.+)$/i);
      return match ? match[1] : sql;
    }
  } catch {
    // fallback
  }
  return JSON.stringify(node);
}
