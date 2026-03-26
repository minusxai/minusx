"""
E2E tests for SQL IR round-trip: SQL → IR → SQL

These tests validate that queries can be:
1. Parsed from SQL to IR (backend parser)
2. Regenerated from IR to SQL (would be frontend generator)
3. Semantically equivalent (not necessarily character-identical)
"""

import pytest
from sql_ir import parse_sql_to_ir, any_ir_to_sql, CompoundQueryIR


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
        elif col.type == 'expression' and getattr(col, 'function', None) == 'DATE_TRUNC':
            col_ref = f"{col.table}.{col.column}" if col.table else col.column
            result = f"DATE_TRUNC('{col.unit}', {col_ref})"
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
            if getattr(col, 'type', 'column') == 'expression' and getattr(col, 'function', None) == 'DATE_TRUNC':
                col_ref = f"{col.table}.{col.column}" if col.table else col.column
                cols.append(f"DATE_TRUNC('{col.unit}', {col_ref})")
            else:
                cols.append(f"{col.table}.{col.column}" if col.table else col.column)
        parts.append("GROUP BY " + ", ".join(cols))

    # HAVING
    if ir.having and ir.having.conditions:
        parts.append("HAVING " + filter_group_to_sql(ir.having))

    # ORDER BY
    if ir.order_by:
        order_cols = []
        for col in ir.order_by:
            if getattr(col, 'type', 'column') == 'expression' and getattr(col, 'function', None) == 'DATE_TRUNC':
                col_ref = f"{col.table}.{col.column}" if col.table else col.column
                col_name = f"DATE_TRUNC('{col.unit}', {col_ref})"
            else:
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
    elif getattr(cond, 'function', None) == 'DATE_TRUNC':
        # DATE_TRUNC expression on the left side
        col_ref = f"{cond.table}.{cond.column}" if cond.table else cond.column
        column = f"DATE_TRUNC('{cond.unit}', {col_ref})"
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

    # Raw verbatim expression (e.g. CURRENT_TIMESTAMP, TIMESTAMP_TRUNC(...))
    if getattr(cond, 'raw_value', None) is not None:
        return f"{column} {cond.operator} {cond.raw_value}"

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


