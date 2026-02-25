"""SQL to IR parser using sqlglot."""

import sqlglot
from sqlglot import exp
from typing import List, Optional, Union
from .ir_types import (
    QueryIR,
    SelectColumn,
    TableReference,
    JoinClause,
    JoinCondition,
    FilterGroup,
    FilterCondition,
    GroupByClause,
    GroupByItem,
    OrderByClause,
)
from .validator import UnsupportedSQLError, validate_sql_features
from .enhanced_validator import validate_sql_for_gui


def parse_sql_to_ir(sql: str, _skip_validation: bool = False) -> QueryIR:
    """
    Parse SQL string into QueryIR representation.

    Args:
        sql: SQL query string
        _skip_validation: Internal flag to skip validation (used by round-trip check)

    Returns:
        QueryIR object

    Raises:
        UnsupportedSQLError: If SQL contains unsupported features (would lose information)
    """
    # Use enhanced validator for binary support boundary (unless skipping for round-trip)
    if not _skip_validation:
        validation = validate_sql_for_gui(sql)
        if not validation.supported:
            raise UnsupportedSQLError(
                validation.errors[0] if validation.errors else "SQL not supported",
                validation.unsupportedFeatures,
                hint=validation.hint
            )

    # Parse SQL
    try:
        ast = sqlglot.parse_one(sql, read="postgres")
    except Exception as e:
        raise UnsupportedSQLError(f"Failed to parse SQL: {str(e)}", ["PARSE_ERROR"])

    # Extract SELECT node
    select_node = ast if isinstance(ast, exp.Select) else ast.find(exp.Select)
    if not select_node:
        raise UnsupportedSQLError("No SELECT statement found", ["NO_SELECT"])

    # Check for SELECT DISTINCT
    distinct = False
    if hasattr(select_node, 'args') and select_node.args.get('distinct'):
        distinct = True

    # Parse each component
    select_columns = parse_select(select_node)
    from_table = parse_from(select_node)
    joins = parse_joins(select_node)
    where_clause = parse_where(select_node)
    group_by = parse_group_by(select_node)
    having = parse_having(select_node)
    order_by = parse_order_by(select_node)
    limit = parse_limit(select_node)

    return QueryIR(
        version=1,
        distinct=distinct,
        select=select_columns,
        **{"from": from_table},  # Use dict unpacking for 'from' keyword
        joins=joins,
        where=where_clause,
        group_by=group_by,
        having=having,
        order_by=order_by,
        limit=limit,
    )


