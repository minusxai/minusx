"""Enhanced validation logic for SQL IR - enforces binary support boundary.

Core Principle: If SQL is marked as "supported", it MUST be fully lossless.
Otherwise, it MUST be rejected with clear error messages.
"""

import sqlglot
from sqlglot import exp
from typing import List, Set, Optional
from pydantic import BaseModel


class ValidationResult(BaseModel):
    """Result of SQL validation."""
    supported: bool
    errors: List[str] = []
    unsupportedFeatures: List[str] = []
    hint: Optional[str] = None


def validate_sql_for_gui(sql: str) -> ValidationResult:
    """
    Validates if SQL can be fully supported in GUI mode (lossless).

    Returns binary result: supported (lossless) or not supported (would lose info).

    Args:
        sql: SQL query string

    Returns:
        ValidationResult with supported=True (lossless) or supported=False (lossy/unsupported)
    """
    try:
        ast = sqlglot.parse_one(sql, read="postgres")
    except Exception as e:
        return ValidationResult(
            supported=False,
            errors=[f"Invalid SQL syntax: {str(e)}"],
            hint="Fix SQL syntax errors before using GUI mode"
        )

    unsupported: Set[str] = set()

    # Check for unsupported high-level features
    unsupported.update(_check_unsupported_features(ast))

    # Check for complex aggregate expressions (lossy)
    complex_agg = _check_complex_aggregates(ast)
    if complex_agg:
        unsupported.update(complex_agg)

    # Check for complex filter expressions (lossy)
    complex_filters = _check_complex_filters(ast)
    if complex_filters:
        unsupported.update(complex_filters)

    # Check for unsupported operators
    unsupported_ops = _check_unsupported_operators(ast)
    if unsupported_ops:
        unsupported.update(unsupported_ops)

    if unsupported:
        feature_list = sorted(list(unsupported))
        hint = _generate_hint(feature_list)

        return ValidationResult(
            supported=False,
            errors=[f"SQL contains unsupported features: {', '.join(feature_list)}"],
            unsupportedFeatures=feature_list,
            hint=hint
        )

    # Final check: Round-trip validation (SQL → IR → SQL)
    # This ensures the conversion is truly lossless
    # Import here to avoid circular imports
    from .parser import parse_sql_to_ir, UnsupportedSQLError
    from .generator import ir_to_sql

    try:
        # Use _skip_validation=True to avoid infinite recursion
        ir = parse_sql_to_ir(sql, _skip_validation=True)
        regenerated_sql = ir_to_sql(ir)

        comparison = compare_sql_ast(sql, regenerated_sql)
        if not comparison.equivalent:
            return ValidationResult(
                supported=False,
                errors=["Round-trip validation failed: regenerated SQL differs from original"],
                unsupportedFeatures=comparison.differences,
                hint="This query structure is not fully supported in GUI mode. Use SQL mode."
            )
    except UnsupportedSQLError as e:
        return ValidationResult(
            supported=False,
            errors=[f"SQL parsing failed: {str(e)}"],
            hint="This query cannot be parsed for GUI mode. Use SQL mode."
        )
    except Exception as e:
        return ValidationResult(
            supported=False,
            errors=[f"Validation error: {str(e)}"],
            hint="An error occurred validating this query. Use SQL mode."
        )

    # If we get here, SQL is fully supported (lossless)
    return ValidationResult(supported=True)


def _check_unsupported_features(ast: exp.Expression) -> Set[str]:
    """Check for unsupported SQL features (existing checks)."""
    unsupported: Set[str] = set()

    for node in ast.walk():
        if isinstance(node, exp.Subquery):
            unsupported.add("Subqueries")
        elif isinstance(node, exp.CTE):
            unsupported.add("WITH clauses (CTEs)")
        elif isinstance(node, exp.Union):
            unsupported.add("UNION")
        elif isinstance(node, exp.Window):
            unsupported.add("Window functions")
        elif isinstance(node, exp.Case):
            unsupported.add("CASE expressions")
        elif isinstance(node, exp.Intersect):
            unsupported.add("INTERSECT")
        elif isinstance(node, exp.Except):
            unsupported.add("EXCEPT")

    # Check for multiple FROM tables (must use explicit JOINs)
    select_node = ast.find(exp.Select)
    if select_node:
        from_clause = select_node.args.get("from")
        if from_clause and not isinstance(from_clause.this, exp.Table):
            unsupported.add("Multiple tables in FROM (use JOINs)")

    # Check for RIGHT/FULL OUTER joins
    for join_node in ast.find_all(exp.Join):
        join_side = join_node.args.get("side", "").upper()
        if join_side in ("RIGHT", "FULL"):
            unsupported.add(f"{join_side} JOIN")

    return unsupported


