#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/minusxai/minusx/main"
BACKEND_IMAGE="ghcr.io/minusxai/minusx-backend-canary:latest"
FRONTEND_IMAGE="ghcr.io/minusxai/minusx-frontend-canary:latest"

# ── helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m[ok]\033[0m    %s\n' "$*"; }
err()   { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }

# Read the value of KEY from FILE (grep-based, never sources the file)
get_env_val() {
  local file="$1" key="$2"
  if [ -f "$file" ]; then
    grep -E "^${key}=" "$file" | head -1 | cut -d'=' -f2-
  fi
}

# Upsert KEY=VALUE in FILE — replaces existing line or appends
set_env_val() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    # replace in place (compatible with both macOS and Linux sed)
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

find_free_port() {
  local port="$1"
  while nc -z localhost "$port" 2>/dev/null; do
    port=$((port + 1))
  done
  echo "$port"
}

# ── prerequisites ────────────────────────────────────────────────────────────

info "Checking prerequisites..."

if ! command -v docker &>/dev/null; then
  err "Docker is not installed."
  err "Install it from https://docs.docker.com/get-docker/ and re-run this script."
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  err "Docker is installed but not running."
  err "Start Docker and re-run this script."
  exit 1
fi

ok "Docker is running"

# ── port detection ────────────────────────────────────────────────────────────

FRONTEND_PORT=$(find_free_port 3000)
BACKEND_PORT=$(find_free_port 8001)

if [ "$FRONTEND_PORT" -ne 3000 ]; then
  info "Port 3000 is in use — using $FRONTEND_PORT for frontend"
fi
if [ "$BACKEND_PORT" -ne 8001 ]; then
  info "Port 8001 is in use — using $BACKEND_PORT for backend"
fi

# ── env files ────────────────────────────────────────────────────────────────

mkdir -p backend frontend data data/pglite static

# Download .env.example files if missing (supports curl | bash from scratch)
if [ ! -f backend/.env.example ]; then
  curl -fsSL -o backend/.env.example "${REPO_RAW}/backend/.env.example" 2>/dev/null || true
fi
if [ ! -f frontend/.env.example ]; then
  curl -fsSL -o frontend/.env.example "${REPO_RAW}/frontend/.env.example" 2>/dev/null || true
fi

# Ensure .env files exist (seeded from examples if available, else empty)
[ -f backend/.env ]  || { [ -f backend/.env.example ]  && cp backend/.env.example backend/.env  || touch backend/.env; }
[ -f frontend/.env ] || { [ -f frontend/.env.example ] && cp frontend/.env.example frontend/.env || touch frontend/.env; }

# ANTHROPIC_API_KEY
ANTHROPIC_API_KEY=$(get_env_val backend/.env ANTHROPIC_API_KEY)
if [ -z "$ANTHROPIC_API_KEY" ]; then
  info "Enter your Anthropic API key (get one at https://console.anthropic.com):"
  read -r ANTHROPIC_API_KEY
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    err "ANTHROPIC_API_KEY is required."
    exit 1
  fi
  set_env_val backend/.env ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"
  ok "Saved ANTHROPIC_API_KEY to backend/.env"
else
  ok "ANTHROPIC_API_KEY already set — skipping"
fi

# NEXTAUTH_SECRET
NEXTAUTH_SECRET=$(get_env_val frontend/.env NEXTAUTH_SECRET)
if [ -z "$NEXTAUTH_SECRET" ]; then
  if command -v openssl &>/dev/null; then
    NEXTAUTH_SECRET=$(openssl rand -base64 32)
  else
    NEXTAUTH_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
  fi
  set_env_val frontend/.env NEXTAUTH_SECRET "$NEXTAUTH_SECRET"
  ok "Generated and saved NEXTAUTH_SECRET to frontend/.env"
else
  ok "NEXTAUTH_SECRET already set — skipping"
fi

# ── pull images ───────────────────────────────────────────────────────────────

info "Pulling latest images..."
docker pull --platform linux/amd64 "$BACKEND_IMAGE"
docker pull --platform linux/amd64 "$FRONTEND_IMAGE"

# ── network ───────────────────────────────────────────────────────────────────

docker network create minusx-network 2>/dev/null || true

# ── stop existing containers (idempotent) ─────────────────────────────────────

docker rm -f mx-backend mx-frontend 2>/dev/null || true

# ── start backend ─────────────────────────────────────────────────────────────

info "Starting backend on port $BACKEND_PORT..."
docker run -d \
  --name mx-backend \
  --platform linux/amd64 \
  --network minusx-network \
  --restart unless-stopped \
  -v "$(pwd)/data:/app/data" \
  -p "${BACKEND_PORT}:8001" \
  -e PYTHONUNBUFFERED=1 \
  -e NEXTJS_URL="http://mx-frontend:3000" \
  -e BASE_DUCKDB_DATA_PATH=/app \
  --env-file backend/.env \
  "$BACKEND_IMAGE"

# ── start frontend ────────────────────────────────────────────────────────────

info "Starting frontend on port $FRONTEND_PORT..."
docker run -d \
  --name mx-frontend \
  --platform linux/amd64 \
  --network minusx-network \
  --restart unless-stopped \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/data/pglite:/app/data/pglite" \
  -v "$(pwd)/static:/app/public/static" \
  -p "${FRONTEND_PORT}:3000" \
  -e NODE_ENV=production \
  -e NEXT_PUBLIC_BACKEND_URL="http://mx-backend:8001" \
  -e BASE_DUCKDB_DATA_PATH=/app \
  -e ANALYTICS_DB_DIR=/app/data/analytics \
  -e DB_TYPE=pglite \
  -e PGLITE_DATA_DIR=/app/data/pglite \
  --env-file frontend/.env \
  "$FRONTEND_IMAGE"

# ── done ─────────────────────────────────────────────────────────────────────

echo ""
ok "MinusX is starting up!"
echo "   Open http://localhost:${FRONTEND_PORT} in your browser."
echo "   (The app may take ~30 seconds to be ready on first start.)"
echo ""
echo "   Useful commands:"
echo "     docker logs -f mx-frontend        # follow frontend logs"
echo "     docker logs -f mx-backend         # follow backend logs"
echo "     docker rm -f mx-frontend mx-backend  # stop and remove"
echo "     bash install.sh                   # upgrade to latest images"