def parse_select(select_node: exp.Select) -> List[SelectColumn]:
    """Parse SELECT clause into list of SelectColumn objects."""
    columns = []

    for expr in select_node.expressions:
        alias = expr.alias if hasattr(expr, 'alias') and expr.alias else None

        # Check if it's an aggregate function
        if isinstance(expr, (exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max)):
            agg_type = type(expr).__name__.upper()

            # Extract column from aggregate
            agg_column = expr.this

            # Handle COUNT(DISTINCT col) - DISTINCT wraps the column
            if isinstance(expr, exp.Count) and isinstance(agg_column, exp.Distinct):
                agg_type = 'COUNT_DISTINCT'
                # Distinct node has expressions list, not this
                if agg_column.expressions:
                    agg_column = agg_column.expressions[0]

            if isinstance(agg_column, exp.Star):
                # COUNT(*) - use None to distinguish from COUNT(column)
                col_name = None if isinstance(expr, exp.Count) else '*'
                table_name = None
            elif isinstance(agg_column, exp.Column):
                col_name = agg_column.name
                table_name = agg_column.table if hasattr(agg_column, 'table') and agg_column.table else None
            else:
                # Complex expression in aggregate - will be caught by validator
                col_name = agg_column.sql() if agg_column else None
                table_name = None

            columns.append(SelectColumn(
                type='aggregate',
                column=col_name,
                table=table_name,
                aggregate=agg_type,
                alias=alias,
            ))

        # Regular column
        elif isinstance(expr, exp.Column):
            columns.append(SelectColumn(
                type='column',
                column=expr.name,
                table=expr.table if hasattr(expr, 'table') and expr.table else None,
                alias=alias,
            ))

        # Star (SELECT *)
        elif isinstance(expr, exp.Star):
            table = expr.table if hasattr(expr, 'table') and expr.table else None
            columns.append(SelectColumn(
                type='column',
                column='*',
                table=table,
                alias=alias,
            ))

        # Alias node wrapping a column
        elif isinstance(expr, exp.Alias):
            actual_expr = expr.this
            if isinstance(actual_expr, (exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max)):
                agg_type = type(actual_expr).__name__.upper()

                agg_column = actual_expr.this

                # Handle COUNT(DISTINCT col)
                if isinstance(actual_expr, exp.Count) and isinstance(agg_column, exp.Distinct):
                    agg_type = 'COUNT_DISTINCT'
                    if agg_column.expressions:
                        agg_column = agg_column.expressions[0]

                if isinstance(agg_column, exp.Star):
                    # COUNT(*) - use None to distinguish from COUNT(column)
                    col_name = None if isinstance(actual_expr, exp.Count) else '*'
                    table_name = None
                elif isinstance(agg_column, exp.Column):
                    col_name = agg_column.name
                    table_name = agg_column.table if hasattr(agg_column, 'table') and agg_column.table else None
                else:
                    # Complex expression in aggregate - will be caught by validator
                    col_name = agg_column.sql() if agg_column else None
                    table_name = None

                columns.append(SelectColumn(
                    type='aggregate',
                    column=col_name,
                    table=table_name,
                    aggregate=agg_type,
                    alias=expr.alias,
                ))
            elif isinstance(actual_expr, exp.Column):
                columns.append(SelectColumn(
                    type='column',
                    column=actual_expr.name,
                    table=actual_expr.table if hasattr(actual_expr, 'table') and actual_expr.table else None,
                    alias=expr.alias,
                ))
            elif isinstance(actual_expr, exp.Star):
                columns.append(SelectColumn(
                    type='column',
                    column='*',
                    table=actual_expr.table if hasattr(actual_expr, 'table') and actual_expr.table else None,
                    alias=expr.alias,
                ))
            # Date truncation functions (DATE_TRUNC)
            elif isinstance(actual_expr, (exp.TimestampTrunc, exp.DateTrunc)):
                col = parse_date_trunc_expression(actual_expr)
                if col:
                    col.alias = expr.alias
                    columns.append(col)

        # Date truncation functions without alias
        elif isinstance(expr, (exp.TimestampTrunc, exp.DateTrunc)):
            col = parse_date_trunc_expression(expr)
            if col:
                columns.append(col)

    return columns


def parse_date_trunc_expression(expr: exp.Expression) -> Optional[SelectColumn]:
    """Parse DATE_TRUNC / TimestampTrunc expression into SelectColumn."""
    # Extract the column being truncated
    column_expr = expr.this
    if not isinstance(column_expr, exp.Column):
        return None

    # Extract the unit (e.g., 'WEEK', 'MONTH', 'DAY')
    unit_expr = expr.args.get('unit')
    if not unit_expr:
        return None

    # Unit can be a Var (e.g., Var(this=WEEK)) or a Literal
    if isinstance(unit_expr, exp.Var):
        unit = unit_expr.name.upper()
    elif isinstance(unit_expr, exp.Literal):
        unit = str(unit_expr.this).upper()
    else:
        unit = str(unit_expr).upper()

    # Normalize unit names
    unit_mapping = {
        'DAY': 'DAY',
        'WEEK': 'WEEK',
        'MONTH': 'MONTH',
        'QUARTER': 'QUARTER',
        'YEAR': 'YEAR',
        'HOUR': 'HOUR',
        'MINUTE': 'MINUTE',
    }

    normalized_unit = unit_mapping.get(unit)
    if not normalized_unit:
        return None

    return SelectColumn(
        type='expression',
        column=column_expr.name,
        table=column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None,
        function='DATE_TRUNC',
        unit=normalized_unit,
    )


def parse_from(select_node: exp.Select) -> TableReference:
    """Parse FROM clause into TableReference."""
    from_clause = select_node.args.get("from")
    if not from_clause:
        # Try alternative key name
        from_clause = select_node.find(exp.From)
        if not from_clause:
            raise UnsupportedSQLError("No FROM clause found", ["NO_FROM"])

    table_expr = from_clause.this
    if not isinstance(table_expr, exp.Table):
        raise UnsupportedSQLError("Complex FROM clause not supported", ["COMPLEX_FROM"])

    return TableReference(
        table=table_expr.name,
        schema=table_expr.db if hasattr(table_expr, 'db') and table_expr.db else None,
        alias=table_expr.alias if hasattr(table_expr, 'alias') and table_expr.alias else None,
    )


