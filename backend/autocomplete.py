"""
SQL Autocomplete Engine
Uses sqlglot for robust SQL parsing and context-aware suggestions.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import sqlglot
from sqlglot import exp


class CompletionItem(BaseModel):
    """Autocomplete suggestion item (Monaco-compatible format)"""
    label: str
    kind: str  # "column" | "table" | "reference" | "keyword" | "cte"
    detail: Optional[str] = None
    documentation: Optional[str] = None
    insert_text: str
    sort_text: Optional[str] = None


class AutocompleteRequest(BaseModel):
    query: str
    cursor_offset: int
    schema_data: List[Dict[str, Any]]
    database_name: Optional[str] = None


def get_completions(
    query: str,
    cursor_offset: int,
    schema_data: List[Dict[str, Any]],
    database_name: Optional[str] = None
) -> List[CompletionItem]:
    """
    Main entry point for autocomplete suggestions.
    Routes to appropriate completion handler based on context.
    """
    text_before_cursor = query[:cursor_offset]

    # Fast path: @reference completion (no SQL parsing needed)
    if text_before_cursor.rstrip().endswith("@"):
        # Frontend handles @reference suggestions
        return []

    # Check context patterns BEFORE parsing (handles incomplete SQL)
    # This allows us to suggest columns/tables even if SQL doesn't parse yet
    is_column_context = needs_column_completion(text_before_cursor)
    is_table_context = needs_table_completion(text_before_cursor)
    is_dot_context = "." in text_before_cursor.split()[-1] if text_before_cursor.split() else False

    # Try to parse SQL (for extracting context like tables in scope, CTEs, aliases)
    ast = None
    try:
        ast = sqlglot.parse_one(query, read="postgres")
    except Exception as e:
        # Parse failed - use regex-based suggestions for incomplete SQL
        if is_dot_context and schema_data:
            # Handle schema.table pattern without AST
            return get_schema_dot_completions_fallback(schema_data, text_before_cursor)
        elif is_column_context and schema_data:
            # Show all columns (no filtering possible without parsed FROM clause)
            return get_all_columns_unfiltered(schema_data)
        elif is_table_context and schema_data:
            # Show all tables
            return get_all_tables_unfiltered(schema_data)
        else:
            # Fall back to keywords
            return get_keyword_completions()

    # Determine completion context (check dot notation first)
    if is_dot_context:
        return get_dot_completions(ast, schema_data, text_before_cursor)
    elif is_column_context:
        return get_column_completions(ast, schema_data, text_before_cursor)
    elif is_table_context:
        return get_table_completions(ast, schema_data)
    else:
        return get_keyword_completions()


def needs_column_completion(text: str) -> bool:
    """Check if cursor is in column completion context"""
    patterns = [
        r'\bSELECT\s+\w*$',
        r'\bWHERE\s+\w*$',
        r'\bGROUP\s+BY\s+\w*$',
        r'\bORDER\s+BY\s+\w*$',
        r'\bON\s+\w*$',
        r',\s*\w*$',
    ]
    import re
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def needs_table_completion(text: str) -> bool:
    """Check if cursor is in table completion context"""
    patterns = [
        r'\bFROM\s+\w*$',
        r'\bJOIN\s+\w*$',
        r'\bINTO\s+\w*$',
        r'\bUPDATE\s+\w*$',
    ]
    import re
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def get_column_completions(
    ast: exp.Expression,
    schema_data: List[Dict[str, Any]],
    text_before_cursor: str
) -> List[CompletionItem]:
    """
    Get column suggestions filtered by tables in scope.
    """
    tables_in_scope = extract_tables_in_scope(ast)
    suggestions = []
    idx = 0

    # Get CTE info first
    cte_columns = extract_cte_columns(ast)
    cte_names_lower = [name.lower() for name in cte_columns.keys()]

    # Only add schema table columns if they're not shadowed by CTEs
    for db in schema_data:
        for schema in db.get("schemas", []):
            for table in schema.get("tables", []):
                table_name = table["table"]

                # Filter by tables in scope
                if tables_in_scope and table_name.lower() not in [t.lower() for t in tables_in_scope]:
                    continue

                # Skip if this table is shadowed by a CTE with the same name
                if table_name.lower() in cte_names_lower:
                    continue

                for col in table.get("columns", []):
                    suggestions.append(CompletionItem(
                        label=col["name"],
                        kind="column",
                        detail=f"  {table_name}",
                        documentation=f"Column from {schema['schema']}.{table_name}",
                        insert_text=col["name"],
                        sort_text=str(idx).zfill(5)
                    ))
                    idx += 1

    # Include CTE columns
    for cte_name, columns in cte_columns.items():
        if tables_in_scope and cte_name.lower() not in [t.lower() for t in tables_in_scope]:
            continue
        for col_name in columns:
            suggestions.append(CompletionItem(
                label=col_name,
                kind="cte",
                detail=f"  {cte_name} (CTE)",
                documentation=f"Column from CTE {cte_name}",
                insert_text=col_name,
                sort_text=str(idx).zfill(5)
            ))
            idx += 1

    return suggestions


def get_table_completions(
    ast: exp.Expression,
    schema_data: List[Dict[str, Any]]
) -> List[CompletionItem]:
    """Get table suggestions (includes schemas, qualified tables, and CTEs)"""
    suggestions = []
    idx = 0

    # Track schemas we've seen (to avoid duplicates)
    seen_schemas = set()

    # Schema tables
    for db in schema_data:
        for schema in db.get("schemas", []):
            schema_name = schema["schema"]

            # Add schema name as suggestion (for schema.table pattern)
            if schema_name not in seen_schemas:
                suggestions.append(CompletionItem(
                    label=schema_name,
                    kind="schema",
                    detail="  (schema)",
                    insert_text=schema_name,
                    sort_text=str(idx).zfill(5)
                ))
                idx += 1
                seen_schemas.add(schema_name)

            # Add tables (both unqualified and qualified for BigQuery)
            for table in schema.get("tables", []):
                # Unqualified table name (for convenience)
                suggestions.append(CompletionItem(
                    label=table["table"],
                    kind="table",
                    detail=f"  {schema_name}",
                    insert_text=table["table"],
                    sort_text=str(idx).zfill(5)
                ))
                idx += 1

                # Qualified table name (schema.table) - especially useful for BigQuery
                qualified_name = f"{schema_name}.{table['table']}"
                suggestions.append(CompletionItem(
                    label=qualified_name,
                    kind="table",
                    detail="  (qualified)",
                    insert_text=qualified_name,
                    sort_text=str(idx).zfill(5)
                ))
                idx += 1

    # CTEs
    cte_names = extract_cte_names(ast)
    for cte_name in cte_names:
        suggestions.append(CompletionItem(
            label=cte_name,
            kind="cte",
            detail="  (CTE)",
            insert_text=cte_name,
            sort_text=str(idx).zfill(5)
        ))
        idx += 1

    return suggestions


def get_dot_completions(
    ast: exp.Expression,
    schema_data: List[Dict[str, Any]],
    text_before_cursor: str
) -> List[CompletionItem]:
    """Get completions for dot notation (schema.table or table.column)"""
    import re
    # Limit search to last 200 chars to prevent regex DoS
    search_text = text_before_cursor[-200:] if len(text_before_cursor) > 200 else text_before_cursor
    match = re.search(r'(\w+)\.\w*$', search_text)
    if not match:
        return []

    prefix = match.group(1)
    suggestions = []
    idx = 0

    # Check if prefix is a schema name (schema.table pattern)
    for db in schema_data:
        for schema in db.get("schemas", []):
            if schema["schema"].lower() == prefix.lower():
                # Show tables from this schema
                for table in schema.get("tables", []):
                    suggestions.append(CompletionItem(
                        label=table["table"],
                        kind="table",
                        detail=f"  {schema['schema']}",
                        documentation=f"Table in {schema['schema']} schema",
                        insert_text=table["table"],
                        sort_text=str(idx).zfill(5)
                    ))
                    idx += 1
                return suggestions

    # Not a schema name, so check for table.column or alias.column pattern
    alias_map = extract_table_aliases(ast)
    actual_table = alias_map.get(prefix, prefix)

    # Check tables for columns
    for db in schema_data:
        for schema in db.get("schemas", []):
            for table in schema.get("tables", []):
                if table["table"].lower() == actual_table.lower():
                    for col in table.get("columns", []):
                        suggestions.append(CompletionItem(
                            label=col["name"],
                            kind="column",
                            detail=f"  {table['table']}",
                            documentation=col["type"],
                            insert_text=col["name"],
                            sort_text=str(idx).zfill(5)
                        ))
                        idx += 1
                    return suggestions

    # Check CTEs
    cte_columns = extract_cte_columns(ast)
    if prefix in cte_columns:
        for col_name in cte_columns[prefix]:
            suggestions.append(CompletionItem(
                label=col_name,
                kind="cte",
                detail=f"  {prefix} (CTE)",
                insert_text=col_name,
                sort_text=str(idx).zfill(5)
            ))
            idx += 1

    return suggestions


def get_schema_dot_completions_fallback(
    schema_data: List[Dict[str, Any]],
    text_before_cursor: str
) -> List[CompletionItem]:
    """
    Handle schema.table pattern when SQL parsing fails (incomplete SQL).
    No AST available, so we use regex to extract schema name.
    """
    import re
    # Limit search to last 200 chars to prevent regex DoS
    search_text = text_before_cursor[-200:] if len(text_before_cursor) > 200 else text_before_cursor
    match = re.search(r'(\w+)\.\w*$', search_text)
    if not match:
        return []

    prefix = match.group(1)
    suggestions = []
    idx = 0

    # Check if prefix is a schema name
    for db in schema_data:
        for schema in db.get("schemas", []):
            if schema["schema"].lower() == prefix.lower():
                # Show tables from this schema
                for table in schema.get("tables", []):
                    suggestions.append(CompletionItem(
                        label=table["table"],
                        kind="table",
                        detail=f"  {schema['schema']}",
                        documentation=f"Table in {schema['schema']} schema",
                        insert_text=table["table"],
                        sort_text=str(idx).zfill(5)
                    ))
                    idx += 1
                return suggestions

    # Check if prefix is a table name or alias (table.column pattern)
    for db in schema_data:
        for schema in db.get("schemas", []):
            for table in schema.get("tables", []):
                if table["table"].lower() == prefix.lower():
                    for col in table.get("columns", []):
                        suggestions.append(CompletionItem(
                            label=col["name"],
                            kind="column",
                            detail=f"  {table['table']}",
                            documentation=col.get("type", ""),
                            insert_text=col["name"],
                            sort_text=str(idx).zfill(5)
                        ))
                        idx += 1
                    return suggestions

    return []


def get_keyword_completions() -> List[CompletionItem]:
    """Get common SQL keyword suggestions"""
    keywords = ["SELECT", "FROM", "WHERE", "JOIN", "GROUP BY", "ORDER BY", "HAVING", "LIMIT"]
    return [
        CompletionItem(
            label=kw,
            kind="keyword",
            insert_text=kw,
            sort_text=str(i).zfill(5)
        )
        for i, kw in enumerate(keywords)
    ]


def get_all_columns_unfiltered(schema_data: List[Dict[str, Any]]) -> List[CompletionItem]:
    """Get all columns from all tables (used when SQL parsing fails)"""
    suggestions = []
    idx = 0

    for db in schema_data:
        for schema in db.get("schemas", []):
            for table in schema.get("tables", []):
                for col in table.get("columns", []):
                    suggestions.append(CompletionItem(
                        label=col["name"],
                        kind="column",
                        detail=f"  {table['table']}",
                        documentation=f"Column from {schema['schema']}.{table['table']}",
                        insert_text=col["name"],
                        sort_text=str(idx).zfill(5)
                    ))
                    idx += 1

    return suggestions


def get_all_tables_unfiltered(schema_data: List[Dict[str, Any]]) -> List[CompletionItem]:
    """Get all tables and schemas (used when SQL parsing fails)"""
    suggestions = []
    idx = 0
    seen_schemas = set()

    for db in schema_data:
        for schema in db.get("schemas", []):
            schema_name = schema["schema"]

            # Add schema name
            if schema_name not in seen_schemas:
                suggestions.append(CompletionItem(
                    label=schema_name,
                    kind="schema",
                    detail="  (schema)",
                    insert_text=schema_name,
                    sort_text=str(idx).zfill(5)
                ))
                idx += 1
                seen_schemas.add(schema_name)

            # Add tables
            for table in schema.get("tables", []):
                suggestions.append(CompletionItem(
                    label=table["table"],
                    kind="table",
                    detail=f"  {schema_name}",
                    insert_text=table["table"],
                    sort_text=str(idx).zfill(5)
                ))
                idx += 1

    return suggestions


def extract_tables_in_scope(ast: exp.Expression) -> List[str]:
    """Extract table names from FROM and JOIN clauses of the main SELECT (not CTEs)"""
    tables = []

    # The main SELECT can have CTEs attached to it
    # We want to look at the FROM/JOIN in the main SELECT only
    if isinstance(ast, exp.Select):
        # Get FROM clause (note: sqlglot uses 'from_' key)
        if ast.args.get('from_'):
            from_clause = ast.args['from_']
            if isinstance(from_clause.this, exp.Table):
                tables.append(from_clause.this.name)

        # Get JOIN clauses (only direct children of main SELECT)
        for join in ast.args.get('joins') or []:
            if isinstance(join.this, exp.Table):
                tables.append(join.this.name)

    return tables


def extract_table_aliases(ast: exp.Expression) -> Dict[str, str]:
    """Extract table alias mappings"""
    aliases = {}

    for node in ast.find_all(exp.Table):
        if node.alias:
            aliases[node.alias] = node.name

    return aliases


def extract_cte_names(ast: exp.Expression) -> List[str]:
    """Extract CTE names from WITH clause"""
    cte_names = []

    for node in ast.find_all(exp.CTE):
        if node.alias:
            cte_names.append(node.alias)

    return cte_names


def extract_cte_columns(ast: exp.Expression) -> Dict[str, List[str]]:
    """Extract column names from CTE SELECT statements"""
    cte_columns = {}

    for cte_node in ast.find_all(exp.CTE):
        if not cte_node.alias:
            continue

        cte_name = cte_node.alias
        columns = []

        select = cte_node.this
        if isinstance(select, exp.Select):
            for expr in select.expressions:
                if isinstance(expr, exp.Alias):
                    columns.append(expr.alias)
                elif isinstance(expr, exp.Column):
                    columns.append(expr.name)
                elif isinstance(expr, exp.Star):
                    columns.append("*")

        cte_columns[cte_name] = columns

    return cte_columns


class MentionItem(BaseModel):
    """Mention suggestion for chat interface"""
    id: Optional[int] = None  # For questions/dashboards, None for tables
    name: str
    schema: Optional[str] = None  # For tables
    type: str  # "table" | "question" | "dashboard"
    display_text: str  # What to show in dropdown
    insert_text: str  # What to insert (JSON string)


def get_mention_completions(
    prefix: str,
    schema_data: List[Dict[str, Any]],
    available_questions: List[Dict[str, Any]] = None,
    mention_type: str = "all"  # "all" | "questions"
) -> List[MentionItem]:
    """
    Get mention suggestions for chat interface.

    Args:
        prefix: Text after @ or @@ symbol
        schema_data: Database schema information
        available_questions: List of available questions and dashboards
        mention_type: "all" (@ - tables + questions + dashboards) or "questions" (@@ - questions + dashboards only)

    Returns:
        List of mention items with structured data
    """
    suggestions = []
    prefix_lower = prefix.lower()

    # Add table mentions (only if mention_type is "all")
    if mention_type == "all" and schema_data:
        for db in schema_data:
            for schema in db.get("schemas", []):
                schema_name = schema["schema"]
                for table in schema.get("tables", []):
                    table_name = table["table"]
                    qualified_name = f"{schema_name}.{table_name}"

                    # Filter by prefix
                    if prefix_lower and not (
                        table_name.lower().startswith(prefix_lower) or
                        qualified_name.lower().startswith(prefix_lower)
                    ):
                        continue

                    # Create clean mention text
                    suggestions.append(MentionItem(
                        id=None,
                        name=table_name,
                        schema=schema_name,
                        type="table",
                        display_text=f"{table_name}",
                        insert_text=f"@{schema_name}.{table_name}"
                    ))

    # Add question/dashboard mentions
    if available_questions:
        for q in available_questions:
            q_id = q.get("id")
            q_name = q.get("name", "")
            q_alias = q.get("alias", "")
            q_type = q.get("type", "question")  # "question" or "dashboard"

            # Filter by prefix
            if prefix_lower and not (
                q_name.lower().startswith(prefix_lower) or
                q_alias.lower().startswith(prefix_lower)
            ):
                continue

            # Create clean mention text using alias (snake_case version with ID)
            # Use @@ for questions
            prefix_symbol = "@@" if mention_type == "questions" else "@@"

            suggestions.append(MentionItem(
                id=q_id,
                name=q_name,
                schema=None,
                type=q_type,
                display_text=f"{q_name}",
                insert_text=f"{prefix_symbol}{q_alias}"
            ))

    return suggestions
