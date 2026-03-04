#!/usr/bin/env bash
set -euo pipefail

# MinusX setup script — run from the cloned repo root
# Usage: ./install.sh

REPO_RAW="https://raw.githubusercontent.com/minusxai/minusx/main"

# ── helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m[ok]\033[0m    %s\n' "$*"; }
err()   { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "$1 is required but not installed."
    exit 1
  fi
}

# ── prerequisites ────────────────────────────────────────────────────────────

info "Checking prerequisites..."
check_cmd docker

if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  err "docker compose (v2 plugin) or docker-compose (standalone) is required."
  exit 1
fi
ok "Found $COMPOSE"

# ── .env files (idempotent — never overwrite existing) ───────────────────────

mkdir -p backend frontend

if [ -f backend/.env ]; then
  ok "backend/.env exists — skipping"
else
  info "Enter your Anthropic API key (get one at https://console.anthropic.com):"
  read -r ANTHROPIC_API_KEY
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    err "ANTHROPIC_API_KEY is required."
    exit 1
  fi
  cat > backend/.env <<EOF
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
EOF
  ok "Wrote backend/.env"
fi

if [ -f frontend/.env ]; then
  ok "frontend/.env exists — skipping"
else
  NEXTAUTH_SECRET=$(openssl rand -base64 32)
  cat > frontend/.env <<EOF
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
EOF
  ok "Wrote frontend/.env (generated NEXTAUTH_SECRET)"
fi

# ── sample data ──────────────────────────────────────────────────────────────

mkdir -p data
if [ -f data/mxfood.duckdb ]; then
  ok "data/mxfood.duckdb exists — skipping download"
else
  info "Downloading sample data..."
  if curl -fSL -o data/mxfood.duckdb https://github.com/minusxai/sample_datasets/releases/download/v1.0/mxfood.duckdb; then
    ok "Downloaded data/mxfood.duckdb"
  else
    err "Failed to download sample data (non-fatal). You can add your own DuckDB file to data/ later."
  fi
fi

# ── start ────────────────────────────────────────────────────────────────────

info "Pulling latest images..."
$COMPOSE -f docker-compose.prod.yml pull

info "Starting MinusX..."
$COMPOSE -f docker-compose.prod.yml up -d

echo ""
ok "MinusX is running!"
echo "   Open http://localhost:3000 in your browser."
echo ""
echo "   Useful commands:"
echo "     $COMPOSE -f docker-compose.prod.yml logs -f        # follow logs"
echo "     $COMPOSE -f docker-compose.prod.yml down           # stop"
echo "     $COMPOSE -f docker-compose.prod.yml pull && $COMPOSE -f docker-compose.prod.yml up -d  # upgrade"