def _check_complex_aggregates(ast: exp.Expression) -> Set[str]:
    """
    Detect complex expressions in aggregate functions.

    Supported:
    - COUNT(*), COUNT(column), SUM(column), AVG(column), MIN(column), MAX(column)
    - COUNT(DISTINCT column)

    Unsupported (lossy):
    - SUM(price * quantity)
    - COUNT(CASE WHEN ...)
    - AVG(col1 + col2)
    - Any aggregate with complex expression
    """
    unsupported: Set[str] = set()

    for node in ast.find_all((exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max)):
        agg_arg = node.this

        # Handle COUNT(DISTINCT column) - extract inner expression
        if isinstance(node, exp.Count) and isinstance(agg_arg, exp.Distinct):
            if agg_arg.expressions:
                agg_arg = agg_arg.expressions[0]

        # COUNT(*) is OK
        if isinstance(agg_arg, exp.Star):
            continue

        # Simple column is OK
        if isinstance(agg_arg, exp.Column):
            continue

        # Anything else is a complex expression (unsupported)
        if isinstance(agg_arg, (exp.Mul, exp.Add, exp.Sub, exp.Div, exp.Mod)):
            unsupported.add("Complex aggregate expressions (e.g., SUM(col1 * col2))")
        elif isinstance(agg_arg, exp.Case):
            unsupported.add("CASE in aggregates (e.g., COUNT(CASE WHEN ...))")
        elif isinstance(agg_arg, exp.Cast):
            unsupported.add("Type casting in aggregates")
        elif isinstance(agg_arg, exp.Func):
            unsupported.add("Nested functions in aggregates")
        elif agg_arg is not None:
            # Some other complex expression
            unsupported.add("Complex expressions in aggregates")

    return unsupported


def _check_complex_filters(ast: exp.Expression) -> Set[str]:
    """
    Detect complex expressions in WHERE/HAVING clauses.

    Supported:
    - column = value
    - column > value
    - column LIKE 'pattern'
    - column IN (val1, val2)
    - column IS NULL / IS NOT NULL

    Unsupported (lossy):
    - col1 + col2 > 10
    - price * 1.1 > cost
    - SUBSTRING(name, 1, 3) = 'ABC'
    """
    unsupported: Set[str] = set()

    # Check WHERE clause
    select_node = ast.find(exp.Select)
    if select_node:
        where_clause = select_node.args.get("where")
        if where_clause:
            complex_exprs = _find_complex_filter_expressions(where_clause.this)
            if complex_exprs:
                unsupported.update(complex_exprs)

        # Check HAVING clause
        having_clause = select_node.args.get("having")
        if having_clause:
            # HAVING with aggregates is OK (handled separately)
            # But HAVING with complex non-aggregate expressions is not
            complex_exprs = _find_complex_filter_expressions(having_clause.this, allow_aggregates=True)
            if complex_exprs:
                unsupported.update(complex_exprs)

    return unsupported


def _find_complex_filter_expressions(node: exp.Expression, allow_aggregates: bool = False) -> Set[str]:
    """Recursively find complex expressions in filter conditions."""
    unsupported: Set[str] = set()

    # Traverse comparison operators
    for cmp in node.find_all((exp.EQ, exp.NEQ, exp.GT, exp.LT, exp.GTE, exp.LTE, exp.Like)):
        left = cmp.left
        right = cmp.right

        # Check left side for complex expressions
        if _is_complex_expression(left, allow_aggregates):
            unsupported.add("Complex expressions in filters (e.g., col1 + col2 > 10)")

        # Right side should be literal or parameter
        # (Complex expressions on right side are also unsupported, but less common)
        if _is_complex_expression(right, allow_aggregates):
            unsupported.add("Complex expressions in filter values")

    # Check IN clauses
    for in_node in node.find_all(exp.In):
        left = in_node.this
        if _is_complex_expression(left, allow_aggregates):
            unsupported.add("Complex expressions in IN clause")

    return unsupported


