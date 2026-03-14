"""SQL syntax validation using sqlglot with position-preserving preprocessing."""

import re
from dataclasses import dataclass

import sqlglot
from sqlglot.errors import ParseError


@dataclass
class SqlError:
    message: str
    line: int      # 1-indexed
    col: int       # 1-indexed
    end_col: int   # 1-indexed


@dataclass
class ValidationResult:
    valid: bool
    errors: list[SqlError]


def _param_to_literal(m: re.Match) -> str:
    """Replace :paramName with a same-length string literal to preserve column positions."""
    total_len = len(m.group(0))
    inner = max(total_len - 2, 0)
    return "'" + "x" * inner + "'"


def _preprocess_query(query: str) -> str:
    """Replace :params and @references with same-width valid SQL tokens."""
    # :paramName → same-length string literal e.g. ':start_date' (11) → "'xxxxxxxxx'" (11)
    result = re.sub(r':([a-zA-Z_]\w*)', _param_to_literal, query)
    # @alias → _alias (replace @ with _, same width)
    result = re.sub(r'@(?=\w)', '_', result)
    return result


def validate_sql(query: str, dialect: str = "postgres") -> ValidationResult:
    """
    Validate SQL syntax and return errors with position info.

    Args:
        query: Raw SQL (may contain :params and @references)
        dialect: sqlglot dialect name (e.g. 'postgres', 'duckdb', 'bigquery')

    Returns:
        ValidationResult with valid=True if no errors, or a list of SqlErrors
    """
    stripped = query.strip()
    if not stripped:
        return ValidationResult(valid=True, errors=[])

    preprocessed = _preprocess_query(stripped)

    try:
        sqlglot.transpile(preprocessed, read=dialect, error_level=sqlglot.ErrorLevel.RAISE)
        return ValidationResult(valid=True, errors=[])
    except ParseError as e:
        errors = []
        for err in e.errors:
            description = err.get('description', str(e))
            line = err.get('line', 1)
            col = err.get('col', 1)
            highlight = err.get('highlight', '')
            start_context = err.get('start_context', '')
            end_context = err.get('end_context', '')

            # Build a readable message: "near '...highlight...' — description"
            snippet = (start_context + highlight + end_context).strip()
            if len(snippet) > 40:
                snippet = snippet[:40] + '...'
            if snippet:
                message = f"Syntax error near `{snippet}`: {description}"
            else:
                message = f"Syntax error: {description}"

            # Widen the marker: extend left to cover start_context so the squiggly
            # covers the likely mistake area, not just the token where the parser gave up
            context_len = len(start_context.rstrip()) if start_context else 0
            start_col = max(1, col - context_len)
            highlight_len = len(highlight) if highlight else 1
            end_col = col + max(highlight_len, 1)

            errors.append(SqlError(
                message=message,
                line=line,
                col=start_col,
                end_col=end_col,
            ))

        if not errors:
            errors.append(SqlError(message=str(e), line=1, col=1, end_col=2))

        return ValidationResult(valid=False, errors=errors)
