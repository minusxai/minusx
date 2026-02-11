"""
E2E Tests for Python Autocomplete API (Phase 1)
Tests the core sqlglot-based autocomplete engine independently.
"""

import pytest
from autocomplete import get_completions


def test_column_completion_filtered_by_tables_in_scope():
    """
    Given: Query with FROM clause
    When: Cursor is after SELECT
    Then: Only show columns from tables in FROM/JOIN
    """
    schema_data = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "users",
                            "columns": [
                                {"name": "id", "type": "int"},
                                {"name": "email", "type": "varchar"}
                            ]
                        },
                        {
                            "table": "orders",
                            "columns": [
                                {"name": "id", "type": "int"},
                                {"name": "user_id", "type": "int"},
                                {"name": "total", "type": "decimal"}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    # Test case: FROM users only
    query = "SELECT  FROM users"
    cursor_offset = 7  # After "SELECT "

    suggestions = get_completions(query, cursor_offset, schema_data)

    # Should only show users columns, not orders columns
    column_names = [s.label for s in suggestions]
    assert "id" in column_names
    assert "email" in column_names
    assert "user_id" not in column_names  # From orders table
    assert "total" not in column_names    # From orders table


def test_cte_column_inference():
    """
    Given: Query with CTE that has explicit column list
    When: Cursor is after SELECT in main query
    Then: Show columns from CTE (inferred from SELECT)
    """
    query = """
    WITH revenue AS (
      SELECT user_id, SUM(amount) as total_revenue
      FROM orders
      GROUP BY user_id
    )
    SELECT  FROM revenue
    """
    cursor_offset = query.find("SELECT  FROM revenue") + 7

    schema_data = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "orders",
                            "columns": [
                                {"name": "user_id", "type": "int"},
                                {"name": "amount", "type": "decimal"},
                                {"name": "order_id", "type": "int"}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    suggestions = get_completions(query, cursor_offset, schema_data)

    column_names = [s.label for s in suggestions]
    assert "user_id" in column_names
    assert "total_revenue" in column_names
    # Should NOT show original orders columns (except user_id which is in CTE)
    assert "amount" not in column_names
    assert "order_id" not in column_names


def test_alias_resolution_with_joins():
    """
    Given: Query with table aliases and JOIN
    When: Using dot notation with alias (e.g., u.id)
    Then: Resolve alias and show correct columns
    """
    query = """
    SELECT u.id, o.total
    FROM users AS u
    JOIN orders AS o ON u.id = o.user_id
    """
    cursor_offset = query.find("u.i") + 2  # After "u." before "id"

    schema_data = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "users",
                            "columns": [
                                {"name": "id", "type": "int"},
                                {"name": "email", "type": "varchar"},
                                {"name": "name", "type": "varchar"}
                            ]
                        },
                        {
                            "table": "orders",
                            "columns": [
                                {"name": "id", "type": "int"},
                                {"name": "user_id", "type": "int"},
                                {"name": "total", "type": "decimal"}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    suggestions = get_completions(query, cursor_offset, schema_data)

    # Should resolve u -> users and show users columns
    column_names = [s.label for s in suggestions]
    assert "id" in column_names
    assert "email" in column_names
    assert "name" in column_names
    # Should NOT show orders columns here
    assert "total" not in column_names
    assert "user_id" not in column_names


def test_prefix_filtering_handled_by_frontend():
    """
    Given: Query "SELECT us FROM users" with cursor after "us"
    When: Backend receives request
    Then: Backend returns ALL columns (Monaco filters on frontend)

    This verifies backend doesn't do premature filtering - it returns
    all valid columns for the context, and Monaco will filter by prefix.
    """
    schema_data = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "users",
                            "columns": [
                                {"name": "id", "type": "int"},
                                {"name": "username", "type": "varchar"},
                                {"name": "user_email", "type": "varchar"},
                                {"name": "created_at", "type": "timestamp"}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    # User types "SELECT us" with cursor after "us"
    query = "SELECT us FROM users"
    cursor_offset = 9  # After "us"

    suggestions = get_completions(query, cursor_offset, schema_data)

    # Backend should return ALL columns from users table
    # It does NOT filter by "us" prefix - Monaco handles that
    column_names = [s.label for s in suggestions]

    # Should include columns starting with "us"
    assert "username" in column_names
    assert "user_email" in column_names

    # Should ALSO include columns NOT starting with "us"
    # (Monaco will filter these out, but backend returns them)
    assert "id" in column_names
    assert "created_at" in column_names

    # Verify all 4 columns are returned
    assert len(column_names) == 4


def test_incomplete_sql_shows_columns_not_keywords():
    """
    Given: Incomplete query "SELECT " (just SELECT with space)
    When: Cursor is after the space
    Then: Should show columns, NOT keywords (avoid SELECT showing SELECT)

    This prevents the confusing UX where typing SELECT shows SELECT
    as a suggestion, which would create "SELECT SELECT" if clicked.
    """
    schema_data = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "users",
                            "columns": [
                                {"name": "id", "type": "int"},
                                {"name": "username", "type": "varchar"},
                                {"name": "email", "type": "varchar"}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    # Incomplete query - just "SELECT " with space
    query = "SELECT "
    cursor_offset = 7  # After the space

    suggestions = get_completions(query, cursor_offset, schema_data)

    # Should return columns (not keywords)
    column_names = [s.label for s in suggestions]

    # Must have columns
    assert "id" in column_names
    assert "username" in column_names
    assert "email" in column_names

    # Should NOT have SELECT keyword (would be confusing)
    assert "SELECT" not in column_names


def test_schema_name_autocomplete():
    """
    Given: Query "SELECT * FROM " (cursor after FROM)
    When: Multiple schemas exist
    Then: Should show both schema names AND table names

    For BigQuery and other databases, users need to be able to type schema names.
    This test ensures schema names appear in table completion context.
    """
    schema_data = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "users",
                            "columns": [
                                {"name": "id", "type": "int"},
                                {"name": "email", "type": "varchar"}
                            ]
                        }
                    ]
                },
                {
                    "schema": "analytics",
                    "tables": [
                        {
                            "table": "events",
                            "columns": [
                                {"name": "event_id", "type": "int"},
                                {"name": "user_id", "type": "int"}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    query = "SELECT * FROM "
    cursor_offset = 14  # After "FROM "

    suggestions = get_completions(query, cursor_offset, schema_data)

    labels = [s.label for s in suggestions]
    kinds = {s.label: s.kind for s in suggestions}

    # Should show schema names
    assert "public" in labels
    assert "analytics" in labels
    assert kinds["public"] == "schema"
    assert kinds["analytics"] == "schema"

    # Should also show tables (for convenience)
    assert "users" in labels
    assert "events" in labels


def test_schema_dot_table_autocomplete():
    """
    Given: Query "SELECT * FROM public." (cursor after dot)
    When: User types schema name followed by dot
    Then: Show only tables from that schema

    This handles qualified table names (schema.table) which are required
    for BigQuery and useful for disambiguating tables across schemas.
    """
    schema_data = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "users",
                            "columns": [
                                {"name": "id", "type": "int"},
                                {"name": "email", "type": "varchar"}
                            ]
                        },
                        {
                            "table": "orders",
                            "columns": [
                                {"name": "order_id", "type": "int"},
                                {"name": "total", "type": "decimal"}
                            ]
                        }
                    ]
                },
                {
                    "schema": "analytics",
                    "tables": [
                        {
                            "table": "events",
                            "columns": [
                                {"name": "event_id", "type": "int"}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    query = "SELECT * FROM public."
    cursor_offset = 21  # After "public."

    suggestions = get_completions(query, cursor_offset, schema_data)

    labels = [s.label for s in suggestions]

    # Should show only tables from 'public' schema
    assert "users" in labels
    assert "orders" in labels

    # Should NOT show tables from other schemas
    assert "events" not in labels

    # Should NOT show schema names here (already specified schema)
    assert "public" not in labels
    assert "analytics" not in labels
