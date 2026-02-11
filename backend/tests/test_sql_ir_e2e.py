"""
E2E tests for SQL IR round-trip: SQL → IR → SQL

These tests validate that queries can be:
1. Parsed from SQL to IR (backend parser)
2. Regenerated from IR to SQL (would be frontend generator)
3. Semantically equivalent (not necessarily character-identical)
"""

import pytest
from sql_ir import parse_sql_to_ir


def normalize_sql(sql: str) -> str:
    """Normalize SQL for comparison (remove extra whitespace, lowercase keywords)."""
    import re
    # Remove comments
    sql = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
    # Collapse whitespace
    sql = ' '.join(sql.split())
    # Remove trailing semicolon
    sql = sql.rstrip(';')
    return sql.strip()


def ir_to_sql_python(ir) -> str:
    """
    Python implementation of IR → SQL (mirrors frontend TypeScript version).
    This allows us to test the full round-trip in Python.
    """
    parts = []

    # SELECT
    select_cols = []
    for col in ir.select:
        if col.type == 'aggregate':
            agg = col.aggregate
            # Handle COUNT(*) - column is None for COUNT(*)
            if col.column is None:
                col_name = '*'
            else:
                col_name = f"{col.table}.{col.column}" if col.table else col.column

            if agg == 'COUNT_DISTINCT':
                result = f"COUNT(DISTINCT {col_name})"
            else:
                result = f"{agg}({col_name})"
        else:
            result = f"{col.table}.{col.column}" if col.table else col.column

        if col.alias:
            result += f" AS {col.alias}"

        select_cols.append(result)

    parts.append("SELECT " + ", ".join(select_cols))

    # FROM
    from_clause = ir.from_.table
    if ir.from_.schema:
        from_clause = f"{ir.from_.schema}.{from_clause}"
    if ir.from_.alias:
        from_clause += f" {ir.from_.alias}"
    parts.append("FROM " + from_clause)

    # JOINs
    if ir.joins:
        for join in ir.joins:
            join_type = "LEFT JOIN" if join.type == "LEFT" else "INNER JOIN"
            table = join.table.table
            if join.table.schema:
                table = f"{join.table.schema}.{table}"
            if join.table.alias:
                table += f" {join.table.alias}"

            conditions = []
            for cond in join.on:
                conditions.append(
                    f"{cond.left_table}.{cond.left_column} = {cond.right_table}.{cond.right_column}"
                )

            parts.append(f"{join_type} {table} ON {' AND '.join(conditions)}")

    # WHERE
    if ir.where and ir.where.conditions:
        parts.append("WHERE " + filter_group_to_sql(ir.where))

    # GROUP BY
    if ir.group_by and ir.group_by.columns:
        cols = []
        for col in ir.group_by.columns:
            cols.append(f"{col.table}.{col.column}" if col.table else col.column)
        parts.append("GROUP BY " + ", ".join(cols))

    # HAVING
    if ir.having and ir.having.conditions:
        parts.append("HAVING " + filter_group_to_sql(ir.having))

    # ORDER BY
    if ir.order_by:
        order_cols = []
        for col in ir.order_by:
            col_name = f"{col.table}.{col.column}" if col.table else col.column
            order_cols.append(f"{col_name} {col.direction}")
        parts.append("ORDER BY " + ", ".join(order_cols))

    # LIMIT
    if ir.limit is not None:
        parts.append(f"LIMIT {ir.limit}")

    return " ".join(parts)


def filter_group_to_sql(group) -> str:
    """Convert FilterGroup to SQL."""
    if not group.conditions:
        return ""

    if len(group.conditions) == 1:
        cond = group.conditions[0]
        # Check if it's a FilterCondition or nested FilterGroup
        if hasattr(cond, 'column'):
            return filter_condition_to_sql(cond)
        else:
            return "(" + filter_group_to_sql(cond) + ")"

    parts = []
    for cond in group.conditions:
        if hasattr(cond, 'column'):
            parts.append(filter_condition_to_sql(cond))
        else:
            parts.append("(" + filter_group_to_sql(cond) + ")")

    return f" {group.operator} ".join(parts)


