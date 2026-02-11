"""
Centralized environment configuration with validation

Session token approach: No shared secrets needed!
When Next.js calls Python, it passes a one-time session token.
Python echoes this token back when calling Next.js internal APIs.
"""

import os
from typing import Optional

def _get_optional(value: Optional[str], default: str) -> str:
    return value if value else default

# Load configuration
NEXTJS_URL = _get_optional(os.getenv('NEXTJS_URL'), 'http://localhost:3000')
BASE_DUCKDB_DATA_PATH = _get_optional(os.getenv('BASE_DUCKDB_DATA_PATH'), '..')

# API Keys (optional)
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Debug flags
DEBUG_DURATION = os.environ.get('DEBUG_DURATION', 'False').lower() == 'true'
