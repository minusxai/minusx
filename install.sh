#!/usr/bin/env bash
set -euo pipefail

# MinusX OSS setup — pulls & starts the app, and IN PARALLEL interviews you for
# workspace, LLM, and (optionally) database details, so the in-app setup wizard
# is already complete when you first log in.
#
#   curl -fsSL minusx.ai/install.sh | bash              # stable
#   curl -fsSL minusx.ai/install.sh | bash -s -- --canary
#
# How the pieces fit:
# - The interview reads prompts metadata from compatibility.json (frontend/compatibility.json,
#   fetched from raw.github) — the same file the app and docs consume.
# - Answers are VALIDATED with the app's own code, run inside the pulled image
#   (`docker run … node setup-cli/*.js`): a real one-token LLM call and a real
#   connector test — from the container network context the app will use.
# - Everything is then submitted in ONE call to POST /api/orgs/register
#   (first-run gated; API keys are extracted into the secrets store).
# - Piped stdin is the script itself, so ALL prompts read from /dev/tty; with
#   no TTY (CI) or an existing workspace (upgrade), the interview is skipped
#   and this is a plain pull-and-start (the pre-interview behavior).

# ── config ───────────────────────────────────────────────────────────────────

# MX_REPO_RAW override: point at a branch for testing pre-merge setup flows.
REPO_RAW="${MX_REPO_RAW:-https://raw.githubusercontent.com/minusxai/minusx/main}"
# Published images are amd64; MX_PLATFORM overrides for locally built images.
PLATFORM="${MX_PLATFORM:-linux/amd64}"

STABLE_IMAGE="ghcr.io/minusxai/minusx-frontend:latest"
CANARY_IMAGE="ghcr.io/minusxai/minusx-frontend-canary:latest"
FRONTEND_IMAGE="$STABLE_IMAGE"
CHANNEL="stable"
INTERVIEW="auto"
for arg in "$@"; do
  case "$arg" in
    --canary)  FRONTEND_IMAGE="$CANARY_IMAGE"; CHANNEL="canary" ;;
    --stable)  FRONTEND_IMAGE="$STABLE_IMAGE"; CHANNEL="stable" ;;
    --image=*) FRONTEND_IMAGE="${arg#*=}";     CHANNEL="custom" ;;
    --no-interview) INTERVIEW="off" ;;
  esac
done
if [ -n "${MX_IMAGE:-}" ]; then
  FRONTEND_IMAGE="$MX_IMAGE"
  CHANNEL="custom"
fi

TOTAL_STEPS=7
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

# ── helpers ──────────────────────────────────────────────────────────────────

step() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  printf "\n${BOLD}${BLUE}[%d/%d]${RESET} ${BOLD}${WHITE}%s${RESET}\n" "$CURRENT_STEP" "$TOTAL_STEPS" "$*"
}

info()    { printf "  ${GRAY}%b${RESET}\n" "$*"; }
success() { printf "  ${CHECKMARK} %b\n" "$*"; }
warn()    { printf "  ${YELLOW}!${RESET} %b\n" "$*"; }
fail()    { printf "  ${CROSS} ${RED}%b${RESET}\n" "$*" >&2; }

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
  printf "\r\033[K"
  return $exit_code
}

