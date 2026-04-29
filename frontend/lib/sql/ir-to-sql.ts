/**
 * IR to SQL generator. Converts QueryIR/CompoundQueryIR back to SQL strings.
 * Ported from backend/sql_ir/generator.py.
 */
import type {
  QueryIR, CompoundQueryIR, AnyQueryIR, SelectColumn, FilterGroup,
  FilterCondition, JoinClause, GroupByItem, OrderByClause,
} from './ir-types';
import { isCompoundQueryIR } from './ir-types';

function dateTruncExpr(colRef: string, unit: string, dialect: string): string {
  if (dialect === 'bigquery') return `DATE_TRUNC(${colRef}, ${unit})`;
  return `DATE_TRUNC('${unit}', ${colRef})`;
}

function formatValue(value: any): string {
  if (value == null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === 'number') return String(value);
  return String(value);
}

function generateSelectColumn(col: SelectColumn, dialect: string): string {
  let result = '';

  if (col.type === 'raw') {
    result = col.raw_sql ?? '*';
  } else if (col.type === 'aggregate') {
    const colRef = (col.column == null || col.column === '*')
      ? '*'
      : (col.table ? `${col.table}.${col.column}` : col.column);

    if (col.aggregate === 'COUNT_DISTINCT') {
      result = `COUNT(DISTINCT ${colRef})`;
    } else {
      result = `${col.aggregate}(${colRef})`;
    }

    if (col.wrapper_function === 'ROUND') {
      const argsStr = (col.wrapper_args ?? []).join(', ');
      result = argsStr ? `ROUND(${result}, ${argsStr})` : `ROUND(${result})`;
    }
  } else if (col.type === 'expression') {
    const colRef = col.table ? `${col.table}.${col.column}` : col.column!;
    if (col.function === 'DATE_TRUNC') {
      result = dateTruncExpr(colRef, col.unit!, dialect);
    } else if (col.function === 'DATE') {
      result = `DATE(${colRef})`;
    } else if (col.function === 'SPLIT_PART') {
      const args = col.function_args ?? [];
      result = `SPLIT_PART(${colRef}, '${args[0]}', ${args[1]})`;
    } else {
      result = colRef ?? '*';
    }
  } else {
    // Regular column
    if (col.column === '*') {
      result = '*';
    } else if (col.table) {
      result = `${col.table}.${col.column}`;
    } else {
      result = col.column ?? '*';
    }
  }

  if (col.alias) result += ` AS ${col.alias}`;
  return result;
}

function generateJoinClause(join: JoinClause): string {
  let joinType: string;
  if (join.type === 'LEFT') joinType = 'LEFT JOIN';
  else if (join.type === 'FULL') joinType = 'FULL OUTER JOIN';
  else joinType = 'JOIN';

  let table = join.table.table;
  if (join.table.schema) table = `${join.table.schema}.${table}`;
  if (join.table.alias) table += ` ${join.table.alias}`;

  if (join.raw_on_sql) return `${joinType} ${table} ON ${join.raw_on_sql}`;

  const conditions = (join.on ?? []).map(
    c => `${c.left_table}.${c.left_column} = ${c.right_table}.${c.right_column}`,
  );

  if (conditions.length > 0) return `${joinType} ${table} ON ${conditions.join(' AND ')}`;
  return `${joinType} ${table}`;
}

function generateFilterCondition(cond: FilterCondition, dialect: string): string {
  // Raw column expression
  if ((cond as any).raw_column) {
    const column = (cond as any).raw_column;
    if (cond.operator === 'IS NULL' || cond.operator === 'IS NOT NULL') return `${column} ${cond.operator}`;
    if (cond.param_name) return `${column} ${cond.operator} :${cond.param_name}`;
    if (cond.raw_value != null) return `${column} ${cond.operator} ${cond.raw_value}`;
    return `${column} ${cond.operator} ${formatValue(cond.value)}`;
  }

  // Build column reference
  let column: string;
  if (cond.aggregate) {
    const colRef = (cond.column == null || cond.column === '*')
      ? '*'
      : (cond.table ? `${cond.table}.${cond.column}` : cond.column);
    if (cond.aggregate === 'COUNT_DISTINCT') {
      column = `COUNT(DISTINCT ${colRef})`;
    } else {
      column = `${cond.aggregate}(${colRef})`;
    }
  } else if (cond.function === 'DATE_TRUNC') {
    const colRef = cond.table ? `${cond.table}.${cond.column}` : cond.column!;
    column = dateTruncExpr(colRef, cond.unit!, dialect);
  } else {
    column = cond.table ? `${cond.table}.${cond.column}` : cond.column!;
  }

  if (cond.operator === 'IS NULL' || cond.operator === 'IS NOT NULL') return `${column} ${cond.operator}`;

  if (cond.operator === 'IN') {
    const values = Array.isArray(cond.value)
      ? cond.value.map(v => formatValue(v)).join(', ')
      : formatValue(cond.value);
    return `${column} IN (${values})`;
  }

  if (cond.param_name) return `${column} ${cond.operator} :${cond.param_name}`;
  if (cond.raw_value != null) return `${column} ${cond.operator} ${cond.raw_value}`;
  return `${column} ${cond.operator} ${formatValue(cond.value)}`;
}

