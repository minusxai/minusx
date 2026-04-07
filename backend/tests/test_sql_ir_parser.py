"""Unit tests for SQL IR parser."""

import pytest
from sql_ir import parse_sql_to_ir, UnsupportedSQLError, QueryIR
from sql_ir.ir_types import SelectColumn, TableReference, JoinClause, FilterGroup, OrderByClause


class TestBasicSelect:
    """Test basic SELECT queries."""

    def test_select_star(self):
        """Test SELECT *"""
        ir = parse_sql_to_ir("SELECT * FROM users", "duckdb")
        assert len(ir.select) == 1
        assert ir.select[0].column == '*'
        assert ir.select[0].type == 'column'
        assert ir.from_.table == 'users'

    def test_select_columns(self):
        """Test SELECT with specific columns"""
        ir = parse_sql_to_ir("SELECT name, email FROM users", "duckdb")
        assert len(ir.select) == 2
        assert ir.select[0].column == 'name'
        assert ir.select[1].column == 'email'

    def test_select_with_alias(self):
        """Test SELECT with column alias"""
        ir = parse_sql_to_ir("SELECT name AS user_name, email FROM users", "duckdb")
        assert ir.select[0].alias == 'user_name'
        assert ir.select[0].column == 'name'

    def test_select_with_table_qualifier(self):
        """Test SELECT with table.column"""
        ir = parse_sql_to_ir("SELECT users.name, users.email FROM users", "duckdb")
        assert ir.select[0].table == 'users'
        assert ir.select[0].column == 'name'


class TestAggregates:
    """Test aggregate functions."""

    def test_count_star(self):
        """Test COUNT(*)"""
        ir = parse_sql_to_ir("SELECT COUNT(*) FROM users", "duckdb")
        assert len(ir.select) == 1
        assert ir.select[0].type == 'aggregate'
        assert ir.select[0].aggregate == 'COUNT'
        assert ir.select[0].column is None  # COUNT(*) uses None per IR spec

    def test_count_column(self):
        """Test COUNT(column)"""
        ir = parse_sql_to_ir("SELECT COUNT(id) FROM users", "duckdb")
        assert ir.select[0].aggregate == 'COUNT'
        assert ir.select[0].column == 'id'

    def test_count_distinct(self):
        """Test COUNT(DISTINCT column)"""
        ir = parse_sql_to_ir("SELECT COUNT(DISTINCT email) FROM users", "duckdb")
        assert ir.select[0].aggregate == 'COUNT_DISTINCT'
        assert ir.select[0].column == 'email'

    def test_multiple_aggregates(self):
        """Test multiple aggregate functions"""
        ir = parse_sql_to_ir("SELECT COUNT(*), SUM(amount), AVG(amount) FROM orders", "duckdb")
        assert len(ir.select) == 3
        assert ir.select[0].aggregate == 'COUNT'
        assert ir.select[1].aggregate == 'SUM'
        assert ir.select[2].aggregate == 'AVG'

    def test_aggregate_with_alias(self):
        """Test aggregate with alias"""
        ir = parse_sql_to_ir("SELECT COUNT(*) AS total_users FROM users", "duckdb")
        assert ir.select[0].alias == 'total_users'


class TestJoins:
    """Test JOIN clauses."""

    def test_inner_join(self):
        """Test INNER JOIN"""
        sql = """
        SELECT u.name, o.amount
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        """
        ir = parse_sql_to_ir(sql, "duckdb")
        assert ir.joins is not None
        assert len(ir.joins) == 1
        assert ir.joins[0].type == 'INNER'
        assert ir.joins[0].table.table == 'orders'
        assert ir.joins[0].table.alias == 'o'
        assert len(ir.joins[0].on) == 1
        assert ir.joins[0].on[0].left_table == 'u'
        assert ir.joins[0].on[0].left_column == 'id'
        assert ir.joins[0].on[0].right_table == 'o'
        assert ir.joins[0].on[0].right_column == 'user_id'

    def test_left_join(self):
        """Test LEFT JOIN"""
        sql = "SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id"
        ir = parse_sql_to_ir(sql, "duckdb")
        assert ir.joins[0].type == 'LEFT'

    def test_multiple_joins(self):
        """Test multiple JOINs"""
        sql = """
        SELECT *
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        LEFT JOIN products p ON o.product_id = p.id
        """
        ir = parse_sql_to_ir(sql, "duckdb")
        assert len(ir.joins) == 2
        assert ir.joins[0].type == 'INNER'
        assert ir.joins[1].type == 'LEFT'

    def test_join_with_multiple_on_conditions(self):
        """Test JOIN with multiple ON conditions (AND)"""
        sql = """
        SELECT *
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id AND u.company_id = o.company_id
        """
        ir = parse_sql_to_ir(sql, "duckdb")
        assert len(ir.joins[0].on) == 2