def filter_condition_to_sql(cond) -> str:
    """Convert FilterCondition to SQL."""
    # Handle aggregate filters (HAVING clause)
    if cond.aggregate:
        # Handle COUNT(*) - column is None for COUNT(*)
        if cond.column is None:
            col_expr = '*'
        else:
            col_expr = f"{cond.table}.{cond.column}" if cond.table else cond.column

        if cond.aggregate == 'COUNT_DISTINCT':
            column = f"COUNT(DISTINCT {col_expr})"
        else:
            column = f"{cond.aggregate}({col_expr})"
    else:
        # Regular column filter (WHERE clause)
        column = f"{cond.table}.{cond.column}" if cond.table else cond.column

    if cond.operator in ('IS NULL', 'IS NOT NULL'):
        return f"{column} {cond.operator}"

    if cond.operator == 'IN':
        if isinstance(cond.value, list):
            values = ", ".join(f"'{v}'" if isinstance(v, str) else str(v) for v in cond.value)
        else:
            values = f"'{cond.value}'" if isinstance(cond.value, str) else str(cond.value)
        return f"{column} IN ({values})"

    if cond.param_name:
        return f"{column} {cond.operator} :{cond.param_name}"

    # Format value
    if cond.value is None:
        value = "NULL"
    elif isinstance(cond.value, bool):
        value = "true" if cond.value else "false"
    elif isinstance(cond.value, str):
        value = f"'{cond.value}'"
    else:
        value = str(cond.value)

    return f"{column} {cond.operator} {value}"


class TestSQLRoundTrip:
    """Test round-trip conversion: SQL → IR → SQL"""

    def test_simple_select(self):
        """Test simple SELECT with WHERE and LIMIT"""
        original_sql = "SELECT name, email FROM users WHERE active = true LIMIT 10"

        # Parse to IR
        ir = parse_sql_to_ir(original_sql)

        # Generate SQL from IR
        generated_sql = ir_to_sql_python(ir)

        # Normalize both for comparison
        original_norm = normalize_sql(original_sql)
        generated_norm = normalize_sql(generated_sql)

        # Should be equivalent (may differ in formatting)
        assert "SELECT name, email" in generated_norm
        assert "FROM users" in generated_norm
        assert "WHERE" in generated_norm
        assert "active =" in generated_norm  # Value may be 'true' or 'TRUE'
        assert "LIMIT 10" in generated_norm

    def test_join_with_aggregates(self):
        """Test JOIN with GROUP BY and aggregates"""
        original_sql = """
        SELECT
            u.name,
            COUNT(*) AS order_count,
            SUM(o.amount) AS total_amount
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        WHERE u.active = true
        GROUP BY u.name
        ORDER BY total_amount DESC
        LIMIT 20
        """

        # Parse to IR
        ir = parse_sql_to_ir(original_sql)

        # Validate IR structure
        assert len(ir.select) == 3
        assert ir.select[0].column == 'name'
        assert ir.select[0].table == 'u'
        assert ir.select[1].type == 'aggregate'
        assert ir.select[1].aggregate == 'COUNT'
        assert ir.select[2].type == 'aggregate'
        assert ir.select[2].aggregate == 'SUM'

        # Generate SQL
        generated_sql = ir_to_sql_python(ir)
        generated_norm = normalize_sql(generated_sql)

        # Verify key components
        assert "SELECT u.name" in generated_norm
        assert "COUNT(*)" in generated_norm
        assert "SUM(o.amount)" in generated_norm
        assert "FROM users u" in generated_norm
        assert "INNER JOIN orders o" in generated_norm
        assert "ON u.id = o.user_id" in generated_norm
        assert "WHERE u.active =" in generated_norm  # Value may be 'true' or 'TRUE'
        assert "GROUP BY u.name" in generated_norm
        assert "ORDER BY total_amount DESC" in generated_norm
        assert "LIMIT 20" in generated_norm

    def test_complex_filters_with_parameters(self):
        """Test complex WHERE with parameters and multiple conditions"""
        original_sql = """
        SELECT p.name, p.category, p.price
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.active = true
          AND p.price >= :min_price
          AND p.price <= :max_price
          AND c.name IN ('Electronics', 'Computers')
        ORDER BY p.price ASC, p.name ASC
        """

        # Parse to IR
        ir = parse_sql_to_ir(original_sql)

        # Validate IR
        assert ir.joins is not None
        assert ir.joins[0].type == 'LEFT'
        assert ir.where is not None
        assert ir.where.operator == 'AND'
        # Should have flattened AND conditions
        assert len(ir.where.conditions) >= 3

        # Check for parameters
        param_conditions = [
            c for c in ir.where.conditions
            if hasattr(c, 'param_name') and c.param_name
        ]
        assert len(param_conditions) >= 2
        param_names = {c.param_name for c in param_conditions}
        assert 'min_price' in param_names
        assert 'max_price' in param_names

        # Generate SQL
        generated_sql = ir_to_sql_python(ir)
        generated_norm = normalize_sql(generated_sql)

        # Verify components
        assert "LEFT JOIN categories c" in generated_norm
        assert ":min_price" in generated_norm
        assert ":max_price" in generated_norm
        assert "IN ('Electronics', 'Computers')" in generated_norm
        assert "ORDER BY p.price ASC, p.name ASC" in generated_norm