get_env_val() {
  local file="$1" key="$2"
  if [ -f "$file" ]; then
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

# Minimal JSON string escaper for interview answers (quotes, backslashes,
# newlines, tabs — the characters a terminal paste can realistically carry).
json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

# All interview input comes from /dev/tty (stdin is the piped script).
ask() { # ask <prompt> <default> -> REPLY_VALUE
  local prompt="$1" default="${2:-}"
  local suffix=""
  [ -n "$default" ] && suffix=" ${DIM}[$default]${RESET}"
  printf "  ${WHITE}%b${RESET}%b: " "$prompt" "$suffix" > /dev/tty
  IFS= read -r REPLY_VALUE < /dev/tty || REPLY_VALUE=""
  if [ -z "$REPLY_VALUE" ]; then REPLY_VALUE="$default"; fi
}

ask_secret() { # ask_secret <prompt> -> REPLY_VALUE (never echoed)
  local prompt="$1"
  printf "  ${WHITE}%b${RESET} ${DIM}(hidden)${RESET}: " "$prompt" > /dev/tty
  IFS= read -rs REPLY_VALUE < /dev/tty || REPLY_VALUE=""
  printf "\n" > /dev/tty
}

ask_multiline() { # ask_multiline <prompt> -> REPLY_VALUE (until an empty line)
  local prompt="$1" line acc=""
  printf "  ${WHITE}%b${RESET} ${DIM}(finish with an empty line)${RESET}:\n" "$prompt" > /dev/tty
  while IFS= read -r line < /dev/tty; do
    [ -z "$line" ] && break
    acc="${acc}${line}"$'\n'
  done
  REPLY_VALUE="$acc"
}

menu() { # menu <title> <opt1> <opt2> ... -> MENU_INDEX (0-based)
  local title="$1"; shift
  printf "  ${WHITE}%b${RESET}\n" "$title" > /dev/tty
  local i=1
  for opt in "$@"; do
    printf "    ${CYAN}%d)${RESET} %b\n" "$i" "$opt" > /dev/tty
    i=$((i + 1))
  done
  local choice
  while true; do
    printf "  ${WHITE}Choice${RESET} ${DIM}[1]${RESET}: " > /dev/tty
    IFS= read -r choice < /dev/tty || choice=""
    [ -z "$choice" ] && choice=1
    case "$choice" in
      *[!0-9]*) ;;
      *) if [ "$choice" -ge 1 ] && [ "$choice" -le $# ]; then MENU_INDEX=$((choice - 1)); return; fi ;;
    esac
    warn "Enter a number between 1 and $#" > /dev/tty
  done
}

# compatibility.json accessor — python3 keeps parsing honest (a bash JSON
# parser is a bug farm). Without python3 the interview degrades gracefully.
PYTHON_BIN="$(command -v python3 || true)"
compat() { # compat <python expression over `data`> — prints lines
  "$PYTHON_BIN" -c "
import json, sys
data = json.load(open('$COMPAT_FILE'))
$1
"
}

# Validation runner: executes an app-code CLI inside the pulled image. stdin
# carries the JSON (secrets never appear in argv), stdout is the JSON result.
run_in_image() { # run_in_image <script> [arg]
  docker run --rm -i \
    --add-host=host.docker.internal:host-gateway \
    --env-file frontend/.env \
    "$FRONTEND_IMAGE" \
    node "setup-cli/$1" ${2:-} 2>/dev/null
}

# Rewrite host-local DB addresses to the address the container sees.
container_host() {
  case "$1" in
    localhost|127.0.0.1) echo "host.docker.internal" ;;
    *) echo "$1" ;;
  esac
}

# ── banner ───────────────────────────────────────────────────────────────────

printf "\n"
printf "${BOLD}${BLUE}  ╔══════════════════════════════════════╗${RESET}\n"
printf "${BOLD}${BLUE}  ║           ${WHITE}MinusX OSS Setup${BLUE}           ║${RESET}\n"
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

# ── step 2: project directory ───────────────────────────────────────────────

step "Setting up project directory"

if [ "$(basename "$(pwd)")" = "minusx" ]; then
  info "Using current directory"
else
  mkdir -p minusx
  cd minusx
fi

mkdir -p frontend data data/pglite data/analytics static

# An existing workspace means this run is an UPGRADE: no interview, no
# registration — just pull the newer image and restart on the same data.
EXISTING_WORKSPACE=0
if [ -n "$(ls -A data/pglite 2>/dev/null)" ]; then
  EXISTING_WORKSPACE=1
fi

success "Directory ready at ${DIM}$(pwd)${RESET}"

# ── step 3: environment ─────────────────────────────────────────────────────

step "Configuring environment"

if [ ! -f frontend/.env.example ]; then
  curl -fsSL -o frontend/.env.example "${REPO_RAW}/frontend/.env.example" 2>/dev/null || true
fi
[ -f frontend/.env ] || { [ -f frontend/.env.example ] && cp frontend/.env.example frontend/.env || touch frontend/.env; }

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

# ── step 4: pull image (background) + interview (foreground) ────────────────

step "Pulling Docker image (${CHANNEL}) — answering setup questions meanwhile"

