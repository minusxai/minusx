/**
 * TypeScript interfaces for SQL Intermediate Representation (IR)
 * Matches backend Pydantic models in backend/sql_ir/ir_types.py
 */

export interface SelectColumn {
  type: 'column' | 'aggregate' | 'expression';
  column: string | null;  // null for COUNT(*), required for regular columns
  table?: string;
  aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';
  alias?: string;
  // Expression fields (for type='expression')
  function?: 'DATE_TRUNC';
  unit?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'HOUR' | 'MINUTE';
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
  type: 'INNER' | 'LEFT';
  table: TableReference;
  on: JoinCondition[];
}

export interface FilterCondition {
  column: string | null;  // null for COUNT(*) in HAVING clauses
  table?: string;
  aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';
  value?: string | number | string[];
  param_name?: string;
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
  function?: 'DATE_TRUNC';
  unit?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'HOUR' | 'MINUTE';
}

export interface GroupByClause {
  columns: GroupByItem[];
}

export interface OrderByClause {
  type?: 'column' | 'expression';
  column: string;
  table?: string;
  direction: 'ASC' | 'DESC';
  // Expression fields (for type='expression')
  function?: 'DATE_TRUNC';
  unit?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'HOUR' | 'MINUTE';
}

export interface QueryIR {
  version: number;
  distinct?: boolean;  // SELECT DISTINCT support
  select: SelectColumn[];
  from: TableReference;
  joins?: JoinClause[];
  where?: FilterGroup;
  group_by?: GroupByClause;
  having?: FilterGroup;
  order_by?: OrderByClause[];
  limit?: number;
}
