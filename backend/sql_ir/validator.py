"""Validation logic for SQL IR and AST feature detection."""

import sqlglot
from sqlglot import exp
from typing import List, Set
from .ir_types import QueryIR


class UnsupportedSQLError(Exception):
    """Raised when SQL contains features not supported by GUI builder."""
    def __init__(self, message: str, features: List[str], hint: str = None):
        super().__init__(message)
        self.features = features
        self.hint = hint


def validate_sql_features(sql: str) -> None:
    """
    Validate that SQL only uses features supported by the GUI builder.

    Raises UnsupportedSQLError if unsupported features are detected.
    """
    try:
        ast = sqlglot.parse_one(sql, read="postgres")
    except Exception as e:
        raise UnsupportedSQLError(f"Failed to parse SQL: {str(e)}", ["PARSE_ERROR"])

    unsupported_features: Set[str] = set()

    # Check for unsupported node types
    for node in ast.walk():
        if isinstance(node, exp.Subquery):
            unsupported_features.add("SUBQUERY")
        elif isinstance(node, exp.CTE):
            unsupported_features.add("CTE")
        elif isinstance(node, exp.Union):
            unsupported_features.add("UNION")
        elif isinstance(node, exp.Window):
            unsupported_features.add("WINDOW_FUNCTION")
        elif isinstance(node, exp.Case):
            unsupported_features.add("CASE")
        elif isinstance(node, exp.Intersect):
            unsupported_features.add("INTERSECT")
        elif isinstance(node, exp.Except):
            unsupported_features.add("EXCEPT")

    # Check for multiple FROM tables (must use explicit JOINs)
    select_node = ast.find(exp.Select)
    if select_node:
        from_clause = select_node.args.get("from")
        if from_clause:
            # Check for comma-separated tables in FROM clause
            if isinstance(from_clause.this, exp.Table):
                # Single table is fine
                pass
            else:
                # Multiple tables or complex expression
                unsupported_features.add("MULTIPLE_FROM_TABLES")

    # Check for RIGHT/FULL OUTER joins (not in V0 spec)
    for join_node in ast.find_all(exp.Join):
        join_kind = join_node.args.get("kind")
        if join_kind and join_kind.upper() not in ("INNER", "LEFT"):
            unsupported_features.add(f"{join_kind.upper()}_JOIN")

    if unsupported_features:
        feature_list = sorted(list(unsupported_features))
        raise UnsupportedSQLError(
            f"SQL contains unsupported features: {', '.join(feature_list)}",
            feature_list
        )


def validate_ir(ir: QueryIR) -> None:
    """
    Validate IR constraints (e.g., non-aggregate SELECT columns must be in GROUP BY).

    Raises ValueError if validation fails.
    """
    # If GROUP BY exists, validate SELECT columns
    if ir.group_by and ir.group_by.columns:
        grouped_columns = {
            (col.get('table'), col['column'])
            for col in ir.group_by.columns
        }

        for select_col in ir.select:
            # Skip aggregates
            if select_col.type == 'aggregate':
                continue

            # Skip COUNT(*) or similar
            if select_col.column == '*':
                continue

            # Check if column is in GROUP BY
            col_key = (select_col.table, select_col.column)
            if col_key not in grouped_columns:
                # Try without table qualifier
                col_key_no_table = (None, select_col.column)
                if col_key_no_table not in grouped_columns:
                    raise ValueError(
                        f"Column '{select_col.column}' in SELECT must be in GROUP BY or use an aggregate function"
                    )

    # Validate ORDER BY columns exist in SELECT (for simplicity)
    if ir.order_by:
        select_columns = {
            (col.table, col.alias or col.column)
            for col in ir.select
        }

        for order_col in ir.order_by:
            col_key = (order_col.table, order_col.column)
            if col_key not in select_columns:
                # Try without table qualifier
                col_key_no_table = (None, order_col.column)
                if col_key_no_table not in select_columns:
                    # This is a soft warning, not a hard error (SQL allows it)
                    pass

    # Validate HAVING only used with GROUP BY
    if ir.having and not ir.group_by:
        raise ValueError("HAVING clause requires GROUP BY")