def parse_joins(select_node: exp.Select) -> Optional[List[JoinClause]]:
    """Parse JOIN clauses into list of JoinClause objects."""
    joins = []

    for join_node in select_node.find_all(exp.Join):
        # Get join type (stored in 'side' for LEFT/RIGHT/FULL, 'kind' for INNER)
        join_kind = join_node.args.get("kind", "").upper()
        join_side = join_node.args.get("side", "").upper()

        if join_side:
            join_kind = join_side  # LEFT, RIGHT, FULL
        elif not join_kind:
            join_kind = "INNER"  # Default to INNER

        if join_kind not in ("INNER", "LEFT"):
            continue  # Skip unsupported join types (caught by validator)

        # Get table
        table_expr = join_node.this
        if not isinstance(table_expr, exp.Table):
            continue

        table = TableReference(
            table=table_expr.name,
            schema=table_expr.db if hasattr(table_expr, 'db') and table_expr.db else None,
            alias=table_expr.alias if hasattr(table_expr, 'alias') and table_expr.alias else None,
        )

        # Parse ON conditions
        on_conditions = []
        on_clause = join_node.args.get("on")
        if on_clause:
            on_conditions = parse_join_conditions(on_clause)

        joins.append(JoinClause(
            type=join_kind,
            table=table,
            on=on_conditions,
        ))

    return joins if joins else None


def parse_join_conditions(on_expr: exp.Expression) -> List[JoinCondition]:
    """Parse ON clause into list of JoinCondition objects."""
    conditions = []

    # Handle AND of multiple conditions
    if isinstance(on_expr, exp.And):
        for condition in on_expr.flatten():
            if isinstance(condition, exp.EQ):
                left = condition.left
                right = condition.right

                if isinstance(left, exp.Column) and isinstance(right, exp.Column):
                    conditions.append(JoinCondition(
                        left_table=left.table if hasattr(left, 'table') and left.table else "",
                        left_column=left.name,
                        right_table=right.table if hasattr(right, 'table') and right.table else "",
                        right_column=right.name,
                    ))

    # Single condition
    elif isinstance(on_expr, exp.EQ):
        left = on_expr.left
        right = on_expr.right

        if isinstance(left, exp.Column) and isinstance(right, exp.Column):
            conditions.append(JoinCondition(
                left_table=left.table if hasattr(left, 'table') and left.table else "",
                left_column=left.name,
                right_table=right.table if hasattr(right, 'table') and right.table else "",
                right_column=right.name,
            ))

    return conditions


def parse_where(select_node: exp.Select) -> Optional[FilterGroup]:
    """Parse WHERE clause into FilterGroup."""
    where_clause = select_node.args.get("where")
    if not where_clause:
        return None

    return parse_filter_expression(where_clause.this)


def parse_having(select_node: exp.Select) -> Optional[FilterGroup]:
    """Parse HAVING clause into FilterGroup."""
    having_clause = select_node.args.get("having")
    if not having_clause:
        return None

    return parse_filter_expression(having_clause.this)


def parse_filter_expression(expr: exp.Expression) -> Union[FilterGroup, FilterCondition]:
    """Parse filter expression into FilterGroup or FilterCondition."""
    # Handle AND/OR groups
    if isinstance(expr, exp.And):
        conditions = []
        for child in expr.flatten():
            if isinstance(child, (exp.And, exp.Or)):
                conditions.append(parse_filter_expression(child))
            else:
                condition = parse_single_condition(child)
                if condition:
                    conditions.append(condition)
        return FilterGroup(operator='AND', conditions=conditions)

    elif isinstance(expr, exp.Or):
        conditions = []
        for child in expr.flatten():
            if isinstance(child, (exp.And, exp.Or)):
                conditions.append(parse_filter_expression(child))
            else:
                condition = parse_single_condition(child)
                if condition:
                    conditions.append(condition)
        return FilterGroup(operator='OR', conditions=conditions)

    # Single condition
    else:
        condition = parse_single_condition(expr)
        if condition:
            # Wrap in AND group for consistency
            return FilterGroup(operator='AND', conditions=[condition])
        return FilterGroup(operator='AND', conditions=[])