function generateFilterGroup(group: FilterGroup, dialect: string): string {
  if (!group.conditions?.length) return '';
  const parts = group.conditions.map(cond => {
    if ('conditions' in cond && Array.isArray((cond as FilterGroup).conditions)) {
      return '(' + generateFilterGroup(cond as FilterGroup, dialect) + ')';
    }
    return generateFilterCondition(cond as FilterCondition, dialect);
  });
  return parts.join(` ${group.operator} `);
}

function generateGroupByClause(columns: GroupByItem[], dialect: string): string {
  return columns.map(col => {
    const colRef = col.table ? `${col.table}.${col.column}` : col.column;
    if (col.type === 'expression' && col.function === 'DATE_TRUNC') {
      return dateTruncExpr(colRef, col.unit!, dialect);
    } else if (col.type === 'expression' && col.function === 'DATE') {
      return `DATE(${colRef})`;
    } else if (col.type === 'expression' && col.function === 'SPLIT_PART') {
      const args = col.function_args ?? [];
      return `SPLIT_PART(${colRef}, '${args[0]}', ${args[1]})`;
    }
    return colRef;
  }).join(', ');
}

function generateOrderByExpression(col: OrderByClause, dialect: string): string {
  if (col.type === 'raw') return col.raw_sql ?? '';
  const colRef = col.table ? `${col.table}.${col.column}` : col.column!;
  if (col.type === 'expression' && col.function === 'DATE_TRUNC') {
    return dateTruncExpr(colRef, col.unit!, dialect);
  }
  if (col.type === 'expression' && col.function === 'DATE') {
    return `DATE(${colRef})`;
  }
  return colRef;
}

function queryIrToSql(ir: QueryIR, dialect: string): string {
  const parts: string[] = [];

  // SELECT
  const selectKeyword = ir.distinct ? 'SELECT DISTINCT' : 'SELECT';
  const selectCols = (!ir.select?.length)
    ? ['*']
    : (ir.select.length === 1 && ir.select[0].column === '*' && ir.select[0].type === 'column')
      ? ['*']
      : ir.select.map(c => generateSelectColumn(c, dialect));

  if (selectCols.length > 1) {
    parts.push(`${selectKeyword}\n  ${selectCols.join(',\n  ')}`);
  } else {
    parts.push(`${selectKeyword} ${selectCols[0]}`);
  }

  // FROM
  let fromClause = ir.from.table;
  if (ir.from.schema) fromClause = `${ir.from.schema}.${fromClause}`;
  if (ir.from.alias) fromClause += ` ${ir.from.alias}`;
  parts.push(`FROM ${fromClause}`);

  // JOINs
  if (ir.joins) {
    for (const join of ir.joins) {
      parts.push(generateJoinClause(join));
    }
  }

  // WHERE
  if (ir.where?.conditions?.length) {
    parts.push('WHERE ' + generateFilterGroup(ir.where, dialect));
  }

  // GROUP BY
  if (ir.group_by?.columns?.length) {
    parts.push('GROUP BY ' + generateGroupByClause(ir.group_by.columns, dialect));
  }

  // HAVING
  if (ir.having?.conditions?.length) {
    parts.push('HAVING ' + generateFilterGroup(ir.having, dialect));
  }

  // ORDER BY
  if (ir.order_by?.length) {
    const orderParts = ir.order_by.map(col => {
      const expr = generateOrderByExpression(col, dialect);
      const dir = col.direction === 'DESC' ? ' DESC' : '';
      return `${expr}${dir}`;
    });
    parts.push('ORDER BY ' + orderParts.join(', '));
  }

  // LIMIT
  if (ir.limit != null) {
    parts.push(`LIMIT ${ir.limit}`);
  }

  // CTEs
  if (ir.ctes?.length) {
    const cteSqls = ir.ctes.map(c => `${c.name} AS (\n${c.raw_sql}\n)`);
    parts.unshift('WITH ' + cteSqls.join(',\n'));
  }

  return parts.join('\n');
}

function compoundIrToSql(ir: CompoundQueryIR, dialect: string): string {
  const querySqls = ir.queries.map(q =>
    queryIrToSql({ ...q, order_by: undefined, limit: undefined }, dialect),
  );

  const parts = [querySqls[0]];
  for (let i = 0; i < ir.operators.length; i++) {
    parts.push(ir.operators[i]);
    parts.push(querySqls[i + 1]);
  }

  let result = parts.join('\n');

  if (ir.order_by?.length) {
    const orderParts = ir.order_by.map(col => {
      const expr = generateOrderByExpression(col, dialect);
      const dir = col.direction === 'DESC' ? ' DESC' : '';
      return `${expr}${dir}`;
    });
    result += '\nORDER BY ' + orderParts.join(', ');
  }

  if (ir.limit != null) {
    result += `\nLIMIT ${ir.limit}`;
  }

  return result;
}

/**
 * Convert any IR (simple or compound) to SQL string.
 */
export function irToSqlLocal(ir: AnyQueryIR, dialect: string): string {
  if (isCompoundQueryIR(ir)) return compoundIrToSql(ir, dialect);
  return queryIrToSql(ir, dialect);
}
