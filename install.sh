#!/usr/bin/env bash
set -euo pipefail

# ── config ───────────────────────────────────────────────────────────────────

REPO_RAW="https://raw.githubusercontent.com/minusxai/minusx/main"

# Image selection.
#   default            → stable release image (what OSS users want)
#   --canary           → bleeding-edge image built from every push to main
#   --image=<full ref> → pin to an explicit image reference
#   MX_IMAGE env var   → explicit override, wins over flags
# Piped usage: curl -fsSL minusx.ai/install.sh | bash -s -- --canary
STABLE_IMAGE="ghcr.io/minusxai/minusx-frontend:latest"
CANARY_IMAGE="ghcr.io/minusxai/minusx-frontend-canary:latest"
FRONTEND_IMAGE="$STABLE_IMAGE"
CHANNEL="stable"
for arg in "$@"; do
  case "$arg" in
    --canary)  FRONTEND_IMAGE="$CANARY_IMAGE"; CHANNEL="canary" ;;
    --stable)  FRONTEND_IMAGE="$STABLE_IMAGE"; CHANNEL="stable" ;;
    --image=*) FRONTEND_IMAGE="${arg#*=}";     CHANNEL="custom" ;;
  esac
done
# Explicit env override always wins.
if [ -n "${MX_IMAGE:-}" ]; then
  FRONTEND_IMAGE="$MX_IMAGE"
  CHANNEL="custom"
fi

TOTAL_STEPS=6
CURRENT_STEP=0

# ── colors & symbols ────────────────────────────────────────────────────────

BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'
BLUE='\033[38;5;75m'
GREEN='\033[38;5;114m'
RED='\033[38;5;203m'
YELLOW='\033[38;5;221m'
CYAN='\033[38;5;116m'
WHITE='\033[38;5;255m'
GRAY='\033[38;5;245m'

CHECKMARK="${GREEN}✔${RESET}"
CROSS="${RED}✖${RESET}"
ARROW="${CYAN}→${RESET}"
SPARKLE="${YELLOW}✦${RESET}"

# ── helpers ──────────────────────────────────────────────────────────────────

step() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  printf "\n${BOLD}${BLUE}[%d/%d]${RESET} ${BOLD}${WHITE}%s${RESET}\n" "$CURRENT_STEP" "$TOTAL_STEPS" "$*"
}

info()    { printf "  ${GRAY}%b${RESET}\n" "$*"; }
success() { printf "  ${CHECKMARK} %b\n" "$*"; }
warn()    { printf "  ${YELLOW}!${RESET} %b\n" "$*"; }
fail()    { printf "  ${CROSS} ${RED}%b${RESET}\n" "$*" >&2; }

# Spinner for long-running commands
spin() {
  local pid=$1 msg=$2
  local frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}%s${RESET} ${DIM}%s${RESET}" "${frames[$((i % 10))]}" "$msg"
    i=$((i + 1))
    sleep 0.1
  done
  wait "$pid"
  local exit_code=$?
  printf "\r\033[K"  # clear spinner line
  return $exit_code
}

# Run a command silently with a spinner
run_with_spinner() {
  local msg="$1"; shift
  "$@" > /tmp/minusx-install.log 2>&1 &
  local pid=$!
  if spin "$pid" "$msg"; then
    success "$msg"
  else
    fail "$msg"
    printf "\n${DIM}"
    tail -5 /tmp/minusx-install.log
    printf "${RESET}\n"
    return 1
  fi
}

get_env_val() {
  local file="$1" key="$2"
  if [ -f "$file" ]; then
    # `|| true`: a missing key must return empty, not kill the script —
    # grep exits 1 on no match and we run under `set -euo pipefail`.
    grep -E "^${key}=" "$file" | head -1 | cut -d'=' -f2- || true
  fi
}

set_env_val() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
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

# ── banner ───────────────────────────────────────────────────────────────────

printf "\n"
printf "${BOLD}${BLUE}  ╔══════════════════════════════════════╗${RESET}\n"
printf "${BOLD}${BLUE}  ║         ${WHITE}MinusX OSS Installer${BLUE}         ║${RESET}\n"
printf "${BOLD}${BLUE}  ╚══════════════════════════════════════╝${RESET}\n"
printf "${DIM}  Open-source BI tool — https://minusx.ai${RESET}\n"

# ── step 1: prerequisites ───────────────────────────────────────────────────

step "Checking prerequisites"

if ! command -v docker &>/dev/null; then
  fail "Docker is not installed"
  printf "\n  ${ARROW} Install it from ${BOLD}https://docs.docker.com/get-docker/${RESET}\n"
  printf "  ${ARROW} Then re-run this script\n\n"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  fail "Docker is installed but not running"
  printf "\n  ${ARROW} Start Docker Desktop and re-run this script\n\n"
  exit 1
fi

success "Docker is running"

# ── step 2: setup directory ─────────────────────────────────────────────────

step "Setting up project directory"

if [ "$(basename "$(pwd)")" = "minusx" ]; then
  info "Using current directory"
else
  mkdir -p minusx
  cd minusx
fi

mkdir -p frontend data data/pglite data/analytics static

success "Directory ready at ${DIM}$(pwd)${RESET}"

# ── step 3: configure environment ───────────────────────────────────────────

step "Configuring environment"

# MinusX is a single Next.js app — the AI agent orchestrator runs in-process,
# so all configuration lives in frontend/.env (there is no separate backend).
if [ ! -f frontend/.env.example ]; then
  curl -fsSL -o frontend/.env.example "${REPO_RAW}/frontend/.env.example" 2>/dev/null || true
fi
[ -f frontend/.env ] || { [ -f frontend/.env.example ] && cp frontend/.env.example frontend/.env || touch frontend/.env; }

