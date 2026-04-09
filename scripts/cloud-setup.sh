#!/usr/bin/env bash
# Only runs in Anthropic cloud sessions
[ "$CLAUDE_CODE_REMOTE" != "true" ] && exit 0

set -euo pipefail
ROOT="$CLAUDE_PROJECT_DIR"

echo "[cloud-setup] Installing frontend dependencies..."
cd "$ROOT/frontend" && npm install --prefer-offline

echo "[cloud-setup] Installing backend dependencies..."
cd "$ROOT/backend" && uv sync

echo "[cloud-setup] Writing .env files..."
# frontend/.env — NEXTAUTH_SECRET must be set in cloud environment variables
if [ ! -f "$ROOT/frontend/.env" ]; then
  cat > "$ROOT/frontend/.env" <<EOF
NEXTAUTH_SECRET=${NEXTAUTH_SECRET:-dev-secret-change-me}
BASE_DUCKDB_DATA_PATH=..
EOF
fi
# backend/.env — ANTHROPIC_API_KEY must be set in cloud environment variables
if [ ! -f "$ROOT/backend/.env" ]; then
  cat > "$ROOT/backend/.env" <<EOF
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
EOF
fi

echo "[cloud-setup] Initialising documents database..."
cd "$ROOT/frontend" && npm run import-db -- --replace-db=y

echo "[cloud-setup] Downloading sample DuckDB data..."
mkdir -p "$ROOT/data"
if [ ! -f "$ROOT/data/mxfood.duckdb" ]; then
  curl -fSL -o "$ROOT/data/mxfood.duckdb" \
    https://github.com/minusxai/sample_datasets/releases/download/v1.0/mxfood.duckdb \
    || echo "[cloud-setup] WARNING: mxfood.duckdb download failed (non-fatal)"
fi

echo "[cloud-setup] Done."