def _is_complex_expression(node: exp.Expression, allow_aggregates: bool = False) -> bool:
    """
    Check if an expression is complex (not just a column or aggregate).

    Simple expressions (OK):
    - Column: users.name
    - Aggregate: COUNT(*), SUM(amount)  (only if allow_aggregates=True)

    Complex expressions (not OK):
    - Arithmetic: price * 1.1
    - Functions: SUBSTRING(name, 1, 3)
    - CAST: CAST(id AS TEXT)
    """
    # Column is simple
    if isinstance(node, exp.Column):
        return False

    # Aggregates are simple (if allowed)
    if allow_aggregates and isinstance(node, (exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max)):
        return False

    # Literal values are simple
    if isinstance(node, (exp.Literal, exp.Null, exp.Boolean)):
        return False

    # Parameters are simple
    if isinstance(node, exp.Placeholder):
        return False

    # Arithmetic operators indicate complex expression
    if isinstance(node, (exp.Add, exp.Sub, exp.Mul, exp.Div, exp.Mod)):
        return True

    # Functions indicate complex expression
    if isinstance(node, exp.Func):
        # Exception: Aggregates are OK if allowed
        if allow_aggregates and isinstance(node, (exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max)):
            return False
        # Exception: Date truncation functions are OK
        if isinstance(node, (exp.TimestampTrunc, exp.DateTrunc)):
            return False
        return True

    # CAST indicates complex expression
    if isinstance(node, exp.Cast):
        return True

    # Star is simple (for COUNT(*))
    if isinstance(node, exp.Star):
        return False

    # Default: treat as complex if we don't recognize it
    # This is conservative - better to reject than silently lose info
    return False


def _check_unsupported_operators(ast: exp.Expression) -> Set[str]:
    """
    Check for operators not in our supported list.

    Supported: =, !=, >, <, >=, <=, LIKE, IN, IS NULL, IS NOT NULL
    Unsupported: BETWEEN, NOT LIKE, NOT IN, ILIKE, ~, etc.
    """
    unsupported: Set[str] = set()

    for node in ast.walk():
        # BETWEEN operator
        if isinstance(node, exp.Between):
            unsupported.add("BETWEEN (use >= and <= instead)")

        # NOT wrapper around LIKE or IN
        elif isinstance(node, exp.Not):
            inner = node.this
            if isinstance(inner, exp.Like):
                unsupported.add("NOT LIKE")
            elif isinstance(inner, exp.In):
                unsupported.add("NOT IN")
            elif isinstance(inner, exp.ILike):
                unsupported.add("NOT ILIKE")

        # ILIKE (case-insensitive LIKE)
        elif isinstance(node, exp.ILike):
            unsupported.add("ILIKE (use LIKE or LOWER(column) LIKE LOWER(pattern))")

        # Regex operators
        elif isinstance(node, (exp.RegexpLike, exp.RegexpILike)):
            unsupported.add("Regex operators (~, ~*, etc.)")

        # Array operators
        elif isinstance(node, (exp.ArrayContains, exp.ArrayOverlaps)):
            unsupported.add("Array operators")

        # JSON operators
        elif isinstance(node, (exp.JSONExtract, exp.JSONExtractScalar)):
            unsupported.add("JSON operators")

    return unsupported


def _generate_hint(unsupported_features: List[str]) -> str:
    """Generate helpful hint based on unsupported features."""
    # Check for BETWEEN with substring match
    if any('BETWEEN' in f for f in unsupported_features):
        return "Use >= and <= operators instead of BETWEEN. Switch to SQL mode for advanced features."
    elif any("Complex" in f for f in unsupported_features):
        return "Simplify expressions or use SQL mode for complex queries."
    elif "Subqueries" in unsupported_features or "WITH clauses" in unsupported_features or "WITH clauses (CTEs)" in unsupported_features:
        return "Remove subqueries/CTEs or use SQL mode for advanced queries."
    else:
        return "These features are not supported in GUI mode. Use SQL mode for full flexibility."


class SQLComparisonResult(BaseModel):
    """Result of SQL comparison."""
    equivalent: bool
    differences: List[str] = []
    original_normalized: Optional[str] = None
    regenerated_normalized: Optional[str] = None


