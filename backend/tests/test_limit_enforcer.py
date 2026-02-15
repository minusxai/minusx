"""Tests for SQL query limit enforcement."""

import pytest
from sql_utils.limit_enforcer import enforce_query_limit


def test_no_limit_adds_default():
    """Query without LIMIT should get default limit added."""
    sql = "SELECT * FROM users"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT 1000" in result


def test_existing_limit_under_max():
    """Query with LIMIT under max should be preserved."""
    sql = "SELECT * FROM users LIMIT 500"
    result = enforce_query_limit(sql, max_limit=10000)
    assert "LIMIT 500" in result


def test_existing_limit_over_max():
    """Query with LIMIT over max should be capped."""
    sql = "SELECT * FROM users LIMIT 50000"
    result = enforce_query_limit(sql, max_limit=10000)
    assert "LIMIT 10000" in result
    assert "LIMIT 50000" not in result


def test_limit_with_offset():
    """LIMIT with OFFSET should preserve OFFSET."""
    sql = "SELECT * FROM users LIMIT 5000 OFFSET 100"
    result = enforce_query_limit(sql, max_limit=10000)
    assert "LIMIT 5000" in result
    assert "OFFSET 100" in result


def test_limit_over_max_with_offset():
    """LIMIT over max with OFFSET should cap limit but preserve offset."""
    sql = "SELECT * FROM users LIMIT 50000 OFFSET 100"
    result = enforce_query_limit(sql, max_limit=10000)
    assert "LIMIT 10000" in result
    assert "OFFSET 100" in result


def test_subquery_limit_ignored():
    """Inner subquery limits should be preserved, outer query gets limit."""
    sql = "SELECT * FROM (SELECT * FROM users LIMIT 100) sub"
    result = enforce_query_limit(sql, default_limit=1000)
    # Both inner LIMIT 100 and outer LIMIT 1000 should exist
    assert "LIMIT 100" in result
    assert "LIMIT 1000" in result


def test_cte_with_limit():
    """CTE with limit should be preserved, outer SELECT gets limit."""
    sql = """
    WITH top_users AS (
        SELECT * FROM users LIMIT 50
    )
    SELECT * FROM top_users
    """
    result = enforce_query_limit(sql, default_limit=1000)
    # CTE limit preserved, outer SELECT gets limit
    assert "LIMIT 50" in result
    assert "LIMIT 1000" in result


def test_union_queries():
    """UNION queries should get limit on the combined result."""
    sql = "SELECT * FROM users UNION SELECT * FROM admins"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT 1000" in result


def test_union_with_existing_limit():
    """UNION with existing limit should be capped if needed."""
    sql = "SELECT * FROM users UNION SELECT * FROM admins LIMIT 50000"
    result = enforce_query_limit(sql, max_limit=10000)
    assert "LIMIT 10000" in result
    assert "LIMIT 50000" not in result


def test_parse_error_returns_original():
    """Invalid SQL should return original query unmodified."""
    sql = "SELECT * FROM users WHERE x = "  # Invalid SQL
    result = enforce_query_limit(sql, default_limit=1000)
    assert result == sql  # Original SQL returned unmodified


def test_insert_query_no_limit():
    """INSERT queries should not get LIMIT clauses."""
    sql = "INSERT INTO users (name) VALUES ('Alice')"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT" not in result
    assert result == sql


def test_update_query_no_limit():
    """UPDATE queries should not get LIMIT clauses."""
    sql = "UPDATE users SET name = 'Bob' WHERE id = 1"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT" not in result
    assert result == sql


def test_delete_query_no_limit():
    """DELETE queries should not get LIMIT clauses."""
    sql = "DELETE FROM users WHERE id = 1"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT" not in result
    assert result == sql


def test_create_table_no_limit():
    """CREATE TABLE queries should not get LIMIT clauses."""
    sql = "CREATE TABLE users (id INTEGER, name TEXT)"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT" not in result
    assert result == sql


def test_case_insensitive_keywords():
    """Keywords in different cases should be handled correctly."""
    sql = "select * from users"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT 1000" in result.upper()


def test_multiple_unions():
    """Multiple UNION queries should get limit on the combined result."""
    sql = "SELECT * FROM users UNION SELECT * FROM admins UNION SELECT * FROM guests"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT 1000" in result


def test_intersect_queries():
    """INTERSECT queries should get limit on the result."""
    sql = "SELECT * FROM users INTERSECT SELECT * FROM admins"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT 1000" in result


def test_except_queries():
    """EXCEPT queries should get limit on the result."""
    sql = "SELECT * FROM users EXCEPT SELECT * FROM admins"
    result = enforce_query_limit(sql, default_limit=1000)
    assert "LIMIT 1000" in result


def test_nested_subqueries():
    """Nested subqueries should only add limit to outermost query."""
    sql = "SELECT * FROM (SELECT * FROM (SELECT * FROM users) a) b"
    result = enforce_query_limit(sql, default_limit=1000)
    # Should only have one LIMIT (on the outermost query)
    assert result.count("LIMIT") == 1
    assert "LIMIT 1000" in result


def test_different_dialects_postgres():
    """Test with PostgreSQL dialect."""
    sql = "SELECT * FROM users"
    result = enforce_query_limit(sql, default_limit=1000, dialect="postgres")
    assert "LIMIT 1000" in result


def test_different_dialects_duckdb():
    """Test with DuckDB dialect."""
    sql = "SELECT * FROM users"
    result = enforce_query_limit(sql, default_limit=1000, dialect="duckdb")
    assert "LIMIT 1000" in result


def test_different_dialects_bigquery():
    """Test with BigQuery dialect."""
    sql = "SELECT * FROM users"
    result = enforce_query_limit(sql, default_limit=1000, dialect="bigquery")
    assert "LIMIT 1000" in result