class TestDateTruncFilters:
    """Test DATE_TRUNC / TIMESTAMP_TRUNC in WHERE, GROUP BY, ORDER BY"""

    def test_date_trunc_in_where_and_positional_group_order_by(self):
        """Query 1: DATE_TRUNC filter + COUNT(DISTINCT) + positional GROUP BY 1, ORDER BY 1"""
        sql = """
        SELECT
          DATE_TRUNC(created_at, MONTH) AS month,
          COUNT(DISTINCT conv_id) AS unique_conversations
        FROM analytics.processed_requests_with_sub
        WHERE DATE_TRUNC(created_at, MONTH) < TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
        GROUP BY 1
        ORDER BY 1
        """

        ir = parse_sql_to_ir(sql)

        # SELECT: DATE_TRUNC expression + COUNT(DISTINCT)
        assert len(ir.select) == 2
        assert ir.select[0].type == 'expression'
        assert ir.select[0].function == 'DATE_TRUNC'
        assert ir.select[0].unit == 'MONTH'
        assert ir.select[0].column.lower() == 'created_at'
        assert ir.select[1].type == 'aggregate'
        assert ir.select[1].aggregate == 'COUNT_DISTINCT'

        # WHERE: DATE_TRUNC filter preserved
        assert ir.where is not None
        conditions = ir.where.conditions
        assert len(conditions) >= 1
        date_trunc_conds = [c for c in conditions if hasattr(c, 'function') and c.function == 'DATE_TRUNC']
        assert len(date_trunc_conds) == 1
        assert date_trunc_conds[0].operator == '<'
        assert date_trunc_conds[0].raw_value is not None

        # GROUP BY: resolved from positional reference
        assert ir.group_by is not None
        assert len(ir.group_by.columns) == 1
        assert ir.group_by.columns[0].type == 'expression'
        assert ir.group_by.columns[0].function == 'DATE_TRUNC'

        # ORDER BY: resolved from positional reference
        assert ir.order_by is not None
        assert len(ir.order_by) == 1
        assert ir.order_by[0].type == 'expression'
        assert ir.order_by[0].function == 'DATE_TRUNC'

        # Generate SQL
        generated = ir_to_sql_python(ir)
        norm = normalize_sql(generated)
        assert "DATE_TRUNC(" in norm
        assert "COUNT(DISTINCT conv_id)" in norm
        assert "WHERE" in norm
        assert "GROUP BY" in norm
        assert "ORDER BY" in norm

    def test_date_trunc_filter_with_string_filter(self):
        """Query 2: DATE_TRUNC filter combined with a string equality filter"""
        sql = """
        SELECT
          DATE_TRUNC(created_at, MONTH) AS month,
          COUNT(*) AS user_questions
        FROM analytics.processed_requests_with_sub
        WHERE last_message_role = 'user'
          AND DATE_TRUNC(created_at, MONTH) < TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
        GROUP BY 1
        ORDER BY 1
        """

        ir = parse_sql_to_ir(sql)

        # WHERE: both conditions present
        assert ir.where is not None
        assert ir.where.operator == 'AND'
        conditions = ir.where.conditions
        assert len(conditions) >= 2

        string_conds = [c for c in conditions if hasattr(c, 'column') and c.column == 'last_message_role']
        assert len(string_conds) == 1
        assert string_conds[0].value == 'user'

        date_trunc_conds = [c for c in conditions if hasattr(c, 'function') and c.function == 'DATE_TRUNC']
        assert len(date_trunc_conds) == 1
        assert date_trunc_conds[0].operator == '<'
        assert date_trunc_conds[0].raw_value is not None

        # GROUP BY and ORDER BY resolved from positional references
        assert ir.group_by is not None
        assert ir.order_by is not None

        generated = ir_to_sql_python(ir)
        norm = normalize_sql(generated)
        assert "last_message_role" in norm
        assert "DATE_TRUNC(" in norm
        assert "WHERE" in norm
        assert "GROUP BY" in norm

    def test_current_timestamp_in_or_filter(self):
        """Query 3: CURRENT_TIMESTAMP (no parens) in OR filter"""
        sql = """
        SELECT
          plan_type,
          COUNT(DISTINCT email_id) AS users
        FROM analytics.all_subscriptions
        WHERE subscription_end IS NULL OR subscription_end > CURRENT_TIMESTAMP
        GROUP BY 1
        ORDER BY 2 DESC
        """

        ir = parse_sql_to_ir(sql)

        # WHERE: OR group with IS NULL and > CURRENT_TIMESTAMP
        assert ir.where is not None
        assert ir.where.operator == 'OR'
        conditions = ir.where.conditions
        assert len(conditions) == 2

        null_conds = [c for c in conditions if hasattr(c, 'operator') and c.operator == 'IS NULL']
        assert len(null_conds) == 1

        gt_conds = [c for c in conditions if hasattr(c, 'operator') and c.operator == '>']
        assert len(gt_conds) == 1
        assert gt_conds[0].raw_value is not None
        assert 'CURRENT_TIMESTAMP' in gt_conds[0].raw_value.upper()

        # GROUP BY resolved from positional reference (plan_type)
        assert ir.group_by is not None
        assert len(ir.group_by.columns) == 1
        assert ir.group_by.columns[0].column == 'plan_type'

        # ORDER BY positional reference (2nd column = COUNT(DISTINCT email_id))
        assert ir.order_by is not None
        assert ir.order_by[0].direction == 'DESC'

        generated = ir_to_sql_python(ir)
        norm = normalize_sql(generated)
        assert "subscription_end IS NULL" in norm
        assert "CURRENT_TIMESTAMP" in norm
        assert "GROUP BY plan_type" in norm


