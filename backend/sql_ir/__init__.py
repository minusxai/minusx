"""SQL Intermediate Representation (IR) module for GUI query builder."""

from .ir_types import (
    QueryIR,
    CompoundQueryIR,
    SelectColumn,
    TableReference,
    JoinClause,
    JoinCondition,
    FilterGroup,
    FilterCondition,
    GroupByClause,
    OrderByClause,
)
from .parser import parse_sql_to_ir, UnsupportedSQLError
from .generator import ir_to_sql, compound_ir_to_sql, any_ir_to_sql
from .enhanced_validator import (
    validate_sql_for_gui,
    normalize_sql,
    validate_round_trip,
    ValidationResult,
)

__all__ = [
    "QueryIR",
    "CompoundQueryIR",
    "SelectColumn",
    "TableReference",
    "JoinClause",
    "JoinCondition",
    "FilterGroup",
    "FilterCondition",
    "GroupByClause",
    "OrderByClause",
    "parse_sql_to_ir",
    "ir_to_sql",
    "compound_ir_to_sql",
    "any_ir_to_sql",
    "UnsupportedSQLError",
    "validate_sql_for_gui",
    "normalize_sql",
    "validate_round_trip",
    "ValidationResult",
]
