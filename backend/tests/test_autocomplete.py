"""
E2E Tests for Python Autocomplete API (Phase 1)
Tests the core sqlglot-based autocomplete engine independently.
"""

import pytest
from sql_utils.autocomplete import get_completions


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


def test_where_clause_filters_to_from_table_only():
    """
    Given: Query with COUNT(DISTINCT ...) FROM stores WHERE (user's exact case)
    When: Cursor is after WHERE
    Then: Only stores columns appear, not columns from other tables

    Regression test for the 'from_' key bug in extract_tables_in_scope.
    """
    schema_data = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "stores",
                            "columns": [
                                {"name": "id", "type": "int"},
                                {"name": "store_name", "type": "varchar"},
                                {"name": "region", "type": "varchar"},
                            ]
                        },
                        {
                            "table": "users",
                            "columns": [
                                {"name": "user_id", "type": "int"},
                                {"name": "email", "type": "varchar"},
                                {"name": "signup_date", "type": "date"},
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    query = "SELECT COUNT(DISTINCT id) AS total_users FROM stores WHERE "
    cursor_offset = len(query)

    suggestions = get_completions(query, cursor_offset, schema_data)
    column_names = [s.label for s in suggestions]

    # Should show stores columns
    assert "id" in column_names
    assert "store_name" in column_names
    assert "region" in column_names

    # Must NOT show users columns
    assert "user_id" not in column_names
    assert "email" not in column_names
    assert "signup_date" not in column_names


def test_join_query_shows_columns_from_both_joined_tables_only():
    """
    Given: Query with FROM users JOIN orders (products not joined)
    When: Cursor is in SELECT context
    Then: Columns from users and orders appear, products columns do not

    Regression test for the 'joins' arg collection in extract_tables_in_scope.
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
                                {"name": "user_id", "type": "int"},
                                {"name": "email", "type": "varchar"},
                            ]
                        },
                        {
                            "table": "orders",
                            "columns": [
                                {"name": "order_id", "type": "int"},
                                {"name": "amount", "type": "decimal"},
                            ]
                        },
                        {
                            "table": "products",
                            "columns": [
                                {"name": "product_id", "type": "int"},
                                {"name": "price", "type": "decimal"},
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    query = "SELECT  FROM users JOIN orders ON users.user_id = orders.order_id"
    cursor_offset = 7  # After "SELECT "

    suggestions = get_completions(query, cursor_offset, schema_data)
    column_names = [s.label for s in suggestions]

    # Both joined tables should be in scope
    assert "user_id" in column_names
    assert "email" in column_names
    assert "order_id" in column_names
    assert "amount" in column_names

    # Unjoined table must not appear
    assert "product_id" not in column_names
    assert "price" not in column_names


def test_parse_failure_fallback_filters_by_from_table():
    """
    Given: A query that sqlglot cannot parse (malformed/truncated)
    When: The raw text still contains a recognizable FROM <table>
    Then: Only columns from that table are returned, not all columns

    Regression test for the unfiltered fallback in the except branch.
    """
    schema_data = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "stores",
                            "columns": [
                                {"name": "store_id", "type": "int"},
                                {"name": "store_name", "type": "varchar"},
                            ]
                        },
                        {
                            "table": "users",
                            "columns": [
                                {"name": "user_id", "type": "int"},
                                {"name": "email", "type": "varchar"},
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    # Truncated mid-expression — forces sqlglot parse failure
    query = "SELECT COUNT(DISTINCT FROM stores WHERE "
    cursor_offset = len(query)

    suggestions = get_completions(query, cursor_offset, schema_data)
    column_names = [s.label for s in suggestions]

    # Should show stores columns via regex fallback
    assert "store_id" in column_names
    assert "store_name" in column_names

    # Must NOT show users columns even though parse failed
    assert "user_id" not in column_names
    assert "email" not in column_names


def test_where_context_simple_two_table_schema():
    """
    Given: Schema with users and stores, query is FROM stores WHERE
    When: Cursor is after WHERE
    Then: Only stores columns appear

    Simple regression test with no aggregates — minimum viable case
    for the 'from_' key bug.
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
                                {"name": "user_id", "type": "int"},
                                {"name": "username", "type": "varchar"},
                                {"name": "email", "type": "varchar"},
                            ]
                        },
                        {
                            "table": "stores",
                            "columns": [
                                {"name": "store_id", "type": "int"},
                                {"name": "store_name", "type": "varchar"},
                                {"name": "region", "type": "varchar"},
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    query = "SELECT * FROM stores WHERE "
    cursor_offset = len(query)

    suggestions = get_completions(query, cursor_offset, schema_data)
    column_names = [s.label for s in suggestions]

    # Only stores columns
    assert "store_id" in column_names
    assert "store_name" in column_names
    assert "region" in column_names

    # No users columns
    assert "user_id" not in column_names
    assert "username" not in column_names
    assert "email" not in column_names


def test_select_aliases_available_for_order_by():
    """
    Regression: ORDER BY completion with a complex DuckDB aggregation query.

    Uses the exact schema and query from a real user report where
    {"suggestions":[]} was returned despite schema_data being populated.

    The aliases (batch_year, season, active, etc.) are defined in the SELECT
    clause and must always appear in ORDER BY suggestions — they are extracted
    from the AST and require no schema lookup.

    Connection type is 'csv', which maps to the DuckDB dialect internally.
    """
    # Exact schema from the reported payload
    yc_schema = [{
        "databaseName": "yc_companies",
        "schemas": [{
            "schema": "main",
            "tables": [{
                "table": "t_2024_05_11_yc_companies",
                "columns": [
                    {"name": "company_id",       "type": "BIGINT"},
                    {"name": "company_name",      "type": "VARCHAR"},
                    {"name": "short_description", "type": "VARCHAR"},
                    {"name": "long_description",  "type": "VARCHAR"},
                    {"name": "batch",             "type": "VARCHAR"},
                    {"name": "status",            "type": "VARCHAR"},
                    {"name": "tags",              "type": "VARCHAR"},
                    {"name": "location",          "type": "VARCHAR"},
                    {"name": "country",           "type": "VARCHAR"},
                    {"name": "year_founded",      "type": "DOUBLE"},
                    {"name": "num_founders",      "type": "BIGINT"},
                    {"name": "founders_names",    "type": "VARCHAR"},
                    {"name": "team_size",         "type": "DOUBLE"},
                    {"name": "website",           "type": "VARCHAR"},
                    {"name": "cb_url",            "type": "VARCHAR"},
                    {"name": "linkedin_url",      "type": "VARCHAR"},
                ]
            }]
        }]
    }]

    # Exact query from the reported payload (cursorOffset 647 = end of query)
    query = (
        "SELECT\n"
        "    batch,\n"
        "    TRY_CAST('20' || SUBSTRING(batch, 2, 2) AS INTEGER) AS batch_year,\n"
        "    SUBSTRING(batch, 1, 1) AS season,\n"
        "    COUNT(*) AS total_companies,\n"
        "    COUNT(CASE WHEN status = 'Active'   THEN 1 END) AS active,\n"
        "    COUNT(CASE WHEN status = 'Acquired' THEN 1 END) AS acquired,\n"
        "    COUNT(CASE WHEN status = 'Public'   THEN 1 END) AS public_co,\n"
        "    COUNT(CASE WHEN status = 'Inactive' THEN 1 END) AS inactive,\n"
        "    ROUND(100.0 * COUNT(CASE WHEN status IN ('Acquired', 'Public') THEN 1 END) / COUNT(*), 1) AS exit_rate_pct\n"
        "FROM t_2024_05_11_yc_companies\n"
        "WHERE batch LIKE 'S%' OR batch LIKE 'W%'\n"
        "GROUP BY batch, batch_year, season\n"
        "ORDER BY A"
    )
    assert len(query) == 647, f"Query length mismatch: {len(query)}"

    suggestions = get_completions(query, 647, yc_schema,
                                  database_name="yc_companies",
                                  connection_type="csv")
    labels = [s.label for s in suggestions]

    # Schema columns from t_2024_05_11_yc_companies must appear
    assert "batch" in labels,   "base column 'batch' must appear"
    assert "status" in labels,  "base column 'status' must appear"

    # SELECT aliases must appear — even when the FROM table is not in schema_data,
    # aliases are extracted from the AST and require no schema lookup
    assert "batch_year"      in labels, "alias 'batch_year' must appear in ORDER BY"
    assert "season"          in labels, "alias 'season' must appear in ORDER BY"
    assert "total_companies" in labels, "alias 'total_companies' must appear"
    assert "active"          in labels, "alias 'active' must appear"
    assert "acquired"        in labels, "alias 'acquired' must appear"
    assert "public_co"       in labels, "alias 'public_co' must appear"
    assert "inactive"        in labels, "alias 'inactive' must appear"
    assert "exit_rate_pct"   in labels, "alias 'exit_rate_pct' must appear"

    # No columns from unrelated tables should be injected
    assert "user_id" not in labels
    assert "order_id" not in labels


def test_select_aliases_also_present_when_schema_data_populated():
    """
    When schema_data has the FROM table, ORDER BY should show both
    the table's base columns AND any SELECT aliases from the query.

    Uses a realistic e-commerce schema to validate that aliases don't
    shadow real columns of the same name (deduplication).
    """
    ecommerce_schema = [{
        "databaseName": "shop",
        "schemas": [{
            "schema": "public",
            "tables": [
                {
                    "table": "orders",
                    "columns": [
                        {"name": "order_id",    "type": "BIGINT"},
                        {"name": "customer_id", "type": "BIGINT"},
                        {"name": "amount",      "type": "DECIMAL"},
                        {"name": "status",      "type": "VARCHAR"},
                        {"name": "created_at",  "type": "TIMESTAMP"},
                    ]
                },
                {
                    "table": "customers",
                    "columns": [
                        {"name": "customer_id", "type": "BIGINT"},
                        {"name": "email",       "type": "VARCHAR"},
                        {"name": "region",      "type": "VARCHAR"},
                    ]
                }
            ]
        }]
    }]

    query = (
        "SELECT\n"
        "    status,\n"
        "    COUNT(*) AS order_count,\n"
        "    SUM(amount) AS total_revenue,\n"
        "    AVG(amount) AS avg_order_value\n"
        "FROM orders\n"
        "GROUP BY status\n"
        "ORDER BY "
    )

    suggestions = get_completions(query, len(query), ecommerce_schema,
                                  database_name="shop", connection_type="postgresql")
    labels = [s.label for s in suggestions]

    # Base columns from 'orders' (only the joined table — 'customers' is not referenced)
    assert "order_id"   in labels
    assert "amount"     in labels
    assert "status"     in labels
    assert "created_at" in labels

    # Unjoined table must not appear
    assert "email"   not in labels
    assert "region"  not in labels

    # SELECT aliases also visible for ORDER BY
    assert "order_count"     in labels
    assert "total_revenue"   in labels
    assert "avg_order_value" in labels


# ---------------------------------------------------------------------------
# Dialect tests
# One schema, two tables (users + orders). All three dialects must correctly
# filter columns to only the table referenced in the query.
# ---------------------------------------------------------------------------

DIALECT_SCHEMA = [
    {
        "databaseName": "test_db",
        "schemas": [
            {
                "schema": "public",
                "tables": [
                    {
                        "table": "users",
                        "columns": [
                            {"name": "user_id", "type": "int"},
                            {"name": "email", "type": "varchar"},
                            {"name": "created_at", "type": "timestamp"},
                        ]
                    },
                    {
                        "table": "orders",
                        "columns": [
                            {"name": "order_id", "type": "int"},
                            {"name": "amount", "type": "decimal"},
                            {"name": "status", "type": "varchar"},
                        ]
                    }
                ]
            }
        ]
    }
]


def test_postgresql_dialect_where_filtering():
    """
    PostgreSQL dialect: standard double-quoted identifier syntax.
    Only users columns should appear after WHERE.
    """
    query = 'SELECT * FROM "users" WHERE '
    suggestions = get_completions(query, len(query), DIALECT_SCHEMA, connection_type="postgresql")
    names = [s.label for s in suggestions]

    assert "user_id" in names
    assert "email" in names
    assert "created_at" in names

    assert "order_id" not in names
    assert "amount" not in names
    assert "status" not in names


def test_duckdb_dialect_where_filtering():
    """
    DuckDB dialect: uses duckdb parser instead of postgres.
    Plain unquoted identifiers; only users columns should appear.
    """
    query = "SELECT * FROM users WHERE "
    suggestions = get_completions(query, len(query), DIALECT_SCHEMA, connection_type="duckdb")
    names = [s.label for s in suggestions]

    assert "user_id" in names
    assert "email" in names
    assert "created_at" in names

    assert "order_id" not in names
    assert "amount" not in names
    assert "status" not in names


def test_bigquery_dialect_backtick_table_names():
    """
    BigQuery dialect: table names wrapped in backticks.
    Postgres parser cannot handle backtick quoting; bigquery dialect required.
    Only users columns should appear after WHERE.
    """
    query = "SELECT * FROM `users` WHERE "
    suggestions = get_completions(query, len(query), DIALECT_SCHEMA, connection_type="bigquery")
    names = [s.label for s in suggestions]

    assert "user_id" in names
    assert "email" in names
    assert "created_at" in names

    assert "order_id" not in names
    assert "amount" not in names
    assert "status" not in names


def test_bigquery_dialect_join_with_backtick_names():
    """
    BigQuery dialect: JOIN with backtick-quoted table names.
    Both joined tables' columns should appear; unjoined table excluded.
    """
    schema_with_products = [
        {
            "databaseName": "test_db",
            "schemas": [
                {
                    "schema": "public",
                    "tables": [
                        {
                            "table": "users",
                            "columns": [
                                {"name": "user_id", "type": "int"},
                                {"name": "email", "type": "varchar"},
                            ]
                        },
                        {
                            "table": "orders",
                            "columns": [
                                {"name": "order_id", "type": "int"},
                                {"name": "amount", "type": "decimal"},
                            ]
                        },
                        {
                            "table": "products",
                            "columns": [
                                {"name": "product_id", "type": "int"},
                                {"name": "price", "type": "decimal"},
                            ]
                        }
                    ]
                }
            ]
        }
    ]

    query = "SELECT  FROM `users` JOIN `orders` ON `users`.user_id = `orders`.order_id WHERE "
    suggestions = get_completions(query, 7, schema_with_products, connection_type="bigquery")
    names = [s.label for s in suggestions]

    assert "user_id" in names
    assert "email" in names
    assert "order_id" in names
    assert "amount" in names

    assert "product_id" not in names
    assert "price" not in names


def test_unknown_connection_type_defaults_to_postgres():
    """
    Unknown/None connection type should fall back to postgres dialect
    without error. Standard SQL still works.
    """
    query = "SELECT * FROM users WHERE "
    suggestions = get_completions(query, len(query), DIALECT_SCHEMA, connection_type=None)
    names = [s.label for s in suggestions]

    assert "user_id" in names
    assert "order_id" not in names


# ---------------------------------------------------------------------------
# mxfood schema — extracted verbatim from
#   frontend/lib/database/company-template.json (fullSchema section)
#
# These tests use the real default schema and real question SQL queries from
# the company template.  Each test takes a query from the template, truncates
# it at a meaningful cursor position, and asserts that autocomplete returns
# exactly the right columns — only from tables actually referenced in that
# query fragment.
# ---------------------------------------------------------------------------

MXFOOD_SCHEMA = [
    {
        "databaseName": "mxfood",
        "schemas": [
            {
                "schema": "main",
                "tables": [
                    {
                        "table": "orders",
                        "columns": [
                            {"name": "order_id",                "type": "BIGINT"},
                            {"name": "user_id",                 "type": "BIGINT"},
                            {"name": "restaurant_id",           "type": "BIGINT"},
                            {"name": "driver_id",               "type": "BIGINT"},
                            {"name": "zone_id",                 "type": "BIGINT"},
                            {"name": "created_at",              "type": "TIMESTAMP"},
                            {"name": "status",                  "type": "VARCHAR"},
                            {"name": "subtotal",                "type": "DOUBLE"},
                            {"name": "delivery_fee",            "type": "DOUBLE"},
                            {"name": "discount_amount",         "type": "DOUBLE"},
                            {"name": "tip_amount",              "type": "DOUBLE"},
                            {"name": "total",                   "type": "DOUBLE"},
                            {"name": "promo_code_id",           "type": "BIGINT"},
                            {"name": "is_subscription_order",   "type": "BOOLEAN"},
                            {"name": "platform",                "type": "VARCHAR"},
                            {"name": "estimated_delivery_mins", "type": "BIGINT"},
                            {"name": "actual_delivery_mins",    "type": "DOUBLE"},
                        ],
                    },
                    {
                        "table": "order_items",
                        "columns": [
                            {"name": "order_item_id", "type": "BIGINT"},
                            {"name": "order_id",      "type": "BIGINT"},
                            {"name": "product_id",    "type": "BIGINT"},
                            {"name": "quantity",      "type": "BIGINT"},
                            {"name": "unit_price",    "type": "DOUBLE"},
                            {"name": "total_price",   "type": "DOUBLE"},
                        ],
                    },
                    {
                        "table": "products",
                        "columns": [
                            {"name": "product_id",     "type": "BIGINT"},
                            {"name": "restaurant_id",  "type": "BIGINT"},
                            {"name": "subcategory_id", "type": "BIGINT"},
                            {"name": "name",           "type": "VARCHAR"},
                            {"name": "description",    "type": "VARCHAR"},
                            {"name": "price",          "type": "DOUBLE"},
                            {"name": "is_available",   "type": "BOOLEAN"},
                            {"name": "created_at",     "type": "TIMESTAMP"},
                        ],
                    },
                    {
                        "table": "product_subcategories",
                        "columns": [
                            {"name": "subcategory_id",   "type": "BIGINT"},
                            {"name": "category_id",      "type": "BIGINT"},
                            {"name": "subcategory_name", "type": "VARCHAR"},
                        ],
                    },
                    {
                        "table": "product_categories",
                        "columns": [
                            {"name": "category_id",   "type": "BIGINT"},
                            {"name": "category_name", "type": "VARCHAR"},
                        ],
                    },
                    {
                        "table": "events",
                        "columns": [
                            {"name": "event_id",        "type": "BIGINT"},
                            {"name": "user_id",         "type": "BIGINT"},
                            {"name": "session_id",      "type": "VARCHAR"},
                            {"name": "event_name",      "type": "VARCHAR"},
                            {"name": "event_timestamp", "type": "TIMESTAMP"},
                            {"name": "platform",        "type": "VARCHAR"},
                            {"name": "screen_name",     "type": "VARCHAR"},
                            {"name": "properties",      "type": "VARCHAR"},
                        ],
                    },
                    {
                        "table": "users",
                        "columns": [
                            {"name": "user_id",             "type": "BIGINT"},
                            {"name": "first_name",          "type": "VARCHAR"},
                            {"name": "last_name",           "type": "VARCHAR"},
                            {"name": "email",               "type": "VARCHAR"},
                            {"name": "phone",               "type": "VARCHAR"},
                            {"name": "created_at",          "type": "TIMESTAMP"},
                            {"name": "zone_id",             "type": "BIGINT"},
                            {"name": "acquisition_channel", "type": "VARCHAR"},
                            {"name": "referred_by_user_id", "type": "DOUBLE"},
                            {"name": "platform",            "type": "VARCHAR"},
                        ],
                    },
                    {
                        "table": "zones",
                        "columns": [
                            {"name": "zone_id",                "type": "BIGINT"},
                            {"name": "zone_name",              "type": "VARCHAR"},
                            {"name": "avg_delivery_time_mins", "type": "BIGINT"},
                            {"name": "surge_multiplier",       "type": "DOUBLE"},
                            {"name": "lat_center",             "type": "DOUBLE"},
                            {"name": "lng_center",             "type": "DOUBLE"},
                        ],
                    },
                    {
                        "table": "drivers",
                        "columns": [
                            {"name": "driver_id",    "type": "BIGINT"},
                            {"name": "name",         "type": "VARCHAR"},
                            {"name": "zone_id",      "type": "BIGINT"},
                            {"name": "vehicle_type", "type": "VARCHAR"},
                            {"name": "rating",       "type": "DOUBLE"},
                            {"name": "created_at",   "type": "TIMESTAMP"},
                            {"name": "is_active",    "type": "BOOLEAN"},
                        ],
                    },
                ],
            }
        ],
    }
]


def test_order_by_no_space_returns_columns_not_keywords():
    """
    Regression: cursor right after typing "ORDER BY" (no trailing space).

    The failing payload has cursorOffset=645 and query ending with "ORDER BY"
    (no space).  The regex ORDER-BY-space-word requires at least one
    whitespace after BY, so needs_column_completion returns False and the
    engine falls through to keyword suggestions instead of columns.

    Expected: column + alias suggestions.
    Must NOT return: only SQL keywords (SELECT, FROM, …).
    Must NOT return: empty.
    """
    # Exact failing query from user payload — ends with "ORDER BY" (no space, no letter)
    query = (
        "SELECT\n"
        "    batch,\n"
        "    TRY_CAST('20' || SUBSTRING(batch, 2, 2) AS INTEGER) AS batch_year,\n"
        "    SUBSTRING(batch, 1, 1) AS season,\n"
        "    COUNT(*) AS total_companies,\n"
        "    COUNT(CASE WHEN status = 'Active'   THEN 1 END) AS active,\n"
        "    COUNT(CASE WHEN status = 'Acquired' THEN 1 END) AS acquired,\n"
        "    COUNT(CASE WHEN status = 'Public'   THEN 1 END) AS public_co,\n"
        "    COUNT(CASE WHEN status = 'Inactive' THEN 1 END) AS inactive,\n"
        "    ROUND(100.0 * COUNT(CASE WHEN status IN ('Acquired', 'Public') THEN 1 END) / COUNT(*), 1) AS exit_rate_pct\n"
        "FROM t_2024_05_11_yc_companies\n"
        "WHERE batch LIKE 'S%' OR batch LIKE 'W%'\n"
        "GROUP BY batch, batch_year, season\n"
        "ORDER BY"
    )
    assert len(query) == 645

    schema_data = [{"databaseName": "yc_companies", "schemas": [{"schema": "main", "tables": [{"table": "t_2024_05_11_yc_companies", "columns": [
        {"name": "company_id",       "type": "BIGINT"},
        {"name": "company_name",     "type": "VARCHAR"},
        {"name": "batch",            "type": "VARCHAR"},
        {"name": "status",           "type": "VARCHAR"},
        {"name": "year_founded",     "type": "DOUBLE"},
    ]}]}]}]

    suggestions = get_completions(query, 645, schema_data,
                                  database_name="yc_companies", connection_type="csv")
    labels = [s.label for s in suggestions]
    kinds  = {s.label: s.kind for s in suggestions}

    # Column + alias suggestions must appear
    assert "batch"          in labels, "schema column 'batch' must appear"
    assert "status"         in labels, "schema column 'status' must appear"
    assert "batch_year"     in labels, "alias 'batch_year' must appear"
    assert "season"         in labels, "alias 'season' must appear"
    assert "total_companies" in labels, "alias 'total_companies' must appear"

    # Must NOT degrade to SQL-keyword-only results
    assert kinds.get("batch") != "keyword", "columns must not be kind=keyword"
    # All-keyword result means the column context was missed
    non_keyword = [l for l in labels if kinds[l] != "keyword"]
    assert len(non_keyword) > 0, "at least one non-keyword suggestion required"


def test_order_by_trailing_space_yc_query():
    """
    Regression: cursor after "ORDER BY " (one trailing space, no letter typed yet).
    cursorOffset=646, query ends with "ORDER BY " — exact browser-reported failing payload.

    The old regex ORDER-BY-space-word matched this case already (space satisfies \\s+,
    word matches empty). The new regex also matches. This test is a guard against future
    regressions.
    """
    query = (
        "SELECT\n"
        "    batch,\n"
        "    TRY_CAST('20' || SUBSTRING(batch, 2, 2) AS INTEGER) AS batch_year,\n"
        "    SUBSTRING(batch, 1, 1) AS season,\n"
        "    COUNT(*) AS total_companies,\n"
        "    COUNT(CASE WHEN status = 'Active'   THEN 1 END) AS active,\n"
        "    COUNT(CASE WHEN status = 'Acquired' THEN 1 END) AS acquired,\n"
        "    COUNT(CASE WHEN status = 'Public'   THEN 1 END) AS public_co,\n"
        "    COUNT(CASE WHEN status = 'Inactive' THEN 1 END) AS inactive,\n"
        "    ROUND(100.0 * COUNT(CASE WHEN status IN ('Acquired', 'Public') THEN 1 END) / COUNT(*), 1) AS exit_rate_pct\n"
        "FROM t_2024_05_11_yc_companies\n"
        "WHERE batch LIKE 'S%' OR batch LIKE 'W%'\n"
        "GROUP BY batch, batch_year, season\n"
        "ORDER BY "  # trailing space, NO letter
    )
    assert len(query) == 646, f"Expected 646, got {len(query)}"

    schema_data = [{"databaseName": "yc_companies", "schemas": [{"schema": "main", "tables": [
        {"table": "t_2024_05_11_yc_companies", "columns": [
            {"name": "company_id",   "type": "BIGINT"},
            {"name": "company_name", "type": "VARCHAR"},
            {"name": "batch",        "type": "VARCHAR"},
            {"name": "status",       "type": "VARCHAR"},
            {"name": "year_founded", "type": "DOUBLE"},
        ]}
    ]}]}]

    suggestions = get_completions(query, 646, schema_data,
                                  database_name="yc_companies", connection_type="csv")
    labels = [s.label for s in suggestions]

    assert len(suggestions) > 0,       "suggestions must not be empty"
    assert "batch"           in labels, "base column 'batch' missing"
    assert "status"          in labels, "base column 'status' missing"
    assert "batch_year"      in labels, "alias 'batch_year' missing"
    assert "season"          in labels, "alias 'season' missing"
    assert "total_companies" in labels, "alias 'total_companies' missing"
    assert "active"          in labels, "alias 'active' missing"
    assert "exit_rate_pct"   in labels, "alias 'exit_rate_pct' missing"


def test_group_by_no_space_returns_columns():
    """
    Same regex bug for GROUP BY: cursor right after typing "GROUP BY" with
    no trailing space must still trigger column context.
    """
    query = (
        "SELECT status, COUNT(*) as cnt "
        "FROM orders "
        "GROUP BY"
    )
    schema_data = [{"databaseName": "db", "schemas": [{"schema": "public", "tables": [
        {"table": "orders", "columns": [
            {"name": "order_id", "type": "int"},
            {"name": "status",   "type": "varchar"},
            {"name": "total",    "type": "decimal"},
        ]}
    ]}]}]

    suggestions = get_completions(query, len(query), schema_data)
    labels = [s.label for s in suggestions]

    assert "order_id" in labels, "orders.order_id must appear"
    assert "status"   in labels, "orders.status must appear"
    assert "cnt"      in labels, "alias 'cnt' must appear for GROUP BY"

    non_keyword = [s for s in suggestions if s.kind != "keyword"]
    assert len(non_keyword) > 0, "GROUP BY no-space must return columns, not only keywords"


def test_mxfood_orders_where_clause_filters_to_orders_columns():
    """
    Real mxfood query (question 17 — "Total Monthly Orders") truncated at WHERE.

    The schema contains 9 tables (orders, events, users, zones, drivers, …).
    Only orders is referenced in the FROM clause, so only orders columns should
    appear after WHERE.  Columns unique to other tables must be excluded.
    """
    # Question 17 query, extended with a WHERE clause (cursor at end)
    query = (
        "SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as orders "
        "FROM orders WHERE "
    )

    suggestions = get_completions(query, len(query), MXFOOD_SCHEMA,
                                  database_name="mxfood", connection_type="duckdb")
    labels = [s.label for s in suggestions]

    # orders columns must appear
    assert "status"      in labels, "orders.status"
    assert "total"       in labels, "orders.total"
    assert "created_at"  in labels, "orders.created_at"
    assert "order_id"    in labels, "orders.order_id"
    assert "subtotal"    in labels, "orders.subtotal"
    assert "delivery_fee" in labels, "orders.delivery_fee"

    # columns unique to non-referenced tables must not appear
    assert "first_name"   not in labels, "users.first_name must be excluded"
    assert "zone_name"    not in labels, "zones.zone_name must be excluded"
    assert "session_id"   not in labels, "events.session_id must be excluded"
    assert "vehicle_type" not in labels, "drivers.vehicle_type must be excluded"


def test_mxfood_orders_order_by_includes_select_aliases():
    """
    Real mxfood query (question 14 — "Weekly Orders and Revenue") with ORDER BY
    at the cursor.

    SELECT aliases week, orders, revenue are valid ORDER BY targets.
    They must appear alongside the base orders columns.
    Non-referenced tables (users, zones, …) must be excluded.
    """
    # Question 14 query with ORDER BY column removed (cursor at end)
    query = (
        "SELECT \n"
        "  DATE_TRUNC('week', created_at) as week,\n"
        "  COUNT(*) as orders,\n"
        "  SUM(total) as revenue\n"
        "FROM orders\n"
        "GROUP BY DATE_TRUNC('week', created_at)\n"
        "ORDER BY "
    )

    suggestions = get_completions(query, len(query), MXFOOD_SCHEMA,
                                  database_name="mxfood", connection_type="duckdb")
    labels = [s.label for s in suggestions]

    # Base orders columns
    assert "status"     in labels, "orders.status"
    assert "total"      in labels, "orders.total"
    assert "created_at" in labels, "orders.created_at"
    assert "order_id"   in labels, "orders.order_id"

    # SELECT aliases must be valid ORDER BY targets
    assert "week"    in labels, "alias 'week' must appear in ORDER BY context"
    assert "orders"  in labels, "alias 'orders' must appear in ORDER BY context"
    assert "revenue" in labels, "alias 'revenue' must appear in ORDER BY context"

    # Non-referenced tables excluded
    assert "first_name"   not in labels
    assert "zone_name"    not in labels
    assert "session_id"   not in labels
    assert "vehicle_type" not in labels


def test_mxfood_five_table_join_where_shows_all_joined_columns():
    """
    Real mxfood query (question 15 — "Weekly Revenue by Product Category"):
    five-table JOIN truncated after the JOIN chain with cursor at WHERE.

    All 5 joined tables' columns must be visible; the 4 non-joined tables
    in the schema (users, zones, drivers, events) must not appear.
    """
    # Question 15 query, truncated after the JOIN chain (WHERE condition removed)
    query = (
        "SELECT \n"
        "  DATE_TRUNC('week', o.created_at) as week_start,\n"
        "  pc.category_name,\n"
        "  SUM(oi.total_price) as revenue\n"
        "FROM orders o\n"
        "JOIN order_items oi ON o.order_id = oi.order_id\n"
        "JOIN products p ON oi.product_id = p.product_id\n"
        "JOIN product_subcategories ps ON p.subcategory_id = ps.subcategory_id\n"
        "JOIN product_categories pc ON ps.category_id = pc.category_id\n"
        "WHERE "
    )

    suggestions = get_completions(query, len(query), MXFOOD_SCHEMA,
                                  database_name="mxfood", connection_type="duckdb")
    labels = [s.label for s in suggestions]

    # From orders (aliased as o)
    assert "status"           in labels, "orders.status"
    assert "total"            in labels, "orders.total"
    # From order_items (aliased as oi)
    assert "unit_price"       in labels, "order_items.unit_price"
    assert "quantity"         in labels, "order_items.quantity"
    assert "total_price"      in labels, "order_items.total_price"
    # From products (aliased as p)
    assert "price"            in labels, "products.price"
    assert "is_available"     in labels, "products.is_available"
    # From product_subcategories (aliased as ps)
    assert "subcategory_name" in labels, "product_subcategories.subcategory_name"
    # From product_categories (aliased as pc)
    assert "category_name"    in labels, "product_categories.category_name"

    # Non-joined tables must not appear
    assert "first_name"   not in labels, "users.first_name must be excluded"
    assert "zone_name"    not in labels, "zones.zone_name must be excluded"
    assert "session_id"   not in labels, "events.session_id must be excluded"
    assert "vehicle_type" not in labels, "drivers.vehicle_type must be excluded"


def test_mxfood_events_group_by_includes_select_aliases():
    """
    Real mxfood query (question 25 — "Daily Sessions") truncated at GROUP BY.

    FROM events — only events columns should appear (orders.status, users.first_name,
    etc. must not).  SELECT aliases date and total_sessions are valid GROUP BY
    targets and must also appear.
    """
    # Question 25 query, GROUP BY columns removed (cursor at end)
    query = (
        "SELECT \n"
        "  DATE(event_timestamp) as date,\n"
        "  platform,\n"
        "  COUNT(DISTINCT session_id) as total_sessions\n"
        "FROM events\n"
        "WHERE event_timestamp >= '2025-12-01'\n"
        "GROUP BY "
    )

    suggestions = get_completions(query, len(query), MXFOOD_SCHEMA,
                                  database_name="mxfood", connection_type="duckdb")
    labels = [s.label for s in suggestions]

    # events columns must appear
    assert "event_id"        in labels, "events.event_id"
    assert "session_id"      in labels, "events.session_id"
    assert "event_name"      in labels, "events.event_name"
    assert "event_timestamp" in labels, "events.event_timestamp"
    assert "screen_name"     in labels, "events.screen_name"
    assert "properties"      in labels, "events.properties"

    # SELECT aliases valid in GROUP BY context
    assert "date"           in labels, "alias 'date' must appear"
    assert "total_sessions" in labels, "alias 'total_sessions' must appear"

    # Non-referenced tables excluded
    assert "first_name"   not in labels, "users.first_name must be excluded"
    assert "status"       not in labels, "orders.status must be excluded"
    assert "zone_name"    not in labels, "zones.zone_name must be excluded"
    assert "vehicle_type" not in labels, "drivers.vehicle_type must be excluded"
