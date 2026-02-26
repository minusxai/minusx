"""LLM configuration constants for task orchestration."""

import os

# MODEL LIST 19-02-2026
CODING_MODEL = "claude-sonnet-4-6"
SUMMARIZE_FILTER_MODEL = "gpt-5-mini-2025-08-07"

# Model configurations
DEFAULT_MODEL = CODING_MODEL
ANALYST_V2_MODEL = CODING_MODEL

# Token and step limits
MAX_TOKENS = 4000
MAX_STEPS_LOWER_LEVEL = 35

# Debug flags
DEBUG_DURATION = os.environ.get('DEBUG_DURATION', "False").lower() == 'true'

MX_API_BASE_URL = os.environ.get("MX_API_BASE_URL")  # e.g. http://localhost:9000
MX_API_KEY = os.environ.get("MX_API_KEY", "")

HTTP_MAX_CONNECTIONS = 500
HTTP_KEEPALIVE_EXPIRY = 300
HTTP_TIMEOUT = 120.0

if MX_API_BASE_URL:
    os.environ.setdefault("ANTHROPIC_API_KEY", "NONE")
    os.environ.setdefault("OPENAI_API_KEY", "NONE")