class TestSemanticEquivalence:
    """
    Test that regenerated SQL is semantically equivalent to original.
    These tests would ideally execute both queries and compare results.
    """

    def test_count_distinct_equivalence(self):
        """Test COUNT(DISTINCT ...) round-trip"""
        sql = "SELECT category, COUNT(DISTINCT user_id) AS unique_users FROM orders GROUP BY category"

        ir = parse_sql_to_ir(sql)
        generated = ir_to_sql_python(ir)

        # Verify COUNT(DISTINCT is preserved
        assert "COUNT(DISTINCT user_id)" in generated
        assert "GROUP BY category" in generated

    def test_table_aliases_preserved(self):
        """Test that table aliases are preserved"""
        sql = """
        SELECT u.id, u.name, o.amount
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        WHERE u.active = true
        """

        ir = parse_sql_to_ir(sql)
        generated = ir_to_sql_python(ir)

        # Aliases should be preserved
        assert "users u" in generated
        assert "orders o" in generated
        assert "u.id" in generated
        assert "o.amount" in generated

    def test_null_checks_preserved(self):
        """Test IS NULL / IS NOT NULL round-trip"""
        sql = "SELECT * FROM users WHERE deleted_at IS NULL AND email IS NOT NULL"

        ir = parse_sql_to_ir(sql)
        generated = ir_to_sql_python(ir)

        assert "IS NULL" in generated
        assert "IS NOT NULL" in generated


class TestEdgeCases:
    """Test edge cases and boundary conditions"""

    def test_select_star(self):
        """Test SELECT * round-trip"""
        sql = "SELECT * FROM users"
        ir = parse_sql_to_ir(sql)
        generated = ir_to_sql_python(ir)

        assert "SELECT *" in generated
        assert "FROM users" in generated

    def test_no_where_clause(self):
        """Test query without WHERE"""
        sql = "SELECT name, email FROM users ORDER BY name"
        ir = parse_sql_to_ir(sql)
        generated = ir_to_sql_python(ir)

        assert "WHERE" not in generated
        assert "ORDER BY name" in generated

    def test_schema_qualified_tables(self):
        """Test schema.table notation"""
        sql = "SELECT * FROM public.users"
        ir = parse_sql_to_ir(sql)
        generated = ir_to_sql_python(ir)

        assert "public.users" in generated
