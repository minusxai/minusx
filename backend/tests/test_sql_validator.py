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
        """Even a 2-char param like :x should produce a valid same-length replacement."""
        result = _preprocess_query(":x")
        assert len(result) == 2

    def test_at_replaced_with_underscore(self):
        result = _preprocess_query("@foo")
        assert result == "_foo"

    def test_no_replacement_for_plain_sql(self):
        query = "SELECT id FROM users"
        assert _preprocess_query(query) == query


class TestValidateSql:
    """Tests for SQL validation via sqlglot."""

    def test_valid_simple_select(self):
        result = validate_sql("SELECT * FROM foo")
        assert result.valid is True
        assert result.errors == []

    def test_empty_query(self):
        result = validate_sql("")
        assert result.valid is True

    def test_whitespace_query(self):
        result = validate_sql("   ")
        assert result.valid is True

    def test_invalid_keyword(self):
        result = validate_sql("SELEC * FROM foo")
        assert result.valid is False
        assert len(result.errors) > 0

    def test_error_has_position(self):
        result = validate_sql("SELEC * FROM foo")
        err = result.errors[0]
        assert err.line >= 1
        assert err.col >= 1
        assert err.end_col > err.col

    def test_params_dont_cause_errors(self):
        result = validate_sql("SELECT * FROM foo WHERE d > :start_date AND n = :name")
        assert result.valid is True

    def test_references_dont_cause_errors(self):
        result = validate_sql("SELECT * FROM @revenue_1 r JOIN @costs_2 c ON r.id = c.id")
        assert result.valid is True

    def test_mixed_params_and_references(self):
        result = validate_sql("SELECT * FROM @rev_1 WHERE d > :start_date")
        assert result.valid is True

    def test_multi_statement(self):
        result = validate_sql("SELECT 1; SELECT 2")
        assert result.valid is True

    def test_dialect_duckdb(self):
        result = validate_sql("SELECT * FROM read_csv('file.csv')", dialect="duckdb")
        assert result.valid is True

    def test_dialect_bigquery(self):
        result = validate_sql("SELECT * FROM `project.dataset.table`", dialect="bigquery")
        assert result.valid is True

    def test_error_positions_not_shifted_by_params(self):
        """Column positions should map to the original query, not the preprocessed one."""
        # Put a syntax error after a param — if preprocessing shifted columns, positions would be off
        result = validate_sql("SELECT * FROM foo WHERE :start_date BETWEEN AND")
        assert result.valid is False
        assert result.errors[0].line == 1
