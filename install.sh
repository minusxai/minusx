#!/usr/bin/env bash
set -euo pipefail

# DEPRECATED: install.sh is now setup.sh (which also walks you through
# workspace + AI model + database setup while the image downloads).
# This shim exists so existing docs/blog links keep working:
#   curl -fsSL minusx.ai/install.sh | bash
# It fetches and runs setup.sh with all arguments passed through.

REPO_RAW="https://raw.githubusercontent.com/minusxai/minusx/main"

printf '\n  \033[38;5;221m!\033[0m install.sh has moved to setup.sh — continuing with the new setup\n'
exec bash <(curl -fsSL "${REPO_RAW}/setup.sh") "$@"
