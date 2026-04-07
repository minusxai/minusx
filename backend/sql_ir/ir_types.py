"""Pydantic models for SQL Intermediate Representation (IR)."""

from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal, Union


class SelectColumn(BaseModel):
    """Represents a column in the SELECT clause."""
    type: Literal['column', 'aggregate', 'expression', 'raw']
    column: Optional[str] = None  # None for COUNT(*), required for regular columns
    table: Optional[str] = None
    aggregate: Optional[Literal['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT']] = None
    alias: Optional[str] = None
    # Expression fields (for type='expression')
    function: Optional[Literal['DATE_TRUNC', 'DATE', 'SPLIT_PART']] = None
    unit: Optional[Literal['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'HOUR', 'MINUTE']] = None
    function_args: Optional[List[Union[str, int, float]]] = None  # extra args (e.g. delimiter + index for SPLIT_PART)
    # Wrapper function applied around an aggregate (e.g. ROUND(SUM(col), 2))
    wrapper_function: Optional[Literal['ROUND']] = None
    wrapper_args: Optional[List[Union[int, float]]] = None
    # Raw SQL passthrough for complex expressions (CASE, arithmetic, COALESCE, etc.)
    raw_sql: Optional[str] = None

    @property
    def model_validator(self):
        """Validate column constraints."""
        # For aggregate COUNT with column=None, this is COUNT(*)
        if self.type == 'aggregate' and self.aggregate == 'COUNT' and self.column is None:
            return self  # Valid COUNT(*)
        # For non-aggregate columns, column must be present
        if self.type == 'column' and self.column is None:
            raise ValueError('column is required for non-aggregate SELECT columns')
        # For expression type, function and column must be present
        if self.type == 'expression' and (self.function is None or self.column is None):
            raise ValueError('function and column are required for expression SELECT columns')
        return self


class TableReference(BaseModel):
    """Represents a table reference in FROM or JOIN clauses."""
    model_config = ConfigDict(protected_namespaces=())

    table: str
    schema: Optional[str] = None
    alias: Optional[str] = None


class JoinCondition(BaseModel):
    """Represents an ON condition in a JOIN clause."""
    left_table: str
    left_column: str
    right_table: str
    right_column: str


class JoinClause(BaseModel):
    """Represents a JOIN clause."""
    type: Literal['INNER', 'LEFT', 'FULL']
    table: TableReference
    on: Optional[List[JoinCondition]] = None
    raw_on_sql: Optional[str] = None  # verbatim ON SQL for complex conditions


class FilterCondition(BaseModel):
    """Represents a single filter condition (WHERE or HAVING)."""
    column: Optional[str] = None  # None for COUNT(*) in HAVING clauses
    table: Optional[str] = None
    aggregate: Optional[Literal['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT']] = None
    operator: Literal['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL']
    value: Optional[Union[bool, str, int, float, List[str]]] = None  # bool must come before int to prevent coercion
    param_name: Optional[str] = None  # If value is :paramName
    # Expression fields (for DATE_TRUNC on the left/column side of a filter)
    function: Optional[Literal['DATE_TRUNC']] = None
    unit: Optional[Literal['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'HOUR', 'MINUTE']] = None
    # For verbatim SQL expressions on the right side (e.g. CURRENT_TIMESTAMP, TIMESTAMP_TRUNC(...))
    raw_value: Optional[str] = None
    # For verbatim SQL on the left/column side (e.g. SPLIT_PART(col, '-', 1))
    raw_column: Optional[str] = None


class FilterGroup(BaseModel):
    """Represents a group of filter conditions with AND/OR operator."""
    operator: Literal['AND', 'OR']
    conditions: List[Union[FilterCondition, 'FilterGroup']]


class GroupByItem(BaseModel):
    """Represents a single item in GROUP BY clause."""
    type: Literal['column', 'expression'] = 'column'
    column: str
    table: Optional[str] = None
    # Expression fields (for type='expression')
    function: Optional[Literal['DATE_TRUNC', 'DATE', 'SPLIT_PART']] = None
    unit: Optional[Literal['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'HOUR', 'MINUTE']] = None
    function_args: Optional[List[Union[str, int, float]]] = None


class GroupByClause(BaseModel):
    """Represents a GROUP BY clause."""
    columns: List[GroupByItem]


class OrderByClause(BaseModel):
    """Represents an ORDER BY clause."""
    type: Literal['column', 'expression', 'raw'] = 'column'
    column: Optional[str] = None
    table: Optional[str] = None
    direction: Literal['ASC', 'DESC'] = 'ASC'
    # Expression fields (for type='expression')
    function: Optional[Literal['DATE_TRUNC', 'DATE']] = None
    unit: Optional[Literal['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'HOUR', 'MINUTE']] = None
    # Raw SQL passthrough for complex ORDER BY expressions (e.g. CASE)
    raw_sql: Optional[str] = None


class CTE(BaseModel):
    """Represents a Common Table Expression (WITH clause)."""
    name: str
    raw_sql: str  # CTE body stored as verbatim SQL for lossless round-trip


class QueryIR(BaseModel):
    """Intermediate Representation of a SQL query for GUI builder."""
    model_config = ConfigDict(populate_by_name=True)

    type: Literal['simple'] = 'simple'  # Discriminator for simple vs compound
    version: int = 1  # Schema version for future migrations
    distinct: bool = False  # SELECT DISTINCT support
    ctes: Optional[List[CTE]] = None  # WITH clause CTEs
    select: List[SelectColumn]
    from_: TableReference = Field(..., alias='from')
    joins: Optional[List[JoinClause]] = None
    where: Optional[FilterGroup] = None
    group_by: Optional[GroupByClause] = None
    having: Optional[FilterGroup] = None
    order_by: Optional[List[OrderByClause]] = None
    limit: Optional[int] = None


class CompoundQueryIR(BaseModel):
    """IR for compound queries (UNION, UNION ALL)."""
    model_config = ConfigDict(populate_by_name=True)

    type: Literal['compound'] = 'compound'
    version: int = 1
    queries: List[QueryIR]  # 2+ queries
    operators: List[Literal['UNION', 'UNION ALL']]  # len = len(queries) - 1
    order_by: Optional[List[OrderByClause]] = None  # Applies to final result
    limit: Optional[int] = None  # Applies to final result