class TestWhere:
    """Test WHERE clauses."""

    def test_simple_where(self):
        """Test simple WHERE condition"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE active = true", "duckdb")
        assert ir.where is not None
        assert ir.where.operator == 'AND'
        assert len(ir.where.conditions) == 1
        cond = ir.where.conditions[0]
        assert cond.column == 'active'
        assert cond.operator == '='

    def test_where_with_parameter(self):
        """Test WHERE with parameter"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE id = :user_id", "duckdb")
        cond = ir.where.conditions[0]
        assert cond.param_name == 'user_id'
        assert cond.value is None

    def test_where_and(self):
        """Test WHERE with AND"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE active = true AND age > 18", "duckdb")
        assert len(ir.where.conditions) == 2

    def test_where_operators(self):
        """Test various WHERE operators"""
        test_cases = [
            ("SELECT * FROM users WHERE age > 18", '>'),
            ("SELECT * FROM users WHERE age < 65", '<'),
            ("SELECT * FROM users WHERE age >= 18", '>='),
            ("SELECT * FROM users WHERE age <= 65", '<='),
            ("SELECT * FROM users WHERE age != 25", '!='),
            ("SELECT * FROM users WHERE name LIKE '%John%'", 'LIKE'),
        ]
        for sql, expected_op in test_cases:
            ir = parse_sql_to_ir(sql, "duckdb")
            assert ir.where.conditions[0].operator == expected_op

    def test_where_ilike(self):
        """Test WHERE with ILIKE (case-insensitive LIKE)"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE name ILIKE '%john%'", "duckdb")
        assert ir.where.conditions[0].operator == 'ILIKE'

    def test_where_ilike_with_param(self):
        """Test WHERE ILIKE with a named parameter"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE name ILIKE :search", "duckdb")
        cond = ir.where.conditions[0]
        assert cond.operator == 'ILIKE'
        assert cond.param_name == 'search'

    def test_where_is_null(self):
        """Test WHERE IS NULL"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE deleted_at IS NULL", "duckdb")
        assert ir.where.conditions[0].operator == 'IS NULL'

    def test_where_is_not_null(self):
        """Test WHERE IS NOT NULL"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE email IS NOT NULL", "duckdb")
        assert ir.where.conditions[0].operator == 'IS NOT NULL'

    def test_where_in(self):
        """Test WHERE IN"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE status IN ('active', 'pending')", "duckdb")
        cond = ir.where.conditions[0]
        assert cond.operator == 'IN'
        assert isinstance(cond.value, list)
        assert len(cond.value) == 2


class TestGroupBy:
    """Test GROUP BY clauses."""

    def test_simple_group_by(self):
        """Test simple GROUP BY"""
        ir = parse_sql_to_ir("SELECT category, COUNT(*) FROM products GROUP BY category", "duckdb")
        assert ir.group_by is not None
        assert len(ir.group_by.columns) == 1
        assert ir.group_by.columns[0].column == 'category'

    def test_group_by_multiple_columns(self):
        """Test GROUP BY with multiple columns"""
        ir = parse_sql_to_ir("SELECT category, brand, COUNT(*) FROM products GROUP BY category, brand", "duckdb")
        assert len(ir.group_by.columns) == 2

    def test_group_by_with_table_qualifier(self):
        """Test GROUP BY with table.column"""
        ir = parse_sql_to_ir("SELECT p.category FROM products p GROUP BY p.category", "duckdb")
        assert ir.group_by.columns[0].table == 'p'


class TestHaving:
    """Test HAVING clauses."""

    def test_simple_having(self):
        """Test HAVING clause"""
        sql = "SELECT category, COUNT(*) FROM products GROUP BY category HAVING COUNT(*) > 10"
        ir = parse_sql_to_ir(sql, "duckdb")
        assert ir.having is not None
        assert ir.having.operator == 'AND'
        assert len(ir.having.conditions) == 1


class TestOrderBy:
    """Test ORDER BY clauses."""

    def test_simple_order_by(self):
        """Test simple ORDER BY"""
        ir = parse_sql_to_ir("SELECT * FROM users ORDER BY name", "duckdb")
        assert ir.order_by is not None
        assert len(ir.order_by) == 1
        assert ir.order_by[0].column == 'name'
        assert ir.order_by[0].direction == 'ASC'

    def test_order_by_desc(self):
        """Test ORDER BY DESC"""
        ir = parse_sql_to_ir("SELECT * FROM users ORDER BY created_at DESC", "duckdb")
        assert ir.order_by[0].direction == 'DESC'

    def test_order_by_multiple_columns(self):
        """Test ORDER BY with multiple columns"""
        ir = parse_sql_to_ir("SELECT * FROM users ORDER BY last_name ASC, first_name DESC", "duckdb")
        assert len(ir.order_by) == 2
        assert ir.order_by[0].direction == 'ASC'
        assert ir.order_by[1].direction == 'DESC'


class TestLimit:
    """Test LIMIT clause."""

    def test_limit(self):
        """Test LIMIT"""
        ir = parse_sql_to_ir("SELECT * FROM users LIMIT 10", "duckdb")
        assert ir.limit == 10

    def test_no_limit(self):
        """Test query without LIMIT"""
        ir = parse_sql_to_ir("SELECT * FROM users", "duckdb")
        assert ir.limit is None


