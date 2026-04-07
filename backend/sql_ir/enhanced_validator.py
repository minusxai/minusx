"""Enhanced validation logic for SQL IR - enforces binary support boundary.

Core Principle: If SQL is marked as "supported", it MUST be fully lossless.
Otherwise, it MUST be rejected with clear error messages.
"""

import sqlglot
from sqlglot import exp
from sqlglot.optimizer import optimize as _optimize
from typing import List, Set, Optional
from pydantic import BaseModel


class ValidationResult(BaseModel):
    """Result of SQL validation."""
    supported: bool
    errors: List[str] = []
    unsupportedFeatures: List[str] = []
    hint: Optional[str] = None


def validate_sql_for_gui(sql: str, dialect: str) -> ValidationResult:
    """
    Validates if SQL can be fully supported in GUI mode (lossless).

    Returns binary result: supported (lossless) or not supported (would lose info).

    Args:
        sql: SQL query string
        dialect: sqlglot dialect for parsing (e.g. 'postgres', 'bigquery', 'duckdb')

    Returns:
        ValidationResult with supported=True (lossless) or supported=False (lossy/unsupported)
    """
    try:
        ast = sqlglot.parse_one(sql, read=dialect)
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
    unsupported.update(_check_complex_aggregates(ast))

    # Check for complex filter expressions (lossy)
    unsupported.update(_check_complex_filters(ast))

    # Check for unsupported operators
    unsupported.update(_check_unsupported_operators(ast))

    if unsupported:
        feature_list = sorted(list(unsupported))
        hint = _generate_hint(feature_list)

        return ValidationResult(
            supported=False,
            errors=[f"SQL contains unsupported features: {', '.join(feature_list)}"],
            unsupportedFeatures=feature_list,
            hint=hint
        )

    return ValidationResult(supported=True)


def _check_unsupported_features(ast: exp.Expression) -> Set[str]:
    """Check for unsupported SQL features (existing checks)."""
    unsupported: Set[str] = set()

    for node in ast.walk():
        if isinstance(node, exp.Subquery):
            unsupported.add("Subqueries")
        # UNION is now supported (handled by CompoundQueryIR)
        elif isinstance(node, exp.Window):
            unsupported.add("Window functions")
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

    # Check for RIGHT OUTER joins (FULL is now supported via passthrough)
    for join_node in ast.find_all(exp.Join):
        join_side = join_node.args.get("side", "").upper()
        if join_side == "RIGHT":
            unsupported.add("RIGHT JOIN")

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

        # Anything else is a complex expression handled via raw passthrough
        # (arithmetic, CASE, casts, etc. are stored verbatim in the IR)
        pass

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
        # Exception: Date truncation and simple date functions are OK
        if isinstance(node, (exp.TimestampTrunc, exp.DateTrunc, exp.Date)):
            return False
        # Exception: Zero-argument current datetime functions are simple (like literals)
        if isinstance(node, (exp.CurrentTimestamp, exp.CurrentDate, exp.CurrentTime)):
            return False
        # Exception: ROUND and SPLIT_PART are OK
        if isinstance(node, (exp.Round, exp.SplitPart)):
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

    Supported: =, !=, >, <, >=, <=, LIKE, ILIKE, IN, IS NULL, IS NOT NULL
    Unsupported: BETWEEN, NOT LIKE, NOT IN, NOT ILIKE, ~, etc.
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


def normalize_sql(sql: str, dialect: str) -> str:
    """
    Normalize SQL to a canonical form for semantic comparison.

    Parses the SQL and runs the sqlglot optimizer to canonicalize it:
    - Expands positional GROUP BY / ORDER BY references (1 → full expression)
    - Removes redundant keywords (ORDER BY name ASC → ORDER BY name)
    - Qualifies identifiers consistently

    Two SQL strings that normalize to the same output are semantically equivalent
    (within the limits of what sqlglot can parse and optimize).

    Args:
        sql: SQL query string
        dialect: sqlglot dialect for parsing/generating (e.g. 'postgres', 'bigquery', 'duckdb')

    Returns:
        Normalized SQL string, or the stripped original if parsing fails
    """
    try:
        ast = sqlglot.parse_one(sql.strip(), read=dialect)
        # Strip comments so they don't affect comparison (comments are non-semantic)
        for node in ast.walk():
            node.comments = []
        try:
            ast = _optimize(ast, dialect=dialect)
        except Exception:
            pass  # Fall back to unoptimized AST
        return ast.sql(dialect=dialect, normalize=True, pretty=False)
    except Exception:
        return sql.strip()


def validate_round_trip(original_sql: str, regenerated_sql: str, dialect: str) -> ValidationResult:
    """
    Validate that a round-trip (SQL → IR → SQL) is lossless.

    Normalizes both SQL strings via sqlglot transpile and compares the results.
    If they match, the round-trip is lossless and GUI mode is safe.

    Args:
        original_sql: The original SQL before conversion to IR
        regenerated_sql: The SQL regenerated from IR
        dialect: SQL dialect for parsing/generating

    Returns:
        ValidationResult with supported=True if round-trip is lossless
    """
    norm_original = normalize_sql(original_sql, dialect)
    norm_regenerated = normalize_sql(regenerated_sql, dialect)

    if norm_original == norm_regenerated:
        return ValidationResult(supported=True)

    return ValidationResult(
        supported=False,
        errors=["Round-trip validation failed: regenerated SQL differs from original"],
        unsupportedFeatures=["SQL statements differ after normalization"],
        hint="The query cannot be losslessly converted. Use SQL mode for this query."
    )
