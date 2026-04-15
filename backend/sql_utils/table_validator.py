"""Validate that a SQL query only references whitelisted tables."""

from sqlglot import parse_one, exp
from sqlglot.errors import ParseError
from typing import Optional


def validate_query_tables(sql: str, whitelist: list[dict]) -> Optional[str]:
    """Return an error message if the query references tables outside the whitelist.

    Returns None if:
    - whitelist is empty (no restriction)
    - all referenced tables are whitelisted
    - the SQL cannot be parsed (allow through; the execution layer will surface the error)

    CTE names are excluded from validation — they are virtual, not real tables.

    Args:
        sql: SQL query string (may contain :params)
        whitelist: list of {schema: str, tables: [str]} dicts

    Returns:
        Error string, or None if valid
    """
    if not whitelist:
        return None

    try:
        ast = parse_one(sql)
    except ParseError:
        return None  # unparseable → allow through

    # Collect CTE names — they are virtual tables, not real ones
    cte_names = {cte.alias.lower() for cte in ast.find_all(exp.CTE) if cte.alias}

    # Build allowed lookup: table_name (lower) → set of allowed schema names (lower)
    allowed: dict[str, set[str]] = {}
    for entry in whitelist:
        schema = (entry.get('schema') or '').lower()
        for table in (entry.get('tables') or []):
            allowed.setdefault(table.lower(), set()).add(schema)

    blocked = []
    for table in ast.find_all(exp.Table):
        name = table.name.lower()
        if not name or name in cte_names:
            continue
        if name not in allowed:
            blocked.append(table.sql())
        elif table.db and table.db.lower() not in allowed[name]:
            blocked.append(table.sql())

    if blocked:
        return f"Query references tables outside the allowed schema: {', '.join(set(blocked))}"
    return None
