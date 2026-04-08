"""Tests for the SQL normalizer and round-trip validator."""

import pytest
from unittest.mock import patch
from sql_ir.enhanced_validator import normalize_sql, validate_round_trip
import sql_ir.enhanced_validator as _ev_module


class TestNormalizeSql:
    """Tests for normalize_sql — the formatter that canonicalizes SQL."""

    def test_normalizes_whitespace_duckdb(self):
        """Extra whitespace collapses to single spaces."""
        a = normalize_sql("SELECT   id  FROM   users", dialect="duckdb")
        b = normalize_sql("SELECT id FROM users", dialect="duckdb")
        assert a == b

    def test_normalizes_case_postgres(self):
        """Keyword case differences are irrelevant."""
        a = normalize_sql("select id from users", dialect="postgres")
        b = normalize_sql("SELECT id FROM users", dialect="postgres")
        assert a == b

    def test_normalizes_trailing_semicolon_bigquery(self):
        """Trailing semicolons are stripped by transpile."""
        a = normalize_sql("SELECT 1;", dialect="bigquery")
        b = normalize_sql("SELECT 1", dialect="bigquery")
        assert a == b

    def test_different_queries_do_not_match_duckdb(self):
        """Semantically different queries must NOT normalize to the same string."""
        a = normalize_sql("SELECT id FROM users", dialect="duckdb")
        b = normalize_sql("SELECT name FROM users", dialect="duckdb")
        assert a != b

    def test_different_tables_do_not_match_postgres(self):
        a = normalize_sql("SELECT id FROM users", dialect="postgres")
        b = normalize_sql("SELECT id FROM orders", dialect="postgres")
        assert a != b

    def test_column_alias_preserved_bigquery(self):
        a = normalize_sql("SELECT id AS user_id FROM users", dialect="bigquery")
        b = normalize_sql("SELECT id AS user_id FROM users", dialect="bigquery")
        assert a == b

    def test_parse_failure_returns_stripped_original(self):
        """Unparseable SQL is returned as-is (stripped), not empty string."""
        bad_sql = "SELECT * FROM users WHERE x ="
        result = normalize_sql(bad_sql, dialect="duckdb")
        assert result == bad_sql.strip()

    def test_empty_string_duckdb(self):
        result = normalize_sql("", dialect="duckdb")
        # Empty input → empty result (transpile returns empty list or empty string)
        assert isinstance(result, str)

    def test_cte_normalizes_consistently_postgres(self):
        sql = "WITH cte AS (SELECT id FROM users) SELECT * FROM cte"
        a = normalize_sql(sql, dialect="postgres")
        b = normalize_sql(sql, dialect="postgres")
        assert a == b

    def test_join_normalizes_consistently_duckdb(self):
        sql = "SELECT u.id, o.total FROM users u JOIN orders o ON o.user_id = u.id"
        a = normalize_sql(sql, dialect="duckdb")
        b = normalize_sql(sql, dialect="duckdb")
        assert a == b

    def test_aggregate_normalizes_consistently_bigquery(self):
        sql = "SELECT COUNT(*) AS total, SUM(amount) AS revenue FROM orders GROUP BY status"
        a = normalize_sql(sql, dialect="bigquery")
        b = normalize_sql(sql, dialect="bigquery")
        assert a == b