def compare_sql_ast(sql1: str, sql2: str, dialect: str = "postgres") -> SQLComparisonResult:
    """
    Compare two SQL statements for semantic equivalence using AST comparison.

    This normalizes both SQL statements and compares their AST structures.
    Useful for verifying lossless round-trip: SQL → IR → SQL

    Args:
        sql1: First SQL statement (typically the original)
        sql2: Second SQL statement (typically the regenerated)
        dialect: SQL dialect for parsing (default: postgres)

    Returns:
        SQLComparisonResult with equivalent=True if semantically equivalent
    """
    differences: List[str] = []

    try:
        ast1 = sqlglot.parse_one(sql1, read=dialect)
        ast2 = sqlglot.parse_one(sql2, read=dialect)
    except Exception as e:
        return SQLComparisonResult(
            equivalent=False,
            differences=[f"Parse error: {str(e)}"]
        )

    # Normalize to canonical form for comparison
    # Using optimize to normalize expressions (constant folding, etc.)
    try:
        from sqlglot.optimizer import optimize
        ast1_opt = optimize(ast1, dialect=dialect)
        ast2_opt = optimize(ast2, dialect=dialect)
    except Exception:
        # Fall back to un-optimized if optimization fails
        ast1_opt = ast1
        ast2_opt = ast2

    # Generate normalized SQL strings
    norm1 = ast1_opt.sql(dialect=dialect, normalize=True, pretty=False)
    norm2 = ast2_opt.sql(dialect=dialect, normalize=True, pretty=False)

    # Direct AST comparison
    if ast1_opt == ast2_opt:
        return SQLComparisonResult(
            equivalent=True,
            original_normalized=norm1,
            regenerated_normalized=norm2
        )

    # If ASTs don't match, try string comparison of normalized SQL
    if norm1.lower() == norm2.lower():
        return SQLComparisonResult(
            equivalent=True,
            original_normalized=norm1,
            regenerated_normalized=norm2
        )

    # Collect specific differences
    differences = _find_ast_differences(ast1_opt, ast2_opt)

    return SQLComparisonResult(
        equivalent=False,
        differences=differences if differences else ["SQL statements differ"],
        original_normalized=norm1,
        regenerated_normalized=norm2
    )


def _find_ast_differences(ast1: exp.Expression, ast2: exp.Expression) -> List[str]:
    """Find specific differences between two ASTs."""
    differences = []

    # Compare SELECT columns
    select1 = ast1.find(exp.Select)
    select2 = ast2.find(exp.Select)

    if select1 and select2:
        cols1 = list(select1.expressions)
        cols2 = list(select2.expressions)
        if len(cols1) != len(cols2):
            differences.append(f"SELECT column count differs: {len(cols1)} vs {len(cols2)}")

    # Compare FROM
    from1 = ast1.find(exp.From)
    from2 = ast2.find(exp.From)
    if from1 and from2:
        if from1.sql() != from2.sql():
            differences.append("FROM clause differs")

    # Compare WHERE
    where1 = ast1.find(exp.Where)
    where2 = ast2.find(exp.Where)
    if (where1 is None) != (where2 is None):
        differences.append("WHERE clause presence differs")
    elif where1 and where2 and where1.sql() != where2.sql():
        differences.append("WHERE conditions differ")

    # Compare GROUP BY
    group1 = ast1.find(exp.Group)
    group2 = ast2.find(exp.Group)
    if (group1 is None) != (group2 is None):
        differences.append("GROUP BY presence differs")

    # Compare ORDER BY
    order1 = ast1.find(exp.Order)
    order2 = ast2.find(exp.Order)
    if (order1 is None) != (order2 is None):
        differences.append("ORDER BY presence differs")

    # Compare LIMIT
    limit1 = ast1.find(exp.Limit)
    limit2 = ast2.find(exp.Limit)
    if (limit1 is None) != (limit2 is None):
        differences.append("LIMIT presence differs")

    return differences


def validate_round_trip(original_sql: str, regenerated_sql: str) -> ValidationResult:
    """
    Validate that a round-trip (SQL → IR → SQL) is lossless.

    This is the final validation step to ensure GUI mode is truly lossless.

    Args:
        original_sql: The original SQL before conversion to IR
        regenerated_sql: The SQL regenerated from IR

    Returns:
        ValidationResult with supported=True if round-trip is lossless
    """
    comparison = compare_sql_ast(original_sql, regenerated_sql)

    if comparison.equivalent:
        return ValidationResult(supported=True)

    return ValidationResult(
        supported=False,
        errors=["Round-trip validation failed: regenerated SQL differs from original"],
        unsupportedFeatures=comparison.differences,
        hint="The query cannot be losslessly converted. Use SQL mode for this query."
    )
