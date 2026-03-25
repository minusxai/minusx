/**
 * TypeScript interfaces for SQL Intermediate Representation (IR)
 * Matches backend Pydantic models in backend/sql_ir/ir_types.py
 */

export interface SelectColumn {
  type: 'column' | 'aggregate' | 'expression' | 'raw';
  column?: string | null;  // null for COUNT(*); undefined for type='raw'
  table?: string;
  aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';
  alias?: string;
  // Expression fields (for type='expression')
  function?: 'DATE_TRUNC' | 'DATE' | 'SPLIT_PART';
  unit?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'HOUR' | 'MINUTE';
  function_args?: (string | number)[];  // e.g. delimiter + index for SPLIT_PART
  // Wrapper function applied around an aggregate (e.g. ROUND(SUM(col), 2))
  wrapper_function?: 'ROUND';
  wrapper_args?: number[];
  // Raw SQL passthrough for complex expressions (CASE, arithmetic, COALESCE, etc.)
  raw_sql?: string;
}

export interface TableReference {
  table: string;
  schema?: string;
  alias?: string;
}

export interface JoinCondition {
  left_table: string;
  left_column: string;
  right_table: string;
  right_column: string;
}

export interface JoinClause {
  type: 'INNER' | 'LEFT' | 'FULL';
  table: TableReference;
  on?: JoinCondition[];
  raw_on_sql?: string;  // verbatim ON SQL for complex (non-equi) conditions
}

export interface FilterCondition {
  column?: string | null;  // null for COUNT(*) in HAVING clauses
  table?: string;
  aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';
  value?: boolean | string | number | string[];
  param_name?: string;
  // For DATE_TRUNC on the left (column) side of a filter
  function?: 'DATE_TRUNC';
  unit?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'HOUR' | 'MINUTE';
  // For verbatim SQL expressions on the right side (e.g. CURRENT_TIMESTAMP)
  raw_value?: string;
}

export interface FilterGroup {
  operator: 'AND' | 'OR';
  conditions: (FilterCondition | FilterGroup)[];
}

export interface GroupByItem {
  type?: 'column' | 'expression';
  column: string;
  table?: string;
  // Expression fields (for type='expression')
  function?: 'DATE_TRUNC' | 'DATE' | 'SPLIT_PART';
  unit?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'HOUR' | 'MINUTE';
  function_args?: (string | number)[];
}

export interface GroupByClause {
  columns: GroupByItem[];
}

export interface OrderByClause {
  type?: 'column' | 'expression' | 'raw';
  column?: string;
  table?: string;
  direction: 'ASC' | 'DESC';
  // Expression fields (for type='expression')
  function?: 'DATE_TRUNC' | 'DATE';
  unit?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'HOUR' | 'MINUTE';
  // Raw SQL passthrough for complex ORDER BY expressions (e.g. CASE)
  raw_sql?: string;
}

export interface CTE {
  name: string;
  raw_sql: string;  // CTE body stored as verbatim SQL
}

export interface QueryIR {
  version: number;
  distinct?: boolean;
  ctes?: CTE[];
  select: SelectColumn[];
  from: TableReference;
  joins?: JoinClause[];
  where?: FilterGroup;
  group_by?: GroupByClause;
  having?: FilterGroup;
  order_by?: OrderByClause[];
  limit?: number;
}