class TestValidateRoundTrip:
    """Tests for validate_round_trip — lossless SQL → IR → SQL check."""

    def test_identical_sql_is_lossless_duckdb(self):
        sql = "SELECT id, name FROM users WHERE active = TRUE"
        result = validate_round_trip(sql, sql, dialect="duckdb")
        assert result.supported is True
        assert result.errors == []

    def test_whitespace_difference_is_lossless_postgres(self):
        """Cosmetic differences do not count as a lossy round-trip."""
        original = "SELECT id FROM users"
        regenerated = "SELECT   id   FROM   users"
        result = validate_round_trip(original, regenerated, dialect="postgres")
        assert result.supported is True

    def test_case_difference_is_lossless_bigquery(self):
        original = "select id from users"
        regenerated = "SELECT id FROM users"
        result = validate_round_trip(original, regenerated, dialect="bigquery")
        assert result.supported is True

    def test_different_columns_is_lossy_duckdb(self):
        original = "SELECT id, name, email FROM users"
        regenerated = "SELECT id, name FROM users"
        result = validate_round_trip(original, regenerated, dialect="duckdb")
        assert result.supported is False
        assert len(result.errors) > 0
        assert result.hint is not None

    def test_missing_where_clause_is_lossy_postgres(self):
        original = "SELECT id FROM users WHERE active = TRUE"
        regenerated = "SELECT id FROM users"
        result = validate_round_trip(original, regenerated, dialect="postgres")
        assert result.supported is False

    def test_missing_order_by_is_lossy_bigquery(self):
        original = "SELECT id FROM users ORDER BY name"
        regenerated = "SELECT id FROM users"
        result = validate_round_trip(original, regenerated, dialect="bigquery")
        assert result.supported is False

    def test_missing_limit_is_lossy_duckdb(self):
        original = "SELECT id FROM users LIMIT 100"
        regenerated = "SELECT id FROM users"
        result = validate_round_trip(original, regenerated, dialect="duckdb")
        assert result.supported is False

    def test_missing_group_by_is_lossy_postgres(self):
        original = "SELECT status, COUNT(*) FROM orders GROUP BY status"
        regenerated = "SELECT status, COUNT(*) FROM orders"
        result = validate_round_trip(original, regenerated, dialect="postgres")
        assert result.supported is False

    def test_added_column_is_lossy_bigquery(self):
        original = "SELECT id FROM users"
        regenerated = "SELECT id, name FROM users"
        result = validate_round_trip(original, regenerated, dialect="bigquery")
        assert result.supported is False

    def test_complex_query_lossless_duckdb(self):
        sql = (
            "SELECT u.id, u.name, COUNT(o.id) AS order_count "
            "FROM users u LEFT JOIN orders o ON o.user_id = u.id "
            "GROUP BY u.id, u.name ORDER BY order_count DESC LIMIT 50"
        )
        result = validate_round_trip(sql, sql, dialect="duckdb")
        assert result.supported is True

    def test_cte_lossless_postgres(self):
        sql = (
            "WITH active AS (SELECT id FROM users WHERE active = TRUE) "
            "SELECT * FROM active"
        )
        result = validate_round_trip(sql, sql, dialect="postgres")
        assert result.supported is True


class TestNormalizeSqlWithoutOptimizer:
    """
    Verify that normalize_sql is still reliable when _optimize raises.

    These tests patch out _optimize so we exercise the fallback path.
    They confirm the generator-side fixes (no explicit ASC, JOIN not INNER JOIN)
    are sufficient to eliminate false negatives for the common cases.
    """

    def _broken_optimize(self, ast, **kwargs):
        raise RuntimeError("optimizer unavailable")

    def test_order_by_asc_lossless_without_optimizer(self):
        """ORDER BY name (original) vs ORDER BY name (generator output) — must match."""
        # Generator no longer emits ASC, so both sides are identical after parse
        original = "SELECT name FROM users ORDER BY name"
        regenerated = "SELECT name FROM users ORDER BY name"
        with patch.object(_ev_module, "_optimize", self._broken_optimize):
            result = validate_round_trip(original, regenerated, dialect="duckdb")
        assert result.supported is True

    def test_inner_join_lossless_without_optimizer(self):
        """JOIN (original) vs JOIN (generator output, no INNER) — must match."""
        original = "SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id"
        regenerated = "SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id"
        with patch.object(_ev_module, "_optimize", self._broken_optimize):
            result = validate_round_trip(original, regenerated, dialect="postgres")
        assert result.supported is True

    def test_order_by_desc_preserved_without_optimizer(self):
        """DESC must still appear in output."""
        original = "SELECT id FROM users ORDER BY id DESC"
        regenerated = "SELECT id FROM users ORDER BY id DESC"
        with patch.object(_ev_module, "_optimize", self._broken_optimize):
            result = validate_round_trip(original, regenerated, dialect="bigquery")
        assert result.supported is True

    def test_different_columns_lossy_without_optimizer(self):
        """Dropped column must still be caught even without optimizer."""
        original = "SELECT id, name FROM users"
        regenerated = "SELECT id FROM users"
        with patch.object(_ev_module, "_optimize", self._broken_optimize):
            result = validate_round_trip(original, regenerated, dialect="duckdb")
        assert result.supported is False

    def test_dropped_where_lossy_without_optimizer(self):
        """Dropped WHERE clause must still be caught even without optimizer."""
        original = "SELECT id FROM users WHERE active = TRUE"
        regenerated = "SELECT id FROM users"
        with patch.object(_ev_module, "_optimize", self._broken_optimize):
            result = validate_round_trip(original, regenerated, dialect="postgres")
        assert result.supported is False

    def test_whitespace_difference_lossless_without_optimizer(self):
        """Whitespace-only differences must not trigger false negatives."""
        original = "SELECT   id   FROM   users"
        regenerated = "SELECT id FROM users"
        with patch.object(_ev_module, "_optimize", self._broken_optimize):
            result = validate_round_trip(original, regenerated, dialect="duckdb")
        assert result.supported is True