info "Image: ${DIM}${FRONTEND_IMAGE}${RESET}"
PULL_LOG=$(mktemp "${TMPDIR:-/tmp}/minusx-pull.XXXXXX")
docker pull --platform "$PLATFORM" "$FRONTEND_IMAGE" > "$PULL_LOG" 2>&1 &
PULL_PID=$!

# Interview state (empty = not collected)
WS_NAME=""; ADMIN_NAME=""; ADMIN_EMAIL=""; ADMIN_PASSWORD=""
LLM_JSON=""; CONNECTION_JSON=""
LLM_PROVIDER_ID=""; LLM_KIND=""; LLM_API_KEY=""; LLM_AWS_REGION=""; LLM_BASE_URL=""
LLM_ANALYST_MODEL=""; LLM_MICRO_MODEL=""
CONN_TYPE=""; CONN_NAME=""; CONN_CONFIG_JSON=""

# -r/-w on /dev/tty only test permissions; actually OPEN it — without a
# controlling terminal (CI, cron) the open fails with ENXIO.
HAVE_TTY=0
if [ "$INTERVIEW" != "off" ] && { : < /dev/tty; } 2>/dev/null; then
  HAVE_TTY=1
fi

COMPAT_FILE=$(mktemp "${TMPDIR:-/tmp}/minusx-compat.XXXXXX")
HAVE_COMPAT=0
if [ "$HAVE_TTY" = 1 ] && [ "$EXISTING_WORKSPACE" = 0 ]; then
  if curl -fsSL -o "$COMPAT_FILE" "${REPO_RAW}/frontend/compatibility.json" 2>/dev/null && [ -n "$PYTHON_BIN" ]; then
    HAVE_COMPAT=1
  fi
fi

# Assemble the llm config JSON from the collected answers.
LLM_ENTRY_JSON=""
build_llm_json() {
  local entry_fields="\"name\":\"$(json_escape "$LLM_PROVIDER_ID")\",\"provider\":\"$(json_escape "$LLM_PROVIDER_ID")\""
  [ -n "$LLM_API_KEY" ]    && entry_fields="$entry_fields,\"apiKey\":\"$(json_escape "$LLM_API_KEY")\""
  [ -n "$LLM_AWS_REGION" ] && entry_fields="$entry_fields,\"awsRegion\":\"$(json_escape "$LLM_AWS_REGION")\""
  [ -n "$LLM_BASE_URL" ]   && entry_fields="$entry_fields,\"baseUrl\":\"$(json_escape "$LLM_BASE_URL")\""
  LLM_ENTRY_JSON="{$entry_fields}"
  if [ "$LLM_KIND" = "managed" ]; then
    # Managed provider: no assignments needed — the gateway routes per use case.
    LLM_JSON="{\"providers\":[$LLM_ENTRY_JSON]}"
  else
    LLM_JSON="{\"providers\":[$LLM_ENTRY_JSON],\"assignments\":{\"analyst\":{\"chain\":[{\"providerName\":\"$(json_escape "$LLM_PROVIDER_ID")\",\"model\":\"$(json_escape "$LLM_ANALYST_MODEL")\"}]},\"micro\":{\"chain\":[{\"providerName\":\"$(json_escape "$LLM_PROVIDER_ID")\",\"model\":\"$(json_escape "$LLM_MICRO_MODEL")\"}]}}}"
  fi
}

interview_llm_credentials() {
  LLM_API_KEY=""; LLM_AWS_REGION=""; LLM_BASE_URL=""
  case "$LLM_PROVIDER_ID" in
    amazon-bedrock)
      ask_secret "Bedrock API key (bearer token)"; LLM_API_KEY="$REPLY_VALUE"
      ask "AWS region" "us-east-1"; LLM_AWS_REGION="$REPLY_VALUE"
      ;;
    custom)
      ask "Base URL (OpenAI-compatible endpoint)" ""; LLM_BASE_URL="$REPLY_VALUE"
      ask_secret "API key (leave empty if none)"; LLM_API_KEY="$REPLY_VALUE"
      ;;
    *)
      ask_secret "API key"; LLM_API_KEY="$REPLY_VALUE"
      ;;
  esac
}

