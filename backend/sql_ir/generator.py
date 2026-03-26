"""
SQL Generator - Converts IR back to SQL.

This mirrors the frontend TypeScript implementation in ir-to-sql.ts
and is used for round-trip validation.
"""

from typing import Union
from .ir_types import QueryIR, CompoundQueryIR, SelectColumn, FilterGroup, FilterCondition


def ir_to_sql(ir: QueryIR) -> str:
    """
    Convert QueryIR to SQL string.

    This is the Python equivalent of the frontend's irToSql function.
    Used for round-trip validation to ensure lossless conversion.
    """
    parts = []

    # SELECT clause with optional DISTINCT
    select_keyword = "SELECT DISTINCT" if ir.distinct else "SELECT"
    select_cols = generate_select_clause(ir)
    # Format SELECT columns with indentation if multiple columns
    if "," in select_cols:
        cols_list = [c.strip() for c in select_cols.split(",")]
        parts.append(f"{select_keyword}\n  " + ",\n  ".join(cols_list))
    else:
        parts.append(f"{select_keyword} {select_cols}")

    # FROM clause
    from_clause = ir.from_.table
    if ir.from_.schema:
        from_clause = f"{ir.from_.schema}.{from_clause}"
    if ir.from_.alias:
        from_clause += f" {ir.from_.alias}"  # No AS keyword for table aliases
    parts.append("FROM " + from_clause)

    # JOINs
    if ir.joins:
        for join in ir.joins:
            join_sql = generate_join_clause(join)
            parts.append(join_sql)

    # WHERE
    if ir.where and ir.where.conditions:
        parts.append("WHERE " + generate_filter_group(ir.where))

    # GROUP BY
    if ir.group_by and ir.group_by.columns:
        parts.append("GROUP BY " + generate_group_by_clause(ir.group_by.columns))

    # HAVING
    if ir.having and ir.having.conditions:
        parts.append("HAVING " + generate_filter_group(ir.having))

    # ORDER BY
    if ir.order_by:
        order_parts = []
        for col in ir.order_by:
            col_expr = generate_order_by_expression(col)
            order_parts.append(f"{col_expr} {col.direction}")
        parts.append("ORDER BY " + ", ".join(order_parts))

    # LIMIT
    if ir.limit is not None:
        parts.append(f"LIMIT {ir.limit}")

    # Prepend CTE block if present
    if ir.ctes:
        cte_sqls = [f"{c.name} AS (\n{c.raw_sql}\n)" for c in ir.ctes]
        parts.insert(0, "WITH " + ",\n".join(cte_sqls))

    # Join clauses with newlines for readable formatting
    return "\n".join(parts)


def generate_select_clause(ir: QueryIR) -> str:
    """Generate SELECT column list."""
    if not ir.select:
        return "*"

    # Check for SELECT *
    if len(ir.select) == 1 and ir.select[0].column == "*" and ir.select[0].type == "column":
        return "*"

    cols = []
    for col in ir.select:
        col_sql = generate_select_column(col)
        cols.append(col_sql)

    return ", ".join(cols)


def generate_select_column(col: SelectColumn) -> str:
    """Generate a single SELECT column expression."""
    result = ""

    if col.type == "raw":
        result = col.raw_sql or "*"

    elif col.type == "aggregate":
        # Aggregate function
        agg = col.aggregate
        if col.column is None or col.column == "*":
            col_ref = "*"
        elif col.table:
            col_ref = f"{col.table}.{col.column}"
        else:
            col_ref = col.column

        if agg == "COUNT_DISTINCT":
            result = f"COUNT(DISTINCT {col_ref})"
        else:
            result = f"{agg}({col_ref})"

        # Apply wrapper function (e.g. ROUND(SUM(col), 2))
        if col.wrapper_function == "ROUND":
            args = col.wrapper_args or []
            args_str = ", ".join(str(a) for a in args)
            result = f"ROUND({result}, {args_str})" if args_str else f"ROUND({result})"

    elif col.type == "expression":
        col_ref = f"{col.table}.{col.column}" if col.table else col.column
        if col.function == "DATE_TRUNC":
            result = f"DATE_TRUNC('{col.unit}', {col_ref})"
        elif col.function == "DATE":
            result = f"DATE({col_ref})"
        elif col.function == "SPLIT_PART":
            args = col.function_args or []
            result = f"SPLIT_PART({col_ref}, '{args[0]}', {args[1]})"
        else:
            # Unknown expression type, fall back to column
            result = col_ref or "*"

    else:
        # Regular column
        if col.column == "*":
            result = "*"
        elif col.table:
            result = f"{col.table}.{col.column}"
        else:
            result = col.column or "*"

    # Add alias
    if col.alias:
        result += f" AS {col.alias}"

    return result


def generate_join_clause(join) -> str:
    """Generate a JOIN clause."""
    if join.type == "LEFT":
        join_type = "LEFT JOIN"
    elif join.type == "FULL":
        join_type = "FULL OUTER JOIN"
    else:
        join_type = "INNER JOIN"

    table = join.table.table
    if join.table.schema:
        table = f"{join.table.schema}.{table}"
    if join.table.alias:
        table += f" {join.table.alias}"  # No AS keyword for table aliases

    if join.raw_on_sql:
        return f"{join_type} {table} ON {join.raw_on_sql}"

    conditions = []
    for cond in (join.on or []):
        conditions.append(
            f"{cond.left_table}.{cond.left_column} = {cond.right_table}.{cond.right_column}"
        )

    if conditions:
        return f"{join_type} {table} ON {' AND '.join(conditions)}"
    return f"{join_type} {table}"


