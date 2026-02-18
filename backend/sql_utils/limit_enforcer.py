"""Enforce row limits on SQL queries for safety and performance."""

from sqlglot import parse_one, exp
from sqlglot.errors import ParseError
from typing import Optional
import re


def enforce_query_limit(
    sql: str,
    default_limit: int = 1000,
    max_limit: int = 10000,
    dialect: str = "postgres"
) -> str:
    """
    Enforces row limits on SQL queries.

    - If no LIMIT exists: adds LIMIT default_limit
    - If LIMIT exists: caps it at max_limit
    - Handles the root query (SELECT, UNION, INTERSECT, EXCEPT)
    - Non-query statements (INSERT, UPDATE, DELETE, CREATE) are returned unmodified

    Args:
        sql: SQL query string
        default_limit: Default limit to add if none exists (default: 1000)
        max_limit: Maximum allowed limit (default: 10000)
        dialect: SQL dialect for parsing (default: "postgres")

    Returns:
        Modified SQL with enforced limit

    Examples:
        >>> enforce_query_limit("SELECT * FROM users")
        'SELECT * FROM users LIMIT 1000'

        >>> enforce_query_limit("SELECT * FROM users LIMIT 500")
        'SELECT * FROM users LIMIT 500'

        >>> enforce_query_limit("SELECT * FROM users LIMIT 50000", max_limit=10000)
        'SELECT * FROM users LIMIT 10000'
    """
    try:
        ast = parse_one(sql, read=dialect)

        # Find the root query expression (SELECT, UNION, INTERSECT, EXCEPT)
        root_query = _find_root_query(ast)
        if not root_query:
            # Not a query that supports LIMIT (e.g., INSERT, UPDATE, CREATE)
            return sql

        # Check for existing LIMIT
        limit_expr = root_query.args.get("limit")

        if limit_expr:
            # LIMIT exists - cap it at max_limit if needed
            current_limit = _extract_limit_value(limit_expr)
            if current_limit and current_limit > max_limit:
                root_query.set("limit", exp.Limit(expression=exp.Literal.number(max_limit)))
        else:
            # No LIMIT - add default
            root_query.set("limit", exp.Limit(expression=exp.Literal.number(default_limit)))

        # Convert back to SQL using the same dialect to preserve dialect-specific features
        modified_sql = ast.sql(dialect=dialect)

        # Fix parameter placeholders for SQLAlchemy compatibility
        # Some dialects use different parameter syntax than SQLAlchemy expects
        if dialect == 'duckdb':
            # DuckDB uses $param, but SQLAlchemy expects :param
            modified_sql = re.sub(r'\$(\w+)', r':\1', modified_sql)
        elif dialect == 'bigquery':
            # BigQuery uses @param, but SQLAlchemy expects :param
            modified_sql = re.sub(r'@(\w+)', r':\1', modified_sql)
        # PostgreSQL already uses :param, no conversion needed

        return modified_sql

    except ParseError:
        # If parsing fails, return original SQL unmodified
        # Better to potentially return too many rows than break the query
        return sql


def _find_root_query(ast: exp.Expression) -> Optional[exp.Expression]:
    """
    Find the root query expression that can have a LIMIT clause.

    Returns the outermost SELECT, UNION, INTERSECT, or EXCEPT expression.
    Returns None for non-query statements (INSERT, UPDATE, DELETE, CREATE, etc.)

    Args:
        ast: Parsed SQL AST from sqlglot

    Returns:
        Root query expression or None if not a SELECT-like query
    """
    if isinstance(ast, (exp.Select, exp.Union, exp.Intersect, exp.Except)):
        return ast
    return None


def _extract_limit_value(limit_expr: exp.Limit) -> Optional[int]:
    """
    Extract integer value from LIMIT expression.

    Args:
        limit_expr: LIMIT expression from sqlglot AST

    Returns:
        Integer limit value or None if cannot be extracted
    """
    if isinstance(limit_expr.expression, exp.Literal):
        try:
            return int(limit_expr.expression.this)
        except (ValueError, TypeError):
            return None
    return None
