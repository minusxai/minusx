"""
Parameterized query dialect compatibility tests.

For each supported SQL dialect (DuckDB, Postgres, BigQuery) we write one
realistic query that exercises all three param types:

  text   → string filter  e.g. WHERE status = :status
  date   → date range     e.g. WHERE created_at >= :start_date
  number → numeric limit  e.g. WHERE amount > :min_amount

Test strategy: substitute literal test values for each :param placeholder,
then use sqlglot.parse_one(sql, read=dialect) to verify structural validity.
No live database connection required.
"""

import re
import pytest
import sqlglot
from sqlglot.errors import ErrorLevel


# ---------------------------------------------------------------------------
# Canonical test values (one per param type)
#
# The frontend always sends param values as strings over JSON:
#   text   → plain string, e.g. "active"
#   date   → ISO 8601 string, e.g. "2024-01-01" or "2024-01-01T00:00:00"
#   number → numeric string, e.g. "100" or "3.14"
#
# For Postgres (asyncpg), _coerce_params_for_asyncpg converts these to native
# Python types (datetime.date, int/float) before binding — the SQL text still
# holds :param placeholders.
#
# For DuckDB and BigQuery the string values are passed directly to the driver
# which handles implicit casting.
#
# In this test we substitute literal SQL values to validate syntax via sqlglot.
# Date values are quoted strings ('2024-01-01') because that is what appears in
# SQL when a string is compared to a date column — all three dialects accept
# this and cast implicitly.
# ---------------------------------------------------------------------------

TEXT_VALUE   = "'active'"
DATE_VALUE   = "'2024-01-01'"       # ISO date string literal — matches what drivers receive
DATE_TS_VALUE = "'2024-01-01T00:00:00'"  # ISO datetime variant
NUMBER_VALUE = "100"


def substitute_params(query: str, params: dict[str, str]) -> str:
    """Replace :paramName placeholders with literal SQL values."""
    result = query
    for name, value in params.items():
        result = re.sub(rf':{name}\b', value, result)
    return result


# ---------------------------------------------------------------------------
# Full dialect queries — each uses text + date + number params together
# ---------------------------------------------------------------------------

DIALECT_QUERIES = [
    pytest.param(
        "duckdb",
        """
        SELECT
            DATE_TRUNC('month', created_at) AS month,
            status,
            COUNT(*)    AS total_orders,
            SUM(amount) AS revenue
        FROM orders
        WHERE status      = :status
          AND created_at >= :start_date
          AND amount      > :min_amount
        GROUP BY 1, 2
        ORDER BY month DESC
        LIMIT 500
        """,
        {"status": TEXT_VALUE, "start_date": DATE_VALUE, "min_amount": NUMBER_VALUE},
        id="duckdb",
    ),
    pytest.param(
        "postgres",
        """
        SELECT
            DATE_TRUNC('week', created_at) AS week,
            region,
            COUNT(DISTINCT user_id) AS unique_users,
            SUM(spend)              AS total_spend
        FROM transactions
        WHERE region      = :region
          AND created_at >= :start_date
          AND spend       > :min_spend
        GROUP BY 1, 2
        ORDER BY week DESC
        LIMIT 500
        """,
        {"region": TEXT_VALUE, "start_date": DATE_VALUE, "min_spend": NUMBER_VALUE},
        id="postgres",
    ),
    pytest.param(
        "bigquery",
        """
        SELECT
            DATE_TRUNC(event_date, MONTH) AS month,
            country,
            COUNT(*)     AS events,
            SUM(revenue) AS total_revenue
        FROM `myproject.analytics.events`
        WHERE country     = :country
          AND event_date >= :start_date
          AND revenue     > :min_revenue
        GROUP BY 1, 2
        ORDER BY month DESC
        LIMIT 500
        """,
        {"country": TEXT_VALUE, "start_date": DATE_VALUE, "min_revenue": NUMBER_VALUE},
        id="bigquery",
    ),
]


@pytest.mark.parametrize("dialect,query_template,params", DIALECT_QUERIES)
def test_all_param_types_valid_for_dialect(dialect, query_template, params):
    """Full query with text + date + number params parses cleanly for each dialect."""
    sql = substitute_params(query_template, params)
    ast = sqlglot.parse_one(sql, read=dialect, error_level=ErrorLevel.RAISE)
    assert ast is not None


# ---------------------------------------------------------------------------
# Isolated param-type matrix — each param type × each dialect
# ---------------------------------------------------------------------------

PARAM_TYPE_QUERIES = [
    pytest.param(
        "text",
        "SELECT * FROM orders WHERE status = :status LIMIT 100",
        {"status": TEXT_VALUE},
        id="text",
    ),
    pytest.param(
        "date-iso-date",
        "SELECT * FROM orders WHERE created_at >= :start_date LIMIT 100",
        {"start_date": DATE_VALUE},
        id="date-iso-date",
    ),
    pytest.param(
        "date-iso-datetime",
        "SELECT * FROM orders WHERE created_at >= :start_ts LIMIT 100",
        {"start_ts": DATE_TS_VALUE},
        id="date-iso-datetime",
    ),
    pytest.param(
        "number",
        "SELECT * FROM orders WHERE amount > :min_amount LIMIT 100",
        {"min_amount": NUMBER_VALUE},
        id="number",
    ),
]


@pytest.mark.parametrize("dialect", ["duckdb", "postgres", "bigquery"])
@pytest.mark.parametrize("param_type,query_template,params", PARAM_TYPE_QUERIES)
def test_isolated_param_type_valid_for_dialect(dialect, param_type, query_template, params):
    """Each param type independently produces valid SQL for every dialect."""
    sql = substitute_params(query_template, params)
    ast = sqlglot.parse_one(sql, read=dialect, error_level=ErrorLevel.RAISE)
    assert ast is not None
