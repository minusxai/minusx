#!/usr/bin/env python3
"""Export Atlas file JSON schema to stdout for TypeScript codegen.

Usage (from repo root):
    uv run python backend/scripts/export_schema.py | npx json2ts > frontend/lib/types.gen.ts
Or via npm script:
    cd frontend && npm run generate-types
"""
import sys, os

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from tasks.agents.analyst.file_schema import ATLAS_FILE_SCHEMA_JSON
print(ATLAS_FILE_SCHEMA_JSON)