class TestComplexQueries:
    """Test complex queries combining multiple features."""

    def test_full_query(self):
        """Test query with all supported features"""
        sql = """
        SELECT
            u.name,
            COUNT(*) AS order_count,
            SUM(o.amount) AS total_amount
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        WHERE u.active = true AND o.status = 'completed'
        GROUP BY u.name
        HAVING COUNT(*) > 5
        ORDER BY total_amount DESC
        LIMIT 20
        """
        ir = parse_sql_to_ir(sql, "duckdb")

        # Verify all components
        assert len(ir.select) == 3
        assert ir.joins is not None
        assert ir.where is not None
        assert ir.group_by is not None
        assert ir.having is not None
        assert ir.order_by is not None
        assert ir.limit == 20


class TestUnsupportedFeatures:
    """Test detection of unsupported SQL features."""

    def test_subquery_rejected(self):
        """Test that subqueries are rejected"""
        sql = "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)"
        with pytest.raises(UnsupportedSQLError) as exc_info:
            parse_sql_to_ir(sql, "duckdb")
        assert "Subqueries" in exc_info.value.features

    def test_cte_supported(self):
        """Test that CTEs are now supported (stored as raw SQL in IR)"""
        sql = "WITH active_users AS (SELECT * FROM users WHERE active = TRUE) SELECT * FROM active_users"
        ir = parse_sql_to_ir(sql, "duckdb")
        assert ir is not None
        assert ir.ctes is not None
        assert len(ir.ctes) == 1
        assert ir.ctes[0].name == "active_users"

    def test_union_supported(self):
        """Test that UNION is now supported (returns CompoundQueryIR)"""
        sql = "SELECT * FROM users UNION SELECT * FROM admins"
        ir = parse_sql_to_ir(sql, "duckdb")
        assert ir is not None
        assert ir.type == 'compound'

    def test_case_supported(self):
        """Test that CASE expressions are now supported (stored as raw SQL in IR)"""
        sql = "SELECT CASE WHEN age > 18 THEN 'adult' ELSE 'minor' END AS age_group FROM users"
        ir = parse_sql_to_ir(sql, "duckdb")
        assert ir is not None
        assert ir.select[0].type == 'raw'
        assert 'CASE' in ir.select[0].raw_sql.upper()


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_invalid_sql(self):
        """Test handling of invalid SQL"""
        with pytest.raises(UnsupportedSQLError):
            parse_sql_to_ir("INVALID SQL SYNTAX", "duckdb")

    def test_no_from_clause(self):
        """Test handling of query without FROM"""
        with pytest.raises(UnsupportedSQLError):
            parse_sql_to_ir("SELECT 1 + 1", "duckdb")

    def test_schema_qualified_table(self):
        """Test schema.table notation"""
        ir = parse_sql_to_ir("SELECT * FROM public.users", "duckdb")
        assert ir.from_.schema == 'public'
        assert ir.from_.table == 'users'


class TestFunctionCallsInWhere:
    """Test WHERE conditions involving function calls with parameters."""

    def test_split_part_with_param(self):
        """Test SPLIT_PART(...) = :param in WHERE — the param should be detected."""
        sql = """
        SELECT release_date, ROUND(AVG(elo), 0) AS avg_elo, MAX(elo) AS max_elo
        FROM chatbot_arena_leaderboard
        WHERE release_date IS NOT NULL
          AND SPLIT_PART(release_date, '-', 1) = :year
        GROUP BY release_date
        ORDER BY release_date ASC
        """
        ir = parse_sql_to_ir(sql, "duckdb")
        assert ir.where is not None
        # Should have 2 conditions: IS NOT NULL and the SPLIT_PART = :year
        assert len(ir.where.conditions) == 2
        # Find the param condition
        param_conds = [c for c in ir.where.conditions if hasattr(c, 'param_name') and c.param_name == 'year']
        assert len(param_conds) == 1, f"Expected param_name='year' in conditions, got: {ir.where.conditions}"

    def test_comparison_with_param_on_expression(self):
        """Test column > :param style condition."""
        sql = """
        SELECT * FROM scores
        WHERE elo > :min_elo
        """
        ir = parse_sql_to_ir(sql, "duckdb")
        assert ir.where is not None
        cond = ir.where.conditions[0]
        assert cond.param_name == 'min_elo'
        assert cond.operator == '>'

    def test_multiple_params_with_function_calls(self):
        """Test query with multiple params, one involving a function call."""
        sql = """
        SELECT release_date, ROUND(AVG(elo), 0) AS avg_elo, MAX(elo) AS max_elo
        FROM chatbot_arena_leaderboard
        WHERE release_date IS NOT NULL
          AND SPLIT_PART(release_date, '-', 1) = :year
          AND elo > :min_elo
        GROUP BY release_date
        ORDER BY release_date ASC
        """
        ir = parse_sql_to_ir(sql, "duckdb")
        assert ir.where is not None
        param_names = [c.param_name for c in ir.where.conditions if hasattr(c, 'param_name') and c.param_name]
        assert 'year' in param_names, f"'year' not found in param_names: {param_names}"
        assert 'min_elo' in param_names, f"'min_elo' not found in param_names: {param_names}"