interview_llm_models() {
  [ "$LLM_KIND" = "managed" ] && return 0
  local analyst_default="" micro_default=""
  if [ "$HAVE_COMPAT" = 1 ] && [ "$LLM_KIND" = "registry" ]; then
    analyst_default=$(compat "
p = next(p for p in data['llm']['providers'] if p['id'] == '$LLM_PROVIDER_ID')
print(p.get('defaults', {}).get('analyst', ''))")
    micro_default=$(compat "
p = next(p for p in data['llm']['providers'] if p['id'] == '$LLM_PROVIDER_ID')
print(p.get('defaults', {}).get('micro', ''))")
    info "Suggested models:"
    compat "
p = next(p for p in data['llm']['providers'] if p['id'] == '$LLM_PROVIDER_ID')
for m in p.get('models', []): print(f\"    - {m['id']}  ({m['name']})\")" > /dev/tty
  fi
  ask "Analyst model ${DIM}(main chat/analysis agent)${RESET}" "$analyst_default"; LLM_ANALYST_MODEL="$REPLY_VALUE"
  ask "Micro model ${DIM}(titles, summaries — a small fast model)${RESET}" "${micro_default:-$LLM_ANALYST_MODEL}"; LLM_MICRO_MODEL="$REPLY_VALUE"
}

interview_connection_fields() { # <type> — builds CONN_CONFIG_JSON; empty on abort
  local type="$1" pairs="" line key label kind required secret default note value
  while IFS='|' read -r key label kind required secret default note; do
    value=""
    local shown_label="$label"
    [ -n "$note" ] && shown_label="$label ${DIM}($note)${RESET}"
    if [ "$kind" = "json" ]; then
      # JSON blobs (e.g. service-account keys) are secret but must be pasteable.
      ask_multiline "$shown_label"; value="$REPLY_VALUE"
    elif [ "$kind" = "password" ] || [ "$secret" = "true" ]; then
      ask_secret "$shown_label"; value="$REPLY_VALUE"
    else
      ask "$shown_label" "$default"; value="$REPLY_VALUE"
    fi
    if [ -z "$value" ]; then
      if [ "$required" = "true" ]; then
        warn "$label is required" > /dev/tty
        ask "$shown_label" "$default"; value="$REPLY_VALUE"
        [ -z "$value" ] && { warn "Skipping database setup (missing $label)" > /dev/tty; CONN_CONFIG_JSON=""; return 0; }
      else
        continue
      fi
    fi
    # The app runs in a container: localhost DBs must be addressed via the
    # docker host alias.
    if [ "$key" = "host" ]; then
      local rewritten
      rewritten=$(container_host "$value")
      if [ "$rewritten" != "$value" ]; then
        info "Using ${BOLD}$rewritten${RESET}${GRAY} for '$value' (the app runs inside Docker)" > /dev/tty
        value="$rewritten"
      fi
    fi
    if [ "$kind" = "number" ]; then
      pairs="$pairs,\"$key\":$value"
    else
      pairs="$pairs,\"$key\":\"$(json_escape "$value")\""
    fi
  done < <(compat "
t = next(t for t in data['connections']['types'] if t['type'] == '$type')
for f in t['fields']:
    print('|'.join([f['key'], f['label'], f['kind'], str(f.get('required', False)).lower(), str(f.get('secret', False)).lower(), str(f.get('default', '')), f.get('note', '')]))")
  CONN_CONFIG_JSON="{${pairs#,}}"
}

if [ "$HAVE_TTY" = 1 ] && [ "$EXISTING_WORKSPACE" = 0 ]; then
  printf "\n  ${BOLD}${WHITE}Workspace${RESET}\n"
  while [ -z "$WS_NAME" ]; do
    ask "Workspace name ${DIM}(letters, numbers, hyphens, underscores)${RESET}" ""
    case "$REPLY_VALUE" in
      *[!A-Za-z0-9_-]*) warn "Only letters, numbers, hyphens, and underscores" > /dev/tty ;;
      *) WS_NAME="$REPLY_VALUE" ;;
    esac
  done
  while [ -z "$ADMIN_NAME" ]; do ask "Your full name" ""; ADMIN_NAME="$REPLY_VALUE"; done
  while [ -z "$ADMIN_EMAIL" ]; do ask "Admin email" ""; ADMIN_EMAIL="$REPLY_VALUE"; done
  while true; do
    ask_secret "Admin password (min 8 characters)"; ADMIN_PASSWORD="$REPLY_VALUE"
    if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then warn "Too short" > /dev/tty; continue; fi
    ask_secret "Confirm password"
    [ "$REPLY_VALUE" = "$ADMIN_PASSWORD" ] && break
    warn "Passwords don't match — try again" > /dev/tty
  done

  printf "\n  ${BOLD}${WHITE}AI model${RESET}\n"
  if [ "$HAVE_COMPAT" = 1 ]; then
    PROVIDER_IDS=()
    PROVIDER_LABELS=()
    while IFS='|' read -r pid pname pkind pdesc; do
      PROVIDER_IDS+=("$pid|$pkind")
      if [ -n "$pdesc" ]; then
        PROVIDER_LABELS+=("${pname} ${DIM}— ${pdesc}${RESET}")
      else
        PROVIDER_LABELS+=("$pname")
      fi
    done < <(compat "
for p in data['llm']['providers']:
    print('|'.join([p['id'], p['name'], p['kind'], p.get('description', '')]))")
    menu "Which LLM provider?" "${PROVIDER_LABELS[@]}"
    LLM_PROVIDER_ID="${PROVIDER_IDS[$MENU_INDEX]%%|*}"
    LLM_KIND="${PROVIDER_IDS[$MENU_INDEX]##*|}"
  else
    info "Could not load provider metadata — enter details manually"
    ask "Provider ${DIM}(minusx, anthropic, openai, google, amazon-bedrock, custom)${RESET}" "minusx"
    LLM_PROVIDER_ID="$REPLY_VALUE"
    case "$LLM_PROVIDER_ID" in
      minusx) LLM_KIND="managed" ;;
      custom) LLM_KIND="custom" ;;
      *) LLM_KIND="registry" ;;
    esac
  fi
  interview_llm_credentials
  interview_llm_models
  build_llm_json

  if [ "$HAVE_COMPAT" = 1 ]; then
    printf "\n  ${BOLD}${WHITE}Database ${DIM}(optional — you can also do this in the app)${RESET}\n"
    CONN_TYPE_LABELS=("Skip for now")
    CONN_TYPE_IDS=("")
    while IFS='|' read -r ctype cname; do
      CONN_TYPE_IDS+=("$ctype")
      CONN_TYPE_LABELS+=("$cname")
    done < <(compat "
for t in data['connections']['types']:
    if t.get('cli'): print('|'.join([t['type'], t['name']]))")
    menu "Connect a database now?" "${CONN_TYPE_LABELS[@]}"
    CONN_TYPE="${CONN_TYPE_IDS[$MENU_INDEX]}"
    if [ -n "$CONN_TYPE" ]; then
      ask "Connection name ${DIM}(lowercase letters, numbers, underscores)${RESET}" "warehouse"
      CONN_NAME=$(printf '%s' "$REPLY_VALUE" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_')
      [ -z "$CONN_NAME" ] && CONN_NAME="warehouse"
      interview_connection_fields "$CONN_TYPE"
      if [ -n "$CONN_CONFIG_JSON" ]; then
        CONNECTION_JSON="{\"name\":\"$CONN_NAME\",\"type\":\"$CONN_TYPE\",\"config\":$CONN_CONFIG_JSON}"
      fi
    fi
  fi
  printf "\n"
  success "Setup details collected"
elif [ "$EXISTING_WORKSPACE" = 1 ]; then
  info "Existing workspace detected — upgrading in place (no setup questions)"
else
  info "No terminal available — finish setup in the browser after start"
fi

# ── step 5: wait for pull, start service ────────────────────────────────────

PULL_OK=1
if kill -0 "$PULL_PID" 2>/dev/null; then
  spin "$PULL_PID" "Waiting for image pull to finish..." || PULL_OK=0
else
  wait "$PULL_PID" || PULL_OK=0
fi
if [ "$PULL_OK" = 1 ]; then
  success "Image pulled"
elif docker image inspect "$FRONTEND_IMAGE" > /dev/null 2>&1; then
  # Offline upgrade / locally built image: run what we already have.
  warn "Image pull failed — using the local copy of ${DIM}${FRONTEND_IMAGE}${RESET}"
else
  fail "Image pull failed"
  printf "\n${DIM}"; tail -5 "$PULL_LOG"; printf "${RESET}\n"
  exit 1
fi

step "Starting MinusX"

docker rm -f mx-frontend 2>/dev/null || true

FRONTEND_PORT=$(find_free_port 3000)
if [ "$FRONTEND_PORT" -ne 3000 ]; then
  warn "Port 3000 in use — MinusX will use port ${BOLD}$FRONTEND_PORT${RESET}"
fi

docker run -d \
  --name mx-frontend \
  --platform "$PLATFORM" \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
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
MAX_WAIT=120
WAITED=0
frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
APP_READY=0

while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    printf "\r\033[K"
    success "MinusX is ready!"
    APP_READY=1
    break
  fi
  i=$((WAITED % 10))
  printf "\r  ${CYAN}%s${RESET} ${DIM}Waiting for app to start... (%ds)${RESET}" "${frames[$i]}" "$WAITED"
  sleep 1
  WAITED=$((WAITED + 1))
done

if [ "$APP_READY" = 0 ]; then
  printf "\r\033[K"
  warn "App is taking longer than expected — it may still be starting"
fi

# ── step 7: validate + create workspace ─────────────────────────────────────

step "Setting up your workspace"

REGISTERED=0
if [ "$HAVE_TTY" = 1 ] && [ "$EXISTING_WORKSPACE" = 0 ] && [ -n "$WS_NAME" ] && [ "$APP_READY" = 1 ]; then

  # Validate the LLM setup with a real one-token call (app code, app image).
  # Managed (minusx) entries skip validation — the gateway owns routing.
  ATTEMPTS=0
  while [ -n "$LLM_JSON" ] && [ "$LLM_KIND" != "managed" ] && [ "$ATTEMPTS" -lt 3 ]; do
    VALIDATE_INPUT="{\"provider\":$LLM_ENTRY_JSON,\"model\":\"$(json_escape "$LLM_ANALYST_MODEL")\"}"
    RESULT=$(printf '%s' "$VALIDATE_INPUT" | run_in_image validate-llm.js || true)
    if printf '%s' "$RESULT" | grep -q '"ok":true'; then
      success "LLM connection verified ${DIM}$(printf '%s' "$RESULT" | sed -n 's/.*"latencyMs":\([0-9]*\).*/(\1ms)/p')${RESET}"
      break
    fi
    ERR=$(printf '%s' "$RESULT" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')
    warn "LLM test failed: ${ERR:-no response}"
    menu "How do you want to proceed?" "Re-enter the API key" "Change the model" "Keep it anyway (fix in the app later)"
    case "$MENU_INDEX" in
      0) interview_llm_credentials; build_llm_json ;;
      1) interview_llm_models; build_llm_json ;;
      2) break ;;
    esac
    ATTEMPTS=$((ATTEMPTS + 1))
  done

  # Validate the database connection with the real connector.
  if [ -n "$CONNECTION_JSON" ]; then
    RESULT=$(printf '%s' "$CONNECTION_JSON" | run_in_image validate-connection.js || true)
    if printf '%s' "$RESULT" | grep -q '"success":true'; then
      success "Database connection verified"
    else
      ERR=$(printf '%s' "$RESULT" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p')
      warn "Database test failed: ${ERR:-no response}"
      menu "How do you want to proceed?" "Re-enter the connection details" "Skip the database (set it up in the app)"
      if [ "$MENU_INDEX" = 0 ]; then
        interview_connection_fields "$CONN_TYPE"
        if [ -n "$CONN_CONFIG_JSON" ]; then
          CONNECTION_JSON="{\"name\":\"$CONN_NAME\",\"type\":\"$CONN_TYPE\",\"config\":$CONN_CONFIG_JSON}"
          RESULT=$(printf '%s' "$CONNECTION_JSON" | run_in_image validate-connection.js || true)
          if printf '%s' "$RESULT" | grep -q '"success":true'; then
            success "Database connection verified"
          else
            warn "Still failing — the connection will be skipped (finish it in the app)"
            CONNECTION_JSON=""
          fi
        fi
      else
        CONNECTION_JSON=""
      fi
    fi
  fi

  # One registration call carries everything (keys are extracted into the
  # secrets store server-side; the payload file is 0600 and removed).
  PAYLOAD_FILE=$(mktemp "${TMPDIR:-/tmp}/minusx-register.XXXXXX")
  chmod 600 "$PAYLOAD_FILE"
  {
    printf '{'
    printf '"workspaceName":"%s"' "$(json_escape "$WS_NAME")"
    printf ',"adminName":"%s"' "$(json_escape "$ADMIN_NAME")"
    printf ',"adminEmail":"%s"' "$(json_escape "$ADMIN_EMAIL")"
    printf ',"adminPassword":"%s"' "$(json_escape "$ADMIN_PASSWORD")"
    [ -n "$LLM_JSON" ] && printf ',"llm":%s' "$LLM_JSON"
    [ -n "$CONNECTION_JSON" ] && printf ',"connection":%s' "$CONNECTION_JSON"
    printf '}'
  } > "$PAYLOAD_FILE"

  HTTP_CODE=$(curl -s -o /tmp/minusx-register-response.json -w '%{http_code}' \
    -X POST "$HEALTH_URL/api/orgs/register" \
    -H 'Content-Type: application/json' \
    --data-binary "@$PAYLOAD_FILE" || echo "000")
  rm -f "$PAYLOAD_FILE"

  if [ "$HTTP_CODE" = "200" ]; then
    REGISTERED=1
    success "Workspace ${BOLD}$WS_NAME${RESET} created"
    if grep -q '"warnings"' /tmp/minusx-register-response.json 2>/dev/null; then
      warn "$(sed -n 's/.*"warnings":\["\([^"]*\)".*/\1/p' /tmp/minusx-register-response.json)"
    fi
  elif [ "$HTTP_CODE" = "409" ]; then
    EXISTING_WORKSPACE=1
    warn "A workspace already exists — log in with your existing credentials"
  else
    REG_ERR=$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' /tmp/minusx-register-response.json 2>/dev/null | head -1)
    warn "Automatic workspace creation failed (HTTP $HTTP_CODE${REG_ERR:+: $REG_ERR}) — create it in the browser instead"
  fi
  rm -f /tmp/minusx-register-response.json
else
  info "Skipping — finish setup in the browser"
fi
rm -f "$COMPAT_FILE" "$PULL_LOG"

# ── summary ──────────────────────────────────────────────────────────────────

printf "\n"
printf "${BOLD}${GREEN}  ╔══════════════════════════════════════╗${RESET}\n"
printf "${BOLD}${GREEN}  ║           ${WHITE}Setup Complete!${GREEN}            ║${RESET}\n"
printf "${BOLD}${GREEN}  ╚══════════════════════════════════════╝${RESET}\n"
printf "\n"
printf "  ${BOLD}${WHITE}Next steps:${RESET}\n"
printf "\n"
if [ "$REGISTERED" = 1 ]; then
  printf "  ${WHITE}1.${RESET} Open ${BOLD}${BLUE}http://localhost:${FRONTEND_PORT}${RESET} and log in as ${BOLD}${ADMIN_EMAIL}${RESET}\n"
elif [ "$EXISTING_WORKSPACE" = 1 ]; then
  printf "  ${WHITE}1.${RESET} Open ${BOLD}${BLUE}http://localhost:${FRONTEND_PORT}${RESET} and log in\n"
else
  printf "  ${WHITE}1.${RESET} Open ${BOLD}${BLUE}http://localhost:${FRONTEND_PORT}${RESET} and create your workspace\n"
fi
printf "  ${WHITE}2.${RESET} Read the docs at ${BOLD}${BLUE}https://docs.minusx.ai${RESET}\n"
printf "  ${WHITE}3.${RESET} Join our Slack community: ${BOLD}${BLUE}https://minusx.ai/slack${RESET}\n"
printf "\n"
printf "  ${GRAY}Your data is persisted in ${RESET}${DIM}$(pwd)/data${RESET}${GRAY} — safe across restarts & upgrades.${RESET}\n"
printf "\n"
printf "  ${GRAY}Useful commands:${RESET}\n"
printf "  ${DIM}  docker logs -f mx-frontend${RESET}          ${GRAY}# app logs${RESET}\n"
printf "  ${DIM}  docker rm -f mx-frontend${RESET}            ${GRAY}# stop & remove${RESET}\n"
printf "  ${DIM}  curl -fsSL minusx.ai/install.sh | bash${RESET}  ${GRAY}# upgrade${RESET}\n"
printf "\n"
