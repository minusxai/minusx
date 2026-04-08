"""Tests for SQL syntax validation."""

from sql_utils.validator import validate_sql, _preprocess_query


class TestPreprocessQuery:
    """Tests for same-width preprocessing of :params and @references."""

    def test_preserves_length_with_params(self):
        query = "SELECT * FROM foo WHERE d > :start_date"
        assert len(_preprocess_query(query)) == len(query)

    def test_preserves_length_with_references(self):
        query = "SELECT * FROM @revenue_1 JOIN @costs_2"
        assert len(_preprocess_query(query)) == len(query)

    def test_preserves_length_with_both(self):
        query = "SELECT * FROM @rev_1 WHERE d > :start_date AND n = :x"
        assert len(_preprocess_query(query)) == len(query)

    def test_param_becomes_string_literal(self):
        result = _preprocess_query(":abc")
        assert result.startswith("'")
        assert result.endswith("'")

    def test_short_param(self):
        result = _preprocess_query(":x")
        assert len(result) == 2

    def test_at_replaced_with_underscore(self):
        result = _preprocess_query("@foo")
        assert result == "_foo"

    def test_no_replacement_for_plain_sql(self):
        query = "SELECT id FROM users"
        assert _preprocess_query(query) == query


class TestValidateSql:
    """Generic SQL validation — dialects spread across tests for broad coverage."""

    def test_valid_simple_select_duckdb(self):
        result = validate_sql("SELECT * FROM foo", dialect='duckdb')
        assert result.valid is True
        assert result.errors == []

    def test_valid_simple_select_postgres(self):
        result = validate_sql("SELECT id, name FROM users WHERE active = true", dialect='postgres')
        assert result.valid is True

    def test_valid_simple_select_bigquery(self):
        result = validate_sql("SELECT COUNT(*) AS total FROM orders", dialect='bigquery')
        assert result.valid is True

    def test_empty_query(self):
        result = validate_sql("", dialect='duckdb')
        assert result.valid is True

    def test_whitespace_query(self):
        result = validate_sql("   ", dialect='postgres')
        assert result.valid is True

    def test_invalid_keyword_duckdb(self):
        result = validate_sql("SELEC * FROM foo", dialect='duckdb')
        assert result.valid is False
        assert len(result.errors) > 0

    def test_invalid_keyword_postgres(self):
        result = validate_sql("SELEC * FROM foo", dialect='postgres')
        assert result.valid is False

    def test_invalid_keyword_bigquery(self):
        result = validate_sql("SELEC * FROM foo", dialect='bigquery')
        assert result.valid is False

    def test_error_has_position(self):
        result = validate_sql("SELEC * FROM foo", dialect='duckdb')
        err = result.errors[0]
        assert err.line >= 1
        assert err.col >= 1
        assert err.end_col > err.col

    def test_params_dont_cause_errors_postgres(self):
        result = validate_sql("SELECT * FROM foo WHERE d > :start_date AND n = :name", dialect='postgres')
        assert result.valid is True

    def test_params_dont_cause_errors_bigquery(self):
        result = validate_sql("SELECT * FROM foo WHERE amount > :min_amount", dialect='bigquery')
        assert result.valid is True

    def test_references_dont_cause_errors(self):
        result = validate_sql("SELECT * FROM @revenue_1 r JOIN @costs_2 c ON r.id = c.id", dialect='duckdb')
        assert result.valid is True

    def test_mixed_params_and_references(self):
        result = validate_sql("SELECT * FROM @rev_1 WHERE d > :start_date", dialect='postgres')
        assert result.valid is True

    def test_multi_statement(self):
        result = validate_sql("SELECT 1; SELECT 2", dialect='duckdb')
        assert result.valid is True

    def test_error_positions_not_shifted_by_params(self):
        result = validate_sql("SELECT * FROM foo WHERE :start_date BETWEEN AND", dialect='postgres')
        assert result.valid is False
        assert result.errors[0].line == 1

    # --- Dialect-specific syntax ---

    def test_duckdb_read_csv(self):
        """DuckDB-specific: read_csv table function."""
        result = validate_sql("SELECT * FROM read_csv('file.csv')", dialect='duckdb')
        assert result.valid is True

    def test_duckdb_list_literal(self):
        """DuckDB-specific: array/list literals."""
        result = validate_sql("SELECT [1, 2, 3] AS nums", dialect='duckdb')
        assert result.valid is True

    def test_bigquery_backtick_table(self):
        """BigQuery-specific: backtick-quoted table names."""
        result = validate_sql("SELECT * FROM `project.dataset.table`", dialect='bigquery')
        assert result.valid is True

    def test_bigquery_struct(self):
        """BigQuery-specific: STRUCT literals."""
        result = validate_sql("SELECT STRUCT(1 AS a, 'foo' AS b) AS s", dialect='bigquery')
        assert result.valid is True

    def test_postgres_dollar_quoting(self):
        """Postgres-specific: dollar-quoted strings."""
        result = validate_sql("SELECT $$hello world$$ AS greeting", dialect='postgres')
        assert result.valid is True

    # --- Multiline SQL with errors ---

    def test_multiline_missing_from(self):
        result = validate_sql("""\
SELECT
    u.id,
    u.name,
    o.total
JION orders o ON o.user_id = u.id
WHERE u.active = true
""", dialect='duckdb')
        assert result.valid is False
        assert len(result.errors) > 0

    def test_multiline_unclosed_subquery(self):
        result = validate_sql("""\
SELECT *
FROM (
    SELECT id, name
    FROM users
    WHERE active = true

WHERE id > 10
""", dialect='postgres')
        assert result.valid is False
        assert len(result.errors) > 0

    def test_multiline_error_reports_correct_line(self):
        result = validate_sql("SELECT id\nFROM users\nWHERE id >\nORDER BY", dialect='bigquery')
        assert result.valid is False
        err = result.errors[0]
        assert err.line > 1

    def test_multiline_cte_with_typo(self):
        result = validate_sql("""\
WITH monthly_revenue AS (
    SELECT
        DATE_TRUNC('month', created_at) AS month,
        SUM(amount) AS revenue
    FROM orders
    GRUOP BY 1
)
SELECT *
FROM monthly_revenue
ORDER BY month
""", dialect='duckdb')
        assert result.valid is False
        assert len(result.errors) > 0

    def test_multiline_double_where(self):
        result = validate_sql("""\
SELECT
    u.name,
    o.total
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.active = true
WHERE o.created_at > '2024-01-01'
""", dialect='postgres')
        assert result.valid is False
        assert len(result.errors) > 0

    def test_multiline_valid_complex_query(self):
        result = validate_sql("""\
WITH active_users AS (
    SELECT id, name, email
    FROM users
    WHERE active = true
),
user_orders AS (
    SELECT
        u.id,
        u.name,
        COUNT(o.id) AS order_count,
        SUM(o.total) AS total_spent
    FROM active_users u
    LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id, u.name
)
SELECT
    name,
    order_count,
    total_spent,
    CASE
        WHEN total_spent > 1000 THEN 'high'
        WHEN total_spent > 100 THEN 'medium'
        ELSE 'low'
    END AS tier
FROM user_orders
ORDER BY total_spent DESC
LIMIT 50
""", dialect='bigquery')
        assert result.valid is True

    def test_multiline_with_params_and_references(self):
        result = validate_sql("""\
SELECT
    r.month,
    r.revenue,
    c.cost,
    r.revenue - c.cost AS profit
FROM @revenue_by_month_1 r
JOIN @costs_by_month_2 c ON c.month = r.month
WHERE r.month >= :start_date
    AND r.month <= :end_date
ORDER BY r.month
""", dialect='duckdb')
        assert result.valid is True

    def test_multiline_mismatched_parens(self):
        result = validate_sql("""\
SELECT
    id,
    name,
    (CASE WHEN active THEN 'yes' ELSE 'no' AS status
FROM users
""", dialect='postgres')
        assert result.valid is False
        assert len(result.errors) > 0
