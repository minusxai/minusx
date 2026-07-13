#!/usr/bin/env bash
# Only runs in Anthropic cloud sessions
[ "$CLAUDE_CODE_REMOTE" != "true" ] && exit 0

set -euo pipefail
ROOT="$CLAUDE_PROJECT_DIR"

echo "[cloud-setup] Installing frontend dependencies..."
cd "$ROOT/frontend" && npm install --prefer-offline

echo "[cloud-setup] Writing frontend/.env..."
# Single Next.js app — the agent orchestrator runs in-process. LLM providers
# are configured IN-APP (setup wizard / Settings → Models); .env only carries
# the auth secret. NEXTAUTH_SECRET must be set in the cloud environment vars.
if [ ! -f "$ROOT/frontend/.env" ]; then
  cat > "$ROOT/frontend/.env" <<EOF
NEXTAUTH_SECRET=${NEXTAUTH_SECRET:-dev-secret-change-me}
BASE_DUCKDB_DATA_PATH=..
EOF
fi

# The documents DB is seeded automatically at workspace/company registration
# (no manual import step).

echo "[cloud-setup] Downloading sample DuckDB data..."
mkdir -p "$ROOT/data"
if [ ! -f "$ROOT/data/mxfood.duckdb" ]; then
  curl -fSL -o "$ROOT/data/mxfood.duckdb" \
    https://github.com/minusxai/sample_datasets/releases/download/v1.0/mxfood.duckdb \
    || echo "[cloud-setup] WARNING: mxfood.duckdb download failed (non-fatal)"
fi

echo "[cloud-setup] Done."
