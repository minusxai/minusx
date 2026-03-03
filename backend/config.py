"""
Centralized environment configuration with validation

Session token approach: No shared secrets needed!
When Next.js calls Python, it passes a one-time session token.
Python echoes this token back when calling Next.js internal APIs.
"""

import os
from pathlib import Path
from typing import Optional

def _get_optional(value: Optional[str], default: str) -> str:
    return value if value else default

# Load configuration
NEXTJS_URL = _get_optional(os.getenv('NEXTJS_URL'), 'http://localhost:3000')
BASE_DUCKDB_DATA_PATH = _get_optional(os.getenv('BASE_DUCKDB_DATA_PATH'), '..')


def resolve_duckdb_path(file_path: str) -> str:
    """Resolve a DuckDB file_path to an absolute filesystem path.

    Handles three cases:
    1. Relative path  → prepend BASE_DUCKDB_DATA_PATH (existing behaviour).
    2. Absolute path that does NOT start with /app → use as-is.
    3. Absolute path starting with /app AND /app doesn't exist locally →
       the path is a Docker production path being used in a local dev
       environment.  Remap it by replacing /app with BASE_DUCKDB_DATA_PATH
       so `file_path=/app/data/mxfood.duckdb` resolves to
       `{BASE_DUCKDB_DATA_PATH}/data/mxfood.duckdb`.

    Detection is filesystem-based: /app only exists inside the Docker
    container, never on a developer machine, so no env-var guessing is
    needed.
    """
    p = Path(file_path)
    if not p.is_absolute():
        return str(Path(BASE_DUCKDB_DATA_PATH) / file_path)

    # Remap /app/... → BASE_DUCKDB_DATA_PATH/... when not running in Docker
    if file_path.startswith('/app') and not Path('/app').exists():
        relative_part = file_path[len('/app'):].lstrip('/')
        return str(Path(BASE_DUCKDB_DATA_PATH) / relative_part)

    return file_path

# API Keys (optional)
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Debug flags
DEBUG_DURATION = os.environ.get('DEBUG_DURATION', 'False').lower() == 'true'