class TestCompoundQueries:
    """Test UNION / UNION ALL compound query parsing and generation."""

    def test_simple_union(self):
        """Test basic UNION of two queries."""
        sql = "SELECT name FROM users UNION SELECT name FROM admins"
        ir = parse_sql_to_ir(sql)

        assert isinstance(ir, CompoundQueryIR)
        assert ir.type == 'compound'
        assert len(ir.queries) == 2
        assert ir.operators == ['UNION']
        assert ir.queries[0].from_.table == 'users'
        assert ir.queries[1].from_.table == 'admins'
        assert ir.order_by is None
        assert ir.limit is None

    def test_union_all(self):
        """Test UNION ALL preserves duplicates operator."""
        sql = "SELECT id, name FROM t1 UNION ALL SELECT id, name FROM t2"
        ir = parse_sql_to_ir(sql)

        assert isinstance(ir, CompoundQueryIR)
        assert ir.operators == ['UNION ALL']
        assert len(ir.queries[0].select) == 2
        assert len(ir.queries[1].select) == 2

    def test_triple_union(self):
        """Test three queries with mixed UNION and UNION ALL."""
        sql = "SELECT a FROM t1 UNION SELECT a FROM t2 UNION ALL SELECT a FROM t3"
        ir = parse_sql_to_ir(sql)

        assert isinstance(ir, CompoundQueryIR)
        assert len(ir.queries) == 3
        assert ir.operators == ['UNION', 'UNION ALL']

    def test_union_with_order_by_and_limit(self):
        """Test compound query with ORDER BY and LIMIT on the result."""
        sql = "SELECT name FROM users UNION ALL SELECT name FROM admins ORDER BY name LIMIT 10"
        ir = parse_sql_to_ir(sql)

        assert isinstance(ir, CompoundQueryIR)
        assert ir.order_by is not None
        assert len(ir.order_by) == 1
        assert ir.order_by[0].column == 'name'
        assert ir.limit == 10
        # Individual queries should NOT have order_by/limit
        for q in ir.queries:
            assert q.order_by is None
            assert q.limit is None

    def test_union_round_trip(self):
        """Test SQL → IR → SQL round-trip for compound queries."""
        sql = "SELECT name, email FROM users WHERE active = true UNION ALL SELECT name, email FROM admins WHERE role = 'admin'"
        ir = parse_sql_to_ir(sql)

        assert isinstance(ir, CompoundQueryIR)
        regenerated = any_ir_to_sql(ir)
        norm = normalize_sql(regenerated)

        assert "UNION ALL" in norm
        assert "FROM users" in norm
        assert "FROM admins" in norm
        assert "WHERE" in norm

    def test_union_with_where_clauses(self):
        """Test that individual queries in UNION preserve their WHERE clauses."""
        sql = "SELECT name FROM users WHERE active = true UNION SELECT name FROM admins WHERE role = 'superadmin'"
        ir = parse_sql_to_ir(sql)

        assert isinstance(ir, CompoundQueryIR)
        assert ir.queries[0].where is not None
        assert ir.queries[1].where is not None

    def test_simple_query_still_returns_query_ir(self):
        """Ensure simple queries still return QueryIR, not CompoundQueryIR."""
        sql = "SELECT id, name FROM users WHERE id > 5"
        ir = parse_sql_to_ir(sql)

        assert not isinstance(ir, CompoundQueryIR)
        assert ir.from_.table == 'users'

    def test_compound_serialization_type_field(self):
        """Test that serialized IR includes the type discriminator."""
        sql = "SELECT a FROM t1 UNION SELECT a FROM t2"
        ir = parse_sql_to_ir(sql)
        dumped = ir.model_dump(by_alias=True)

        assert dumped['type'] == 'compound'
        assert len(dumped['queries']) == 2
        for q in dumped['queries']:
            assert q['type'] == 'simple'