# LLM configuration lives IN THE APP (setup wizard "AI Models" step / Settings
# → Models). Env vars are INITIAL configuration only: a key present at first
# boot is converted into the in-app config (secrets store) and never read
# again. Offer the optional key prompt for one-command setups; Enter to skip
# and configure in the wizard instead.
# Docs: https://docs.minusx.ai/docs/self-hosting/llm-providers
ANTHROPIC_API_KEY=$(get_env_val frontend/.env ANTHROPIC_API_KEY)
ANALYST_MODEL_CONFIG=$(get_env_val frontend/.env ANALYST_AGENT_MODEL_CONFIG)
if [ -n "$ANALYST_MODEL_CONFIG" ] || [ -n "$ANTHROPIC_API_KEY" ]; then
  success "LLM initial config detected — it will be imported into Settings → Models on first boot"
else
  printf "\n  ${SPARKLE} ${BOLD}Anthropic API Key${RESET} ${GRAY}(optional — seeds the in-app model config)${RESET}\n"
  printf "  ${GRAY}Get one at ${RESET}${BOLD}https://console.anthropic.com${RESET}\n"
  printf "  ${GRAY}Press Enter to skip and connect a provider in the setup wizard instead.${RESET}\n\n"
  printf "  ${ARROW} Enter your key: "
  # `|| true`: headless runs (CI, ssh without a tty) have no /dev/tty — treat
  # that as a skip instead of dying under `set -e`.
  read -r ANTHROPIC_API_KEY </dev/tty 2>/dev/null || ANTHROPIC_API_KEY=""
  echo ""
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    success "Skipped — the setup wizard will walk you through connecting a provider"
  else
    set_env_val frontend/.env ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"
    success "API key saved — it becomes the in-app model config on first boot"
  fi
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
  success "Auth secret generated"
else
  success "Auth secret already configured"
fi

# ── step 4: pull image ──────────────────────────────────────────────────────

step "Pulling latest Docker image (${CHANNEL})"

info "Image: ${DIM}${FRONTEND_IMAGE}${RESET}"
run_with_spinner "Pulling frontend image" docker pull --platform linux/amd64 "$FRONTEND_IMAGE"

# ── step 5: start service ───────────────────────────────────────────────────

step "Starting MinusX"

# Clean up existing container
docker rm -f mx-frontend 2>/dev/null || true

# Detect port
FRONTEND_PORT=$(find_free_port 3000)
if [ "$FRONTEND_PORT" -ne 3000 ]; then
  warn "Port 3000 in use — MinusX will use port ${BOLD}$FRONTEND_PORT${RESET}"
fi

docker run -d \
  --name mx-frontend \
  --platform linux/amd64 \
  --restart unless-stopped \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/data/pglite:/app/data/pglite" \
  -v "$(pwd)/static:/app/public/static" \
  -p "${FRONTEND_PORT}:3000" \
  -e NODE_ENV=production \
  -e BASE_DUCKDB_DATA_PATH=/app \
  -e ANALYTICS_DB_DIR=/app/data/analytics \
  -e DB_TYPE=pglite \
  -e PGLITE_DATA_DIR=/app/data/pglite \
  --env-file frontend/.env \
  "$FRONTEND_IMAGE" > /dev/null 2>&1

success "MinusX started on port ${BOLD}$FRONTEND_PORT${RESET}"

# ── step 6: health check ────────────────────────────────────────────────────

step "Waiting for MinusX to be ready"

HEALTH_URL="http://localhost:${FRONTEND_PORT}"
MAX_WAIT=60
WAITED=0
frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")

while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    printf "\r\033[K"
    success "MinusX is ready!"
    break
  fi
  i=$((WAITED % 10))
  printf "\r  ${CYAN}%s${RESET} ${DIM}Waiting for app to start... (%ds)${RESET}" "${frames[$i]}" "$WAITED"
  sleep 1
  WAITED=$((WAITED + 1))
done

if [ "$WAITED" -ge "$MAX_WAIT" ]; then
  printf "\r\033[K"
  warn "App is taking longer than expected — it may still be starting"
fi

# ── summary ──────────────────────────────────────────────────────────────────

printf "\n"
printf "${BOLD}${GREEN}  ╔══════════════════════════════════════╗${RESET}\n"
printf "${BOLD}${GREEN}  ║       ${WHITE}Installation Complete!${GREEN}         ║${RESET}\n"
printf "${BOLD}${GREEN}  ╚══════════════════════════════════════╝${RESET}\n"
printf "\n"
printf "  ${BOLD}${WHITE}Next steps:${RESET}\n"
printf "\n"
printf "  ${WHITE}1.${RESET} Open ${BOLD}${BLUE}http://localhost:${FRONTEND_PORT}${RESET} and create your company\n"
printf "  ${WHITE}2.${RESET} Read the docs at ${BOLD}${BLUE}https://docs.minusx.ai${RESET}\n"
printf "  ${WHITE}3.${RESET} Join our Slack community: ${BOLD}${BLUE}https://minusx.ai/slack${RESET}\n"
printf "\n"
printf "  ${GRAY}Your data is persisted in ${RESET}${DIM}$(pwd)/data${RESET}${GRAY} — safe across restarts & upgrades.${RESET}\n"
printf "\n"
printf "  ${GRAY}Useful commands:${RESET}\n"
printf "  ${DIM}  docker logs -f mx-frontend${RESET}          ${GRAY}# app logs${RESET}\n"
printf "  ${DIM}  docker rm -f mx-frontend${RESET}            ${GRAY}# stop & remove${RESET}\n"
printf "  ${DIM}  curl -fsSL minusx.ai/install.sh | bash${RESET} ${GRAY}# upgrade${RESET}\n"
printf "\n"