def generate_filter_group(group: FilterGroup) -> str:
    """Generate WHERE/HAVING filter expression."""
    if not group.conditions:
        return ""

    parts = []
    for cond in group.conditions:
        if isinstance(cond, FilterCondition) or hasattr(cond, 'column'):
            parts.append(generate_filter_condition(cond))
        else:
            # Nested group
            parts.append("(" + generate_filter_group(cond) + ")")

    return f" {group.operator} ".join(parts)


def generate_filter_condition(cond: FilterCondition) -> str:
    """Generate a single filter condition."""
    # Build column reference
    if cond.aggregate:
        # Aggregate in HAVING
        if cond.column is None or cond.column == "*":
            col_ref = "*"
        elif cond.table:
            col_ref = f"{cond.table}.{cond.column}"
        else:
            col_ref = cond.column

        if cond.aggregate == "COUNT_DISTINCT":
            column = f"COUNT(DISTINCT {col_ref})"
        else:
            column = f"{cond.aggregate}({col_ref})"
    elif cond.function == "DATE_TRUNC":
        # DATE_TRUNC expression on the left side
        col_ref = f"{cond.table}.{cond.column}" if cond.table else cond.column
        column = f"DATE_TRUNC('{cond.unit}', {col_ref})"
    else:
        # Regular column
        column = f"{cond.table}.{cond.column}" if cond.table else cond.column

    # Handle special operators
    if cond.operator in ("IS NULL", "IS NOT NULL"):
        return f"{column} {cond.operator}"

    if cond.operator == "IN":
        if isinstance(cond.value, list):
            values = ", ".join(format_value(v) for v in cond.value)
        else:
            values = format_value(cond.value)
        return f"{column} IN ({values})"

    # Handle parameter
    if cond.param_name:
        return f"{column} {cond.operator} :{cond.param_name}"

    # Raw verbatim expression (e.g. CURRENT_TIMESTAMP, TIMESTAMP_TRUNC(...))
    if cond.raw_value is not None:
        return f"{column} {cond.operator} {cond.raw_value}"

    # Regular comparison
    return f"{column} {cond.operator} {format_value(cond.value)}"


def generate_group_by_clause(columns) -> str:
    """Generate GROUP BY column list."""
    parts = []
    for col in columns:
        col_ref = f"{col.table}.{col.column}" if col.table else col.column
        if col.type == "expression" and col.function == "DATE_TRUNC":
            parts.append(f"DATE_TRUNC('{col.unit}', {col_ref})")
        elif col.type == "expression" and col.function == "DATE":
            parts.append(f"DATE({col_ref})")
        elif col.type == "expression" and col.function == "SPLIT_PART":
            args = col.function_args or []
            parts.append(f"SPLIT_PART({col_ref}, '{args[0]}', {args[1]})")
        else:
            parts.append(col_ref)
    return ", ".join(parts)


def generate_order_by_expression(col) -> str:
    """Generate ORDER BY column expression."""
    col_type = getattr(col, "type", "column")

    # Raw passthrough
    if col_type == "raw":
        return col.raw_sql or ""

    col_ref = f"{col.table}.{col.column}" if col.table else col.column
    if col_type == "expression" and getattr(col, "function", None) == "DATE_TRUNC":
        return f"DATE_TRUNC('{col.unit}', {col_ref})"
    if col_type == "expression" and getattr(col, "function", None) == "DATE":
        return f"DATE({col_ref})"

    # Regular column
    if col.table:
        return f"{col.table}.{col.column}"
    return col.column


def compound_ir_to_sql(ir: CompoundQueryIR) -> str:
    """Convert CompoundQueryIR (UNION/UNION ALL) to SQL string."""
    if len(ir.queries) < 2:
        raise ValueError("Compound query must have at least 2 queries")
    if len(ir.operators) != len(ir.queries) - 1:
        raise ValueError("Number of operators must be len(queries) - 1")

    # Generate SQL for each individual query (without order_by/limit)
    query_sqls = []
    for q in ir.queries:
        # Temporarily clear order_by and limit for individual queries
        q_copy = q.model_copy(update={'order_by': None, 'limit': None})
        query_sqls.append(ir_to_sql(q_copy))

    # Interleave queries with operators
    parts = [query_sqls[0]]
    for i, op in enumerate(ir.operators):
        parts.append(op)
        parts.append(query_sqls[i + 1])

    result = "\n".join(parts)

    # Append compound-level ORDER BY
    if ir.order_by:
        order_parts = []
        for col in ir.order_by:
            col_expr = generate_order_by_expression(col)
            order_parts.append(f"{col_expr} {col.direction}")
        result += "\nORDER BY " + ", ".join(order_parts)

    # Append compound-level LIMIT
    if ir.limit is not None:
        result += f"\nLIMIT {ir.limit}"

    return result


def any_ir_to_sql(ir: Union[QueryIR, CompoundQueryIR, dict]) -> str:
    """Dispatch to the correct generator based on IR type."""
    if isinstance(ir, dict):
        if ir.get('type') == 'compound':
            return compound_ir_to_sql(CompoundQueryIR.model_validate(ir))
        return ir_to_sql(QueryIR.model_validate(ir))
    if isinstance(ir, CompoundQueryIR):
        return compound_ir_to_sql(ir)
    return ir_to_sql(ir)


def format_value(value) -> str:
    """Format a value for SQL."""
    if value is None:
        return "NULL"
    elif isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    elif isinstance(value, str):
        # Escape single quotes
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    elif isinstance(value, (int, float)):
        return str(value)
    else:
        return str(value)