def parse_single_condition(expr: exp.Expression) -> Optional[FilterCondition]:
    """Parse a single filter condition."""
    # Handle NOT wrapper (for IS NOT NULL)
    if isinstance(expr, exp.Not):
        inner = expr.this
        if isinstance(inner, exp.Is):
            # IS NOT NULL
            column_expr = inner.this
            if isinstance(column_expr, exp.Column):
                return FilterCondition(
                    column=column_expr.name,
                    table=column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None,
                    operator='IS NOT NULL',
                )

    # Comparison operators
    if isinstance(expr, exp.EQ):
        return parse_comparison(expr, '=')
    elif isinstance(expr, exp.NEQ):
        return parse_comparison(expr, '!=')
    elif isinstance(expr, exp.GT):
        return parse_comparison(expr, '>')
    elif isinstance(expr, exp.LT):
        return parse_comparison(expr, '<')
    elif isinstance(expr, exp.GTE):
        return parse_comparison(expr, '>=')
    elif isinstance(expr, exp.LTE):
        return parse_comparison(expr, '<=')
    elif isinstance(expr, exp.Like):
        return parse_comparison(expr, 'LIKE')
    elif isinstance(expr, exp.In):
        return parse_in_condition(expr)
    elif isinstance(expr, exp.Is):
        return parse_is_null(expr)

    return None


def parse_comparison(expr: exp.Expression, operator: str) -> Optional[FilterCondition]:
    """Parse comparison expression into FilterCondition."""
    left = expr.left
    right = expr.right

    # Check if left side is an aggregate function (for HAVING clauses)
    aggregate = None
    column_expr = left

    if isinstance(left, exp.Count):
        aggregate = 'COUNT_DISTINCT' if left.args.get('distinct') else 'COUNT'
        # Extract column from COUNT(column) or use None for COUNT(*)
        agg_column = left.this
        if isinstance(agg_column, exp.Star):
            # COUNT(*) in HAVING clause - special handling
            column_expr = None  # Will be handled specially below
        elif isinstance(agg_column, exp.Distinct):
            # COUNT(DISTINCT column)
            column_expr = agg_column.expressions[0] if agg_column.expressions else agg_column
        else:
            column_expr = agg_column
    elif isinstance(left, exp.Sum):
        aggregate = 'SUM'
        column_expr = left.this
    elif isinstance(left, exp.Avg):
        aggregate = 'AVG'
        column_expr = left.this
    elif isinstance(left, exp.Min):
        aggregate = 'MIN'
        column_expr = left.this
    elif isinstance(left, exp.Max):
        aggregate = 'MAX'
        column_expr = left.this

    # Handle COUNT(*) special case
    if column_expr is None and aggregate == 'COUNT':
        column_name = None  # COUNT(*) uses None
        table_name = None
    # If it's not a column/star and not an aggregate, skip it
    elif not isinstance(column_expr, (exp.Column, exp.Star)):
        return None
    # Extract column name and table
    elif isinstance(column_expr, exp.Star):
        # For aggregates other than COUNT, * doesn't make sense
        column_name = None if aggregate == 'COUNT' else '*'
        table_name = None
    else:
        column_name = column_expr.name
        table_name = column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None

    # Extract value or parameter
    value = None
    param_name = None

    if isinstance(right, exp.Placeholder):
        # Parameter like :param_name
        param_name = right.name if hasattr(right, 'name') else right.this
    elif isinstance(right, exp.Boolean):
        # Boolean literal (TRUE/FALSE)
        value = right.this  # This is a Python bool (True/False)
    elif isinstance(right, exp.Literal):
        # Literal value
        value = right.this
        # Only try to parse as number for numeric literals (not quoted strings like '75')
        if not right.is_string:
            try:
                if '.' in str(value):
                    value = float(value)
                else:
                    value = int(value)
            except ValueError:
                pass  # Keep as string
    elif isinstance(right, exp.Null):
        # NULL literal
        value = None
    else:
        # Use sql() to get expression as string
        value = right.sql()

    return FilterCondition(
        column=column_name,
        table=table_name,
        aggregate=aggregate,
        operator=operator,
        value=value,
        param_name=param_name,
    )


def parse_in_condition(expr: exp.In) -> Optional[FilterCondition]:
    """Parse IN expression into FilterCondition."""
    column_expr = expr.this
    if not isinstance(column_expr, exp.Column):
        return None

    # Extract values from IN list
    values = []
    expressions = expr.expressions if hasattr(expr, 'expressions') else []

    for val_expr in expressions:
        if isinstance(val_expr, exp.Literal):
            values.append(val_expr.this)
        else:
            values.append(val_expr.sql())

    return FilterCondition(
        column=column_expr.name,
        table=column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None,
        operator='IN',
        value=values,
    )


def parse_is_null(expr: exp.Is) -> Optional[FilterCondition]:
    """Parse IS NULL / IS NOT NULL expression."""
    column_expr = expr.this
    if not isinstance(column_expr, exp.Column):
        return None

    # IS NULL check (expression is Null node)
    return FilterCondition(
        column=column_expr.name,
        table=column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None,
        operator='IS NULL',
    )


