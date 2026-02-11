"""Unit tests for SQL IR parser."""

import pytest
from sql_ir import parse_sql_to_ir, UnsupportedSQLError, QueryIR
from sql_ir.ir_types import SelectColumn, TableReference, JoinClause, FilterGroup, OrderByClause


class TestBasicSelect:
    """Test basic SELECT queries."""

    def test_select_star(self):
        """Test SELECT *"""
        ir = parse_sql_to_ir("SELECT * FROM users")
        assert len(ir.select) == 1
        assert ir.select[0].column == '*'
        assert ir.select[0].type == 'column'
        assert ir.from_.table == 'users'

    def test_select_columns(self):
        """Test SELECT with specific columns"""
        ir = parse_sql_to_ir("SELECT name, email FROM users")
        assert len(ir.select) == 2
        assert ir.select[0].column == 'name'
        assert ir.select[1].column == 'email'

    def test_select_with_alias(self):
        """Test SELECT with column alias"""
        ir = parse_sql_to_ir("SELECT name AS user_name, email FROM users")
        assert ir.select[0].alias == 'user_name'
        assert ir.select[0].column == 'name'

    def test_select_with_table_qualifier(self):
        """Test SELECT with table.column"""
        ir = parse_sql_to_ir("SELECT users.name, users.email FROM users")
        assert ir.select[0].table == 'users'
        assert ir.select[0].column == 'name'


class TestAggregates:
    """Test aggregate functions."""

    def test_count_star(self):
        """Test COUNT(*)"""
        ir = parse_sql_to_ir("SELECT COUNT(*) FROM users")
        assert len(ir.select) == 1
        assert ir.select[0].type == 'aggregate'
        assert ir.select[0].aggregate == 'COUNT'
        assert ir.select[0].column is None  # COUNT(*) uses None per IR spec

    def test_count_column(self):
        """Test COUNT(column)"""
        ir = parse_sql_to_ir("SELECT COUNT(id) FROM users")
        assert ir.select[0].aggregate == 'COUNT'
        assert ir.select[0].column == 'id'

    def test_count_distinct(self):
        """Test COUNT(DISTINCT column)"""
        ir = parse_sql_to_ir("SELECT COUNT(DISTINCT email) FROM users")
        assert ir.select[0].aggregate == 'COUNT_DISTINCT'
        assert ir.select[0].column == 'email'

    def test_multiple_aggregates(self):
        """Test multiple aggregate functions"""
        ir = parse_sql_to_ir("SELECT COUNT(*), SUM(amount), AVG(amount) FROM orders")
        assert len(ir.select) == 3
        assert ir.select[0].aggregate == 'COUNT'
        assert ir.select[1].aggregate == 'SUM'
        assert ir.select[2].aggregate == 'AVG'

    def test_aggregate_with_alias(self):
        """Test aggregate with alias"""
        ir = parse_sql_to_ir("SELECT COUNT(*) AS total_users FROM users")
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
        ir = parse_sql_to_ir(sql)
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
        ir = parse_sql_to_ir(sql)
        assert ir.joins[0].type == 'LEFT'

    def test_multiple_joins(self):
        """Test multiple JOINs"""
        sql = """
        SELECT *
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        LEFT JOIN products p ON o.product_id = p.id
        """
        ir = parse_sql_to_ir(sql)
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
        ir = parse_sql_to_ir(sql)
        assert len(ir.joins[0].on) == 2


