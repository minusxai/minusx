"""SQL Intermediate Representation (IR) module for GUI query builder."""

from .ir_types import (
    QueryIR,
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
from .validator import validate_ir, validate_sql_features
from .generator import ir_to_sql
from .enhanced_validator import (
    validate_sql_for_gui,
    compare_sql_ast,
    validate_round_trip,
    ValidationResult,
    SQLComparisonResult,
)

__all__ = [
    "QueryIR",
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
    "UnsupportedSQLError",
    "validate_ir",
    "validate_sql_features",
    "validate_sql_for_gui",
    "compare_sql_ast",
    "validate_round_trip",
    "ValidationResult",
    "SQLComparisonResult",
]