def parse_group_by(select_node: exp.Select) -> Optional[GroupByClause]:
    """Parse GROUP BY clause into GroupByClause."""
    group_clause = select_node.args.get("group")
    if not group_clause:
        return None

    columns = []
    for expr in group_clause.expressions:
        if isinstance(expr, exp.Column):
            columns.append(GroupByItem(
                type='column',
                column=expr.name,
                table=expr.table if hasattr(expr, 'table') and expr.table else None,
            ))
        elif isinstance(expr, (exp.TimestampTrunc, exp.DateTrunc)):
            # DATE_TRUNC expression in GROUP BY
            item = parse_group_by_date_trunc(expr)
            if item:
                columns.append(item)

    return GroupByClause(columns=columns) if columns else None


def parse_group_by_date_trunc(expr: exp.Expression) -> Optional[GroupByItem]:
    """Parse DATE_TRUNC expression in GROUP BY clause."""
    # Extract the column being truncated
    column_expr = expr.this
    if not isinstance(column_expr, exp.Column):
        return None

    # Extract the unit
    unit_expr = expr.args.get('unit')
    if not unit_expr:
        return None

    if isinstance(unit_expr, exp.Var):
        unit = unit_expr.name.upper()
    elif isinstance(unit_expr, exp.Literal):
        unit = str(unit_expr.this).upper()
    else:
        unit = str(unit_expr).upper()

    # Normalize unit names
    unit_mapping = {
        'DAY': 'DAY',
        'WEEK': 'WEEK',
        'MONTH': 'MONTH',
        'QUARTER': 'QUARTER',
        'YEAR': 'YEAR',
        'HOUR': 'HOUR',
        'MINUTE': 'MINUTE',
    }

    normalized_unit = unit_mapping.get(unit)
    if not normalized_unit:
        return None

    return GroupByItem(
        type='expression',
        column=column_expr.name,
        table=column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None,
        function='DATE_TRUNC',
        unit=normalized_unit,
    )


def parse_order_by(select_node: exp.Select) -> Optional[List[OrderByClause]]:
    """Parse ORDER BY clause into list of OrderByClause objects."""
    order_clause = select_node.args.get("order")
    if not order_clause:
        return None

    order_by = []
    for ordered in order_clause.expressions:
        if isinstance(ordered, exp.Ordered):
            column_expr = ordered.this
            direction = 'DESC' if ordered.args.get('desc') else 'ASC'

            if isinstance(column_expr, exp.Column):
                order_by.append(OrderByClause(
                    type='column',
                    column=column_expr.name,
                    table=column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None,
                    direction=direction,
                ))
            elif isinstance(column_expr, (exp.TimestampTrunc, exp.DateTrunc)):
                # DATE_TRUNC expression in ORDER BY
                item = parse_order_by_date_trunc(column_expr, direction)
                if item:
                    order_by.append(item)

    return order_by if order_by else None


def parse_order_by_date_trunc(expr: exp.Expression, direction: str) -> Optional[OrderByClause]:
    """Parse DATE_TRUNC expression in ORDER BY clause."""
    # Extract the column being truncated
    column_expr = expr.this
    if not isinstance(column_expr, exp.Column):
        return None

    # Extract the unit
    unit_expr = expr.args.get('unit')
    if not unit_expr:
        return None

    if isinstance(unit_expr, exp.Var):
        unit = unit_expr.name.upper()
    elif isinstance(unit_expr, exp.Literal):
        unit = str(unit_expr.this).upper()
    else:
        unit = str(unit_expr).upper()

    # Normalize unit names
    unit_mapping = {
        'DAY': 'DAY',
        'WEEK': 'WEEK',
        'MONTH': 'MONTH',
        'QUARTER': 'QUARTER',
        'YEAR': 'YEAR',
        'HOUR': 'HOUR',
        'MINUTE': 'MINUTE',
    }

    normalized_unit = unit_mapping.get(unit)
    if not normalized_unit:
        return None

    return OrderByClause(
        type='expression',
        column=column_expr.name,
        table=column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None,
        direction=direction,
        function='DATE_TRUNC',
        unit=normalized_unit,
    )


def parse_limit(select_node: exp.Select) -> Optional[int]:
    """Parse LIMIT clause."""
    limit_clause = select_node.args.get("limit")
    if not limit_clause:
        return None

    limit_expr = limit_clause.expression if hasattr(limit_clause, 'expression') else limit_clause.this
    if isinstance(limit_expr, exp.Literal):
        try:
            return int(limit_expr.this)
        except ValueError:
            return None

    return None