class TestWhere:
    """Test WHERE clauses."""

    def test_simple_where(self):
        """Test simple WHERE condition"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE active = true")
        assert ir.where is not None
        assert ir.where.operator == 'AND'
        assert len(ir.where.conditions) == 1
        cond = ir.where.conditions[0]
        assert cond.column == 'active'
        assert cond.operator == '='

    def test_where_with_parameter(self):
        """Test WHERE with parameter"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE id = :user_id")
        cond = ir.where.conditions[0]
        assert cond.param_name == 'user_id'
        assert cond.value is None

    def test_where_and(self):
        """Test WHERE with AND"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE active = true AND age > 18")
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
            ir = parse_sql_to_ir(sql)
            assert ir.where.conditions[0].operator == expected_op

    def test_where_is_null(self):
        """Test WHERE IS NULL"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE deleted_at IS NULL")
        assert ir.where.conditions[0].operator == 'IS NULL'

    def test_where_is_not_null(self):
        """Test WHERE IS NOT NULL"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE email IS NOT NULL")
        assert ir.where.conditions[0].operator == 'IS NOT NULL'

    def test_where_in(self):
        """Test WHERE IN"""
        ir = parse_sql_to_ir("SELECT * FROM users WHERE status IN ('active', 'pending')")
        cond = ir.where.conditions[0]
        assert cond.operator == 'IN'
        assert isinstance(cond.value, list)
        assert len(cond.value) == 2


class TestGroupBy:
    """Test GROUP BY clauses."""

    def test_simple_group_by(self):
        """Test simple GROUP BY"""
        ir = parse_sql_to_ir("SELECT category, COUNT(*) FROM products GROUP BY category")
        assert ir.group_by is not None
        assert len(ir.group_by.columns) == 1
        assert ir.group_by.columns[0].column == 'category'

    def test_group_by_multiple_columns(self):
        """Test GROUP BY with multiple columns"""
        ir = parse_sql_to_ir("SELECT category, brand, COUNT(*) FROM products GROUP BY category, brand")
        assert len(ir.group_by.columns) == 2

    def test_group_by_with_table_qualifier(self):
        """Test GROUP BY with table.column"""
        ir = parse_sql_to_ir("SELECT p.category FROM products p GROUP BY p.category")
        assert ir.group_by.columns[0].table == 'p'


class TestHaving:
    """Test HAVING clauses."""

    def test_simple_having(self):
        """Test HAVING clause"""
        sql = "SELECT category, COUNT(*) FROM products GROUP BY category HAVING COUNT(*) > 10"
        ir = parse_sql_to_ir(sql)
        assert ir.having is not None
        assert ir.having.operator == 'AND'
        assert len(ir.having.conditions) == 1


class TestOrderBy:
    """Test ORDER BY clauses."""

    def test_simple_order_by(self):
        """Test simple ORDER BY"""
        ir = parse_sql_to_ir("SELECT * FROM users ORDER BY name")
        assert ir.order_by is not None
        assert len(ir.order_by) == 1
        assert ir.order_by[0].column == 'name'
        assert ir.order_by[0].direction == 'ASC'

    def test_order_by_desc(self):
        """Test ORDER BY DESC"""
        ir = parse_sql_to_ir("SELECT * FROM users ORDER BY created_at DESC")
        assert ir.order_by[0].direction == 'DESC'

    def test_order_by_multiple_columns(self):
        """Test ORDER BY with multiple columns"""
        ir = parse_sql_to_ir("SELECT * FROM users ORDER BY last_name ASC, first_name DESC")
        assert len(ir.order_by) == 2
        assert ir.order_by[0].direction == 'ASC'
        assert ir.order_by[1].direction == 'DESC'


class TestLimit:
    """Test LIMIT clause."""

    def test_limit(self):
        """Test LIMIT"""
        ir = parse_sql_to_ir("SELECT * FROM users LIMIT 10")
        assert ir.limit == 10

    def test_no_limit(self):
        """Test query without LIMIT"""
        ir = parse_sql_to_ir("SELECT * FROM users")
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
        ir = parse_sql_to_ir(sql)

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
            parse_sql_to_ir(sql)
        assert "Subqueries" in exc_info.value.features

    def test_cte_rejected(self):
        """Test that CTEs are rejected"""
        sql = "WITH active_users AS (SELECT * FROM users WHERE active = true) SELECT * FROM active_users"
        with pytest.raises(UnsupportedSQLError) as exc_info:
            parse_sql_to_ir(sql)
        assert "WITH clauses (CTEs)" in exc_info.value.features

    def test_union_rejected(self):
        """Test that UNION is rejected"""
        sql = "SELECT * FROM users UNION SELECT * FROM admins"
        with pytest.raises(UnsupportedSQLError) as exc_info:
            parse_sql_to_ir(sql)
        assert "UNION" in exc_info.value.features

    def test_case_rejected(self):
        """Test that CASE expressions are rejected"""
        sql = "SELECT CASE WHEN age > 18 THEN 'adult' ELSE 'minor' END FROM users"
        with pytest.raises(UnsupportedSQLError) as exc_info:
            parse_sql_to_ir(sql)
        assert "CASE expressions" in exc_info.value.features


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_invalid_sql(self):
        """Test handling of invalid SQL"""
        with pytest.raises(UnsupportedSQLError):
            parse_sql_to_ir("INVALID SQL SYNTAX")

    def test_no_from_clause(self):
        """Test handling of query without FROM"""
        with pytest.raises(UnsupportedSQLError):
            parse_sql_to_ir("SELECT 1 + 1")

    def test_schema_qualified_table(self):
        """Test schema.table notation"""
        ir = parse_sql_to_ir("SELECT * FROM public.users")
        assert ir.from_.schema == 'public'
        assert ir.from_.table == 'users'
