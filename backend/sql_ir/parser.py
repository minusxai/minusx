"""SQL to IR parser using sqlglot."""

import sqlglot
from sqlglot import exp
from typing import List, Optional, Union
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
    GroupByItem,
    OrderByClause,
    CTE,
)
from .validator import UnsupportedSQLError
from .enhanced_validator import validate_sql_for_gui, compare_sql_ast
from .generator import ir_to_sql, compound_ir_to_sql


def parse_sql_to_ir(sql: str, _skip_validation: bool = False) -> Union[QueryIR, CompoundQueryIR]:
    """
    Parse SQL string into QueryIR or CompoundQueryIR representation.

    Args:
        sql: SQL query string
        _skip_validation: Internal flag to skip validation (used by round-trip check)

    Returns:
        QueryIR for simple queries, CompoundQueryIR for UNION/UNION ALL queries

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

    # Check if this is a compound query (UNION / UNION ALL)
    if isinstance(ast, exp.Union):
        return _parse_compound_query(ast, sql, _skip_validation)

    # Simple query path
    return _parse_simple_query(ast, sql, _skip_validation)


def _parse_compound_query(ast: exp.Union, original_sql: str, _skip_validation: bool) -> CompoundQueryIR:
    """Parse a UNION/UNION ALL compound query into CompoundQueryIR."""
    # Flatten the nested Union tree into a list of (select_node, operator) pairs
    # sqlglot represents A UNION B UNION ALL C as Union(Union(A, B), C)
    queries_nodes = []
    operators = []

    def flatten_union(node):
        if isinstance(node, exp.Union):
            flatten_union(node.left)
            # Determine operator: UNION ALL vs UNION
            # sqlglot uses 'distinct' arg: True = UNION (distinct), False = UNION ALL
            is_distinct = node.args.get('distinct')
            if is_distinct is False:
                operators.append('UNION ALL')
            else:
                operators.append('UNION')
            flatten_union(node.right)
        else:
            queries_nodes.append(node)

    flatten_union(ast)

    # Extract compound-level ORDER BY and LIMIT from the outermost Union node
    compound_order_by = None
    compound_limit = None

    # sqlglot puts ORDER BY/LIMIT on the outermost Union node
    order_clause = ast.args.get("order")
    if order_clause:
        # We need a Select-like node to use parse_order_by, but Union doesn't have select expressions
        # Parse order by manually from the order clause
        compound_order_by = _parse_order_by_from_clause(order_clause)

    limit_clause = ast.args.get("limit")
    if limit_clause:
        limit_expr = limit_clause.expression if hasattr(limit_clause, 'expression') else limit_clause.this
        if isinstance(limit_expr, exp.Literal):
            try:
                compound_limit = int(limit_expr.this)
            except ValueError:
                pass

    # Parse each SELECT branch into a QueryIR (skip order_by/limit on individual queries)
    query_irs = []
    for select_node in queries_nodes:
        if not isinstance(select_node, exp.Select):
            raise UnsupportedSQLError("Expected SELECT in UNION branch", ["COMPOUND_PARSE_ERROR"])
        ir = _parse_select_to_query_ir(select_node)
        query_irs.append(ir)

    compound_ir = CompoundQueryIR(
        version=1,
        queries=query_irs,
        operators=operators,
        order_by=compound_order_by,
        limit=compound_limit,
    )

    # Round-trip validation
    if not _skip_validation:
        try:
            regenerated_sql = compound_ir_to_sql(compound_ir)
            comparison = compare_sql_ast(original_sql, regenerated_sql)
            if not comparison.equivalent:
                raise UnsupportedSQLError(
                    "Round-trip validation failed: regenerated SQL differs from original",
                    comparison.differences or ["SQL statements differ"],
                    hint="This query structure is not fully supported in GUI mode. Use SQL mode."
                )
        except UnsupportedSQLError:
            raise
        except Exception as e:
            raise UnsupportedSQLError(
                f"Validation error: {str(e)}",
                ["VALIDATION_ERROR"],
                hint="An error occurred validating this query. Use SQL mode."
            )

    return compound_ir


def _parse_order_by_from_clause(order_clause) -> Optional[List[OrderByClause]]:
    """Parse ORDER BY from a standalone order clause (not attached to a Select)."""
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
                item = parse_order_by_date_trunc(column_expr, direction)
                if item:
                    order_by.append(item)
            else:
                order_by.append(OrderByClause(
                    type='raw',
                    raw_sql=column_expr.sql(dialect='postgres'),
                    direction=direction,
                ))
    return order_by if order_by else None


def _parse_select_to_query_ir(select_node: exp.Select) -> QueryIR:
    """Parse a single SELECT node into a QueryIR (used for both simple and compound queries)."""
    # Extract CTEs
    ctes = []
    with_clause = select_node.args.get('with_')
    if with_clause:
        for cte_node in with_clause.expressions:
            cte_body_sql = cte_node.this.sql(dialect='postgres')
            ctes.append(CTE(name=cte_node.alias, raw_sql=cte_body_sql))

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
        ctes=ctes if ctes else None,
        select=select_columns,
        **{"from": from_table},
        joins=joins,
        where=where_clause,
        group_by=group_by,
        having=having,
        order_by=order_by,
        limit=limit,
    )


def _parse_simple_query(ast, original_sql: str, _skip_validation: bool) -> QueryIR:
    """Parse a simple (non-compound) query into QueryIR."""
    # Extract SELECT node
    select_node = ast if isinstance(ast, exp.Select) else ast.find(exp.Select)
    if not select_node:
        raise UnsupportedSQLError("No SELECT statement found", ["NO_SELECT"])

    ir = _parse_select_to_query_ir(select_node)

    # Round-trip validation: SQL → IR → SQL must be lossless
    if not _skip_validation:
        try:
            regenerated_sql = ir_to_sql(ir)
            comparison = compare_sql_ast(original_sql, regenerated_sql)
            if not comparison.equivalent:
                raise UnsupportedSQLError(
                    "Round-trip validation failed: regenerated SQL differs from original",
                    comparison.differences or ["SQL statements differ"],
                    hint="This query structure is not fully supported in GUI mode. Use SQL mode."
                )
        except UnsupportedSQLError:
            raise
        except Exception as e:
            raise UnsupportedSQLError(
                f"Validation error: {str(e)}",
                ["VALIDATION_ERROR"],
                hint="An error occurred validating this query. Use SQL mode."
            )

    return ir


def parse_select(select_node: exp.Select) -> List[SelectColumn]:
    """Parse SELECT clause into list of SelectColumn objects."""
    columns = []

    for expr in select_node.expressions:
        # Unwrap alias first so all expression types are handled once
        alias = expr.alias if isinstance(expr, exp.Alias) else None
        actual = expr.this if isinstance(expr, exp.Alias) else expr

        # Unwrap ROUND(simple_aggregate) — only when inner is a simple aggregate
        wrapper_function = None
        wrapper_args = None
        if isinstance(actual, exp.Round):
            inner = actual.this
            if isinstance(inner, (exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max)):
                wrapper_function = 'ROUND'
                decimals = actual.args.get('decimals')
                wrapper_args = [int(decimals.this)] if decimals is not None else []
                actual = inner
            # else: actual stays as Round, falls through to raw passthrough below

        if isinstance(actual, (exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max)):
            agg_type = type(actual).__name__.upper()
            agg_column = actual.this

            # Handle COUNT(DISTINCT col) — DISTINCT wraps the column
            if isinstance(actual, exp.Count) and isinstance(agg_column, exp.Distinct):
                agg_type = 'COUNT_DISTINCT'
                if agg_column.expressions:
                    agg_column = agg_column.expressions[0]

            if isinstance(agg_column, (exp.Column, exp.Star)):
                if isinstance(agg_column, exp.Star):
                    col_name = None if isinstance(actual, exp.Count) else '*'
                    table_name = None
                else:
                    col_name = agg_column.name
                    table_name = agg_column.table if hasattr(agg_column, 'table') and agg_column.table else None
                columns.append(SelectColumn(
                    type='aggregate',
                    column=col_name,
                    table=table_name,
                    aggregate=agg_type,
                    alias=alias,
                    wrapper_function=wrapper_function,
                    wrapper_args=wrapper_args,
                ))
            else:
                # Complex aggregate (CASE WHEN, arithmetic, etc.) → raw passthrough
                columns.append(SelectColumn(
                    type='raw',
                    raw_sql=actual.sql(dialect='postgres'),
                    alias=alias,
                ))

        elif isinstance(actual, exp.Column):
            columns.append(SelectColumn(
                type='column',
                column=actual.name,
                table=actual.table if hasattr(actual, 'table') and actual.table else None,
                alias=alias,
            ))

        elif isinstance(actual, exp.Star):
            columns.append(SelectColumn(
                type='column',
                column='*',
                table=actual.table if hasattr(actual, 'table') and actual.table else None,
                alias=alias,
            ))

        elif isinstance(actual, (exp.TimestampTrunc, exp.DateTrunc)):
            col = parse_date_trunc_expression(actual)
            if col:
                col.alias = alias
                columns.append(col)
            else:
                # Complex DATE_TRUNC (e.g. DATE_TRUNC('month', STRPTIME(...))) → raw passthrough
                columns.append(SelectColumn(
                    type='raw',
                    raw_sql=actual.sql(dialect='postgres'),
                    alias=alias,
                ))

        elif isinstance(actual, exp.Date):
            inner = actual.this
            col_name = inner.name if isinstance(inner, exp.Column) else inner.sql()
            table_name = inner.table if isinstance(inner, exp.Column) and inner.table else None
            columns.append(SelectColumn(
                type='expression',
                function='DATE',
                column=col_name,
                table=table_name,
                alias=alias,
            ))

        elif isinstance(actual, exp.SplitPart):
            col_expr = actual.this
            delimiter = actual.args['delimiter'].this  # e.g. '/'
            part_index = int(actual.args['part_index'].this)  # e.g. 2
            columns.append(SelectColumn(
                type='expression',
                function='SPLIT_PART',
                column=col_expr.name if isinstance(col_expr, exp.Column) else col_expr.sql(),
                table=col_expr.table if isinstance(col_expr, exp.Column) and col_expr.table else None,
                function_args=[delimiter, part_index],
                alias=alias,
            ))

        else:
            # Raw passthrough for unrecognized expressions (CASE, COALESCE, arithmetic, etc.)
            columns.append(SelectColumn(
                type='raw',
                raw_sql=actual.sql(dialect='postgres'),
                alias=alias,
            ))

    return columns


_DATE_TRUNC_UNITS = frozenset({'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'HOUR', 'MINUTE'})
_SIMPLE_AGGS = {exp.Sum: 'SUM', exp.Avg: 'AVG', exp.Min: 'MIN', exp.Max: 'MAX'}


def parse_date_trunc_expression(expr: exp.Expression) -> Optional[SelectColumn]:
    """Parse DATE_TRUNC / TimestampTrunc expression into SelectColumn.

    Handles both standard SQL arg order (unit, col) and BigQuery arg order
    (col, unit) which sqlglot may invert when parsing in postgres dialect.
    """
    column_expr = expr.this
    unit_expr = expr.args.get('unit')
    if not unit_expr:
        return None

    # Unit can be a Var (e.g., Var(this=WEEK)) or a Literal
    if isinstance(unit_expr, exp.Var):
        unit_str = unit_expr.name.upper()
    elif isinstance(unit_expr, exp.Literal):
        unit_str = str(unit_expr.this).upper()
    else:
        unit_str = str(unit_expr).upper()

    normalized_unit = unit_str if unit_str in _DATE_TRUNC_UNITS else None

    if normalized_unit and isinstance(column_expr, exp.Column):
        # Standard/BigQuery (parsed correctly): DateTrunc(this=col, unit=UNIT)
        return SelectColumn(
            type='expression',
            column=column_expr.name,
            table=column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None,
            function='DATE_TRUNC',
            unit=normalized_unit,
        )

    # BigQuery SQL parsed in postgres dialect swaps args:
    # DATE_TRUNC(col, UNIT) → postgres parses as DateTrunc(this=UNIT_as_col, unit=col_as_var)
    # Detect: "this" is a Column whose name is a recognized unit, "unit" is a Var/Column
    if (isinstance(column_expr, exp.Column)
            and column_expr.name.upper() in _DATE_TRUNC_UNITS
            and isinstance(unit_expr, (exp.Var, exp.Column))):
        swapped_unit = column_expr.name.upper()
        actual_col_name = unit_expr.name
        actual_col_table = unit_expr.table if hasattr(unit_expr, 'table') and unit_expr.table else None
        return SelectColumn(
            type='expression',
            column=actual_col_name,
            table=actual_col_table,
            function='DATE_TRUNC',
            unit=swapped_unit,
        )

    return None


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


def _is_simple_join_on(on_expr: exp.Expression) -> bool:
    """Return True if ON clause consists only of col=col equi-join conditions."""
    nodes = list(on_expr.flatten()) if isinstance(on_expr, exp.And) else [on_expr]
    return all(
        isinstance(n, exp.EQ)
        and isinstance(n.left, exp.Column)
        and isinstance(n.right, exp.Column)
        for n in nodes
    )


def parse_joins(select_node: exp.Select) -> Optional[List[JoinClause]]:
    """Parse JOIN clauses into list of JoinClause objects."""
    joins = []

    for join_node in (select_node.args.get('joins') or []):
        # Get join type (stored in 'side' for LEFT/RIGHT/FULL, 'kind' for INNER)
        join_kind = join_node.args.get("side", "").upper() or join_node.args.get("kind", "").upper() or "INNER"

        if join_kind not in ("INNER", "LEFT", "FULL"):
            continue  # Skip unsupported join types (e.g. RIGHT)

        # Get table
        table_expr = join_node.this
        if not isinstance(table_expr, exp.Table):
            continue

        table = TableReference(
            table=table_expr.name,
            schema=table_expr.db if hasattr(table_expr, 'db') and table_expr.db else None,
            alias=table_expr.alias if hasattr(table_expr, 'alias') and table_expr.alias else None,
        )

        # Parse ON conditions — use raw SQL for complex (non-equi) conditions
        on_conditions = None
        raw_on_sql = None
        on_clause = join_node.args.get("on")
        if on_clause:
            if _is_simple_join_on(on_clause):
                on_conditions = parse_join_conditions(on_clause)
            else:
                raw_on_sql = on_clause.sql(dialect='postgres')

        joins.append(JoinClause(
            type=join_kind,
            table=table,
            on=on_conditions,
            raw_on_sql=raw_on_sql,
        ))

    return joins if joins else None


def parse_join_conditions(on_expr: exp.Expression) -> List[JoinCondition]:
    """Parse ON clause into list of JoinCondition objects."""
    conditions = []
    nodes = list(on_expr.flatten()) if isinstance(on_expr, exp.And) else [on_expr]
    for condition in nodes:
        if isinstance(condition, exp.EQ):
            left, right = condition.left, condition.right
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
    if isinstance(expr, (exp.And, exp.Or)):
        operator = 'AND' if isinstance(expr, exp.And) else 'OR'
        conditions = []
        for child in expr.flatten():
            if isinstance(child, (exp.And, exp.Or)):
                conditions.append(parse_filter_expression(child))
            else:
                condition = parse_single_condition(child)
                if condition:
                    conditions.append(condition)
        return FilterGroup(operator=operator, conditions=conditions)

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
    _CMP_OPS = {exp.EQ: '=', exp.NEQ: '!=', exp.GT: '>', exp.LT: '<',
                exp.GTE: '>=', exp.LTE: '<=', exp.Like: 'LIKE', exp.ILike: 'ILIKE'}
    op = _CMP_OPS.get(type(expr))
    if op:
        return parse_comparison(expr, op)
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
    elif type(left) in _SIMPLE_AGGS:
        aggregate = _SIMPLE_AGGS[type(left)]
        column_expr = left.this

    # Handle COUNT(*) special case
    if column_expr is None and aggregate == 'COUNT':
        column_name = None  # COUNT(*) uses None
        table_name = None
        date_trunc_function = None
        date_trunc_unit = None
    # Handle DATE_TRUNC / TIMESTAMP_TRUNC on the left side (e.g. WHERE DATE_TRUNC(col, MONTH) < ...)
    elif isinstance(column_expr, (exp.DateTrunc, exp.TimestampTrunc)):
        parsed = parse_date_trunc_expression(column_expr)
        if parsed is None:
            return None
        column_name = parsed.column
        table_name = parsed.table
        date_trunc_function = 'DATE_TRUNC'
        date_trunc_unit = parsed.unit
    # If it's not a column/star and not an aggregate, store as raw SQL
    elif not isinstance(column_expr, (exp.Column, exp.Star)):
        # Function call or complex expression on the left side (e.g. SPLIT_PART(...))
        raw_column_sql = column_expr.sql(dialect='postgres')
        # Still need to parse the right side for param_name
        right = expr.right
        value = None
        param_name = None
        raw_value = None
        if isinstance(right, exp.Placeholder):
            param_name = right.name if hasattr(right, 'name') else right.this
        elif isinstance(right, exp.Literal):
            value = right.this
            if not right.is_string:
                try:
                    value = float(value) if '.' in str(value) else int(value)
                except ValueError:
                    pass
        elif isinstance(right, exp.Null):
            value = None
        else:
            raw_value = right.sql(dialect='postgres')
        return FilterCondition(
            operator=operator,
            value=value,
            param_name=param_name,
            raw_value=raw_value,
            raw_column=raw_column_sql,
        )
    # Extract column name and table
    elif isinstance(column_expr, exp.Star):
        # For aggregates other than COUNT, * doesn't make sense
        column_name = None if aggregate == 'COUNT' else '*'
        table_name = None
        date_trunc_function = None
        date_trunc_unit = None
    else:
        column_name = column_expr.name
        table_name = column_expr.table if hasattr(column_expr, 'table') and column_expr.table else None
        date_trunc_function = None
        date_trunc_unit = None

    # Extract value or parameter
    value = None
    param_name = None
    raw_value = None

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
        # Any unrecognized expression: store verbatim postgres SQL (no quoting)
        raw_value = right.sql(dialect='postgres')

    return FilterCondition(
        column=column_name,
        table=table_name,
        aggregate=aggregate,
        operator=operator,
        value=value,
        param_name=param_name,
        function=date_trunc_function,
        unit=date_trunc_unit,
        raw_value=raw_value,
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

    select_exprs = select_node.expressions
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
            else:
                # Complex DATE_TRUNC (e.g. DATE_TRUNC('month', STRPTIME(...))) → raw passthrough
                columns.append(GroupByItem(
                    type='column',
                    column=expr.sql(dialect='postgres'),
                ))
        elif isinstance(expr, exp.Date):
            inner = expr.this
            columns.append(GroupByItem(
                type='expression',
                function='DATE',
                column=inner.name if isinstance(inner, exp.Column) else inner.sql(),
                table=inner.table if isinstance(inner, exp.Column) and inner.table else None,
            ))
        elif isinstance(expr, exp.SplitPart):
            col_expr = expr.this
            delimiter = expr.args['delimiter'].this
            part_index = int(expr.args['part_index'].this)
            columns.append(GroupByItem(
                type='expression',
                function='SPLIT_PART',
                column=col_expr.name if isinstance(col_expr, exp.Column) else col_expr.sql(),
                table=col_expr.table if isinstance(col_expr, exp.Column) and col_expr.table else None,
                function_args=[delimiter, part_index],
            ))
        elif isinstance(expr, exp.Literal) and not expr.is_string:
            # Positional reference like GROUP BY 1 — resolve to actual SELECT column
            try:
                position = int(expr.this)
            except (ValueError, TypeError):
                continue
            if 1 <= position <= len(select_exprs):
                ref_expr = select_exprs[position - 1]
                actual = ref_expr.this if isinstance(ref_expr, exp.Alias) else ref_expr
                if isinstance(actual, exp.Column):
                    columns.append(GroupByItem(
                        type='column',
                        column=actual.name,
                        table=actual.table if hasattr(actual, 'table') and actual.table else None,
                    ))
                elif isinstance(actual, (exp.TimestampTrunc, exp.DateTrunc)):
                    item = parse_group_by_date_trunc(actual)
                    if item:
                        columns.append(item)
                    else:
                        # Complex DATE_TRUNC → use full SQL as column reference
                        columns.append(GroupByItem(
                            type='column',
                            column=actual.sql(dialect='postgres'),
                        ))
                else:
                    # Unrecognized expression → use full SQL as column reference
                    columns.append(GroupByItem(
                        type='column',
                        column=actual.sql(dialect='postgres'),
                    ))

    return GroupByClause(columns=columns) if columns else None


def parse_group_by_date_trunc(expr: exp.Expression) -> Optional[GroupByItem]:
    """Parse DATE_TRUNC expression in GROUP BY clause.

    Handles both standard arg order and BigQuery arg order swapped by postgres parser.
    """
    sel_col = parse_date_trunc_expression(expr)
    if sel_col is None:
        return None
    return GroupByItem(
        type='expression',
        column=sel_col.column,
        table=sel_col.table,
        function='DATE_TRUNC',
        unit=sel_col.unit,
    )


def parse_order_by(select_node: exp.Select) -> Optional[List[OrderByClause]]:
    """Parse ORDER BY clause into list of OrderByClause objects."""
    order_clause = select_node.args.get("order")
    if not order_clause:
        return None

    select_exprs = select_node.expressions
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
                else:
                    # Complex DATE_TRUNC → raw passthrough
                    order_by.append(OrderByClause(
                        type='raw',
                        raw_sql=column_expr.sql(dialect='postgres'),
                        direction=direction,
                    ))
            elif isinstance(column_expr, exp.Literal) and not column_expr.is_string:
                # Positional reference like ORDER BY 1 — resolve to actual SELECT column
                try:
                    position = int(column_expr.this)
                except (ValueError, TypeError):
                    continue
                if 1 <= position <= len(select_exprs):
                    ref_expr = select_exprs[position - 1]
                    actual = ref_expr.this if isinstance(ref_expr, exp.Alias) else ref_expr
                    if isinstance(actual, exp.Column):
                        order_by.append(OrderByClause(
                            type='column',
                            column=actual.name,
                            table=actual.table if hasattr(actual, 'table') and actual.table else None,
                            direction=direction,
                        ))
                    elif isinstance(actual, (exp.TimestampTrunc, exp.DateTrunc)):
                        item = parse_order_by_date_trunc(actual, direction)
                        if item:
                            order_by.append(item)
                        elif isinstance(ref_expr, exp.Alias) and ref_expr.alias:
                            order_by.append(OrderByClause(
                                type='column',
                                column=ref_expr.alias,
                                direction=direction,
                            ))
                        else:
                            order_by.append(OrderByClause(
                                type='raw',
                                raw_sql=actual.sql(dialect='postgres'),
                                direction=direction,
                            ))
                    elif isinstance(ref_expr, exp.Alias) and ref_expr.alias:
                        # For aggregates or other complex expressions, use alias as column ref
                        order_by.append(OrderByClause(
                            type='column',
                            column=ref_expr.alias,
                            direction=direction,
                        ))
            else:
                # Raw passthrough for CASE and other unrecognized ORDER BY expressions
                order_by.append(OrderByClause(
                    type='raw',
                    raw_sql=column_expr.sql(dialect='postgres'),
                    direction=direction,
                ))

    return order_by if order_by else None


def parse_order_by_date_trunc(expr: exp.Expression, direction: str) -> Optional[OrderByClause]:
    """Parse DATE_TRUNC expression in ORDER BY clause.

    Handles both standard arg order and BigQuery arg order swapped by postgres parser.
    """
    sel_col = parse_date_trunc_expression(expr)
    if sel_col is None:
        return None
    return OrderByClause(
        type='expression',
        column=sel_col.column,
        table=sel_col.table,
        direction=direction,
        function='DATE_TRUNC',
        unit=sel_col.unit,
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
