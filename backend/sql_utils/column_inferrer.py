"""Infer output column names and types from a SQL query using sqlglot static analysis."""

from dataclasses import dataclass
from typing import List, Dict, Any, Optional

import sqlglot
from sqlglot import exp


@dataclass
class InferredColumn:
    name: str
    type: str


@dataclass
class InferColumnsResult:
    columns: List[InferredColumn]
    error: Optional[str] = None


def infer_columns(
    query: str,
    schema_data: List[Dict[str, Any]],
    dialect: str = "postgres",
) -> InferColumnsResult:
    """
    Infer output column names and types from a SQL query.
    Does not execute the query - uses static analysis only.
    Falls back to 'unknown' type for unresolvable expressions.
    """
    try:
        ast = sqlglot.parse_one(query, read=dialect)
    except Exception as e:
        return InferColumnsResult(columns=[], error=str(e))

    # Find the outermost SELECT statement
    select_stmt = ast
    if not isinstance(select_stmt, exp.Select):
        select_stmt = ast.find(exp.Select)

    if not select_stmt:
        return InferColumnsResult(columns=[], error="Could not find SELECT statement")

    columns: List[InferredColumn] = []
    for expr in select_stmt.expressions:
        # Determine column name
        if isinstance(expr, exp.Alias):
            col_name = expr.alias
            inner = expr.this
        elif isinstance(expr, exp.Column):
            col_name = expr.name
            inner = expr
        elif isinstance(expr, exp.Star):
            _expand_star(schema_data, columns)
            continue
        else:
            col_name = expr.sql(dialect=dialect)
            inner = expr

        col_type = _infer_type(inner, schema_data, dialect)
        columns.append(InferredColumn(name=col_name, type=col_type))

    return InferColumnsResult(columns=columns)


def _expand_star(
    schema_data: List[Dict[str, Any]],
    columns: List[InferredColumn],
) -> None:
    """Expand SELECT * using schema_data, or add a wildcard placeholder."""
    if schema_data:
        for schema_entry in schema_data:
            for schema_obj in schema_entry.get("schemas", []):
                for table_entry in schema_obj.get("tables", []):
                    for col in table_entry.get("columns", []):
                        columns.append(InferredColumn(
                            name=col.get("name", "?"),
                            type=col.get("type", "unknown"),
                        ))
    else:
        columns.append(InferredColumn(name="*", type="unknown"))


def _infer_type(
    inner: exp.Expression,
    schema_data: List[Dict[str, Any]],
    dialect: str,
) -> str:
    """Infer the type of a single expression via static analysis."""
    if isinstance(inner, exp.Cast):
        return inner.to.sql(dialect=dialect).lower()

    if isinstance(inner, (exp.Anonymous, exp.Func)):
        func_name = inner.sql_name().lower() if hasattr(inner, "sql_name") else ""
        if any(x in func_name for x in ("count", "sum", "avg", "min", "max")):
            return "number"
        if any(x in func_name for x in ("date", "timestamp", "now", "current")):
            return "timestamp"
        if any(x in func_name for x in ("concat", "lower", "upper", "trim", "substr")):
            return "text"

    if isinstance(inner, exp.Literal):
        return "number" if inner.is_number else "text"

    if isinstance(inner, exp.Column):
        return _lookup_column_type(inner.name, inner.table or None, schema_data)

    return "unknown"


def _lookup_column_type(
    col_name: str,
    table_ref: Optional[str],
    schema_data: List[Dict[str, Any]],
) -> str:
    """Look up a column's type from schema_data."""
    for schema_entry in schema_data:
        for schema_obj in schema_entry.get("schemas", []):
            for table_entry in schema_obj.get("tables", []):
                if table_ref and table_entry.get("table") != table_ref:
                    continue
                for col in table_entry.get("columns", []):
                    if col.get("name") == col_name:
                        return col.get("type", "unknown")
    return "unknown"
