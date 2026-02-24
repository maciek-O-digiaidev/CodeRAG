#!/usr/bin/env bash
#
# bootstrap.sh -- CodeRAG development environment setup
#
# Usage: ./scripts/bootstrap.sh
#
# This script is idempotent: safe to run multiple times.
# Supports macOS and Linux.
#
# Exit codes:
#   0 = setup completed successfully
#   1 = a required step failed
#

set -euo pipefail

# ---------------------
# Color and formatting
# ---------------------
if [[ -t 1 ]] && command -v tput &>/dev/null; then
  BOLD=$(tput bold)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  RED=$(tput setaf 1)
  CYAN=$(tput setaf 6)
  RESET=$(tput sgr0)
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RED=""
  CYAN=""
  RESET=""
fi

info()    { echo "${CYAN}[info]${RESET}    $*"; }
success() { echo "${GREEN}[ok]${RESET}      $*"; }
warn()    { echo "${YELLOW}[warn]${RESET}    $*"; }
fail()    { echo "${RED}[fail]${RESET}    $*"; }
step()    { echo ""; echo "${BOLD}==> $*${RESET}"; }

# ---------------------
# Detect OS
# ---------------------
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)
    fail "Unsupported operating system: $OS"
    fail "This script supports macOS and Linux."
    exit 1
    ;;
esac

# ---------------------
# Navigate to project root
# ---------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo "${BOLD}=====================================${RESET}"
echo "${BOLD} CodeRAG -- Development Bootstrap${RESET}"
echo "${BOLD}=====================================${RESET}"
echo ""
info "Platform: $PLATFORM"
info "Project root: $PROJECT_ROOT"

# ---------------------
# Step 1: Check Node.js
# ---------------------
step "Step 1/6: Checking Node.js"

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_MAJOR" -ge 20 ]]; then
    success "Node.js $NODE_VERSION (>= 20 required)"
  else
    fail "Node.js $NODE_VERSION found, but >= 20 is required"
    info "Install from: https://nodejs.org/ or use nvm/fnm"
    exit 1
  fi
else
  fail "Node.js is not installed"
  info "Install from: https://nodejs.org/ or use nvm/fnm"
  exit 1
fi

# ---------------------
# Step 2: Check/install pnpm
# ---------------------
step "Step 2/6: Checking pnpm"

if command -v pnpm &>/dev/null; then
  PNPM_VERSION=$(pnpm --version)
  PNPM_MAJOR=$(echo "$PNPM_VERSION" | cut -d. -f1)
  if [[ "$PNPM_MAJOR" -ge 9 ]]; then
    success "pnpm $PNPM_VERSION (>= 9 required)"
  else
    warn "pnpm $PNPM_VERSION found, but >= 9 is recommended"
    info "Attempting to install latest pnpm via corepack..."
    corepack enable
    corepack prepare pnpm@latest --activate
    success "pnpm updated via corepack"
  fi
else
  info "pnpm not found. Installing via corepack..."
  if command -v corepack &>/dev/null; then
    corepack enable
    corepack prepare pnpm@latest --activate
    success "pnpm installed via corepack"
  else
    info "corepack not available. Installing pnpm via npm..."
    npm install -g pnpm
    success "pnpm installed via npm"
  fi
fi

# ---------------------
# Step 3: Install dependencies
# ---------------------
step "Step 3/6: Installing dependencies"

info "Running pnpm install..."
pnpm install
success "Dependencies installed"

# ---------------------
# Step 4: Check Ollama (optional)
# ---------------------
step "Step 4/6: Checking Ollama (optional)"

if command -v ollama &>/dev/null; then
  OLLAMA_VERSION=$(ollama --version 2>/dev/null || echo "unknown")
  success "Ollama found ($OLLAMA_VERSION)"

  # Check if Ollama is running
  OLLAMA_API_URL="${OLLAMA_HOST:-http://localhost:11434}"
  if curl -sf --max-time 3 "$OLLAMA_API_URL" >/dev/null 2>&1; then
    success "Ollama API is reachable at $OLLAMA_API_URL"

    # Check for nomic-embed-text model
    INSTALLED_MODELS=$(ollama list 2>/dev/null || echo "")
    if echo "$INSTALLED_MODELS" | grep -qi "nomic-embed-text"; then
      success "Model 'nomic-embed-text' is available"
    else
      warn "Model 'nomic-embed-text' is not pulled"
      echo ""
      read -rp "  Pull nomic-embed-text now? (y/N) " PULL_EMBED
      if [[ "$PULL_EMBED" =~ ^[Yy]$ ]]; then
        info "Pulling nomic-embed-text..."
        ollama pull nomic-embed-text
        success "nomic-embed-text pulled"
      else
        info "Skipped. You can pull it later: ollama pull nomic-embed-text"
      fi
    fi

    # Check for qwen2.5-coder model
    if echo "$INSTALLED_MODELS" | grep -qi "qwen2.5-coder"; then
      success "Model 'qwen2.5-coder' is available"
    else
      warn "Model 'qwen2.5-coder' is not pulled (used for NL enrichment)"
      echo ""
      read -rp "  Pull qwen2.5-coder now? (y/N) " PULL_LLM
      if [[ "$PULL_LLM" =~ ^[Yy]$ ]]; then
        info "Pulling qwen2.5-coder..."
        ollama pull qwen2.5-coder
        success "qwen2.5-coder pulled"
      else
        info "Skipped. You can pull it later: ollama pull qwen2.5-coder"
      fi
    fi
  else
    warn "Ollama is installed but not running at $OLLAMA_API_URL"
    info "Start it with: ollama serve"
    info "Ollama is optional -- tests and builds work without it"
  fi
else
  warn "Ollama is not installed (optional -- needed for local AI features)"
  if [[ "$PLATFORM" = "macos" ]]; then
    info "Install: brew install ollama  OR  https://ollama.com/download"
  else
    info "Install: curl -fsSL https://ollama.ai/install.sh | sh"
  fi
  info "Ollama is optional -- tests and builds work without it"
fi

# ---------------------
# Step 5: Build all packages
# ---------------------
step "Step 5/6: Building all packages"

info "Running pnpm build..."
if pnpm build; then
  success "All packages built successfully"
else
  fail "Build failed -- check the output above for errors"
  exit 1
fi

# ---------------------
# Step 6: Run tests
# ---------------------
step "Step 6/6: Running tests"

info "Running pnpm test..."
if pnpm test; then
  success "All tests passed"
else
  fail "Some tests failed -- check the output above"
  exit 1
fi

# ---------------------
# Summary
# ---------------------
echo ""
echo "${BOLD}=====================================${RESET}"
echo "${BOLD} Bootstrap Complete${RESET}"
echo "${BOLD}=====================================${RESET}"
echo ""
success "CodeRAG development environment is ready!"
echo ""
info "Next steps:"
echo "  1. Read CONTRIBUTING.md for coding conventions"
echo "  2. Read docs/architecture.md for system overview"
echo "  3. Read docs/extending.md for adding new providers"
echo ""
info "Useful commands:"
echo "  pnpm build          Build all packages"
echo "  pnpm test           Run all tests"
echo "  pnpm lint           Lint all packages"
echo "  pnpm clean          Clean build artifacts"
echo ""
