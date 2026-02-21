#!/usr/bin/env bash
#
# verify-ollama.sh — Verify Ollama installation and model availability for CodeRAG
#
# Usage: ./scripts/verify-ollama.sh
# Exit codes: 0 = all checks passed, 1 = one or more checks failed
#

set -euo pipefail

OLLAMA_API_URL="${OLLAMA_HOST:-http://localhost:11434}"
REQUIRED_MODELS=("nomic-embed-text" "qwen2.5-coder")

PASS=0
FAIL=0

print_status() {
  local status="$1"
  local message="$2"
  if [ "$status" = "OK" ]; then
    echo "  [OK]      $message"
  elif [ "$status" = "MISSING" ]; then
    echo "  [MISSING]  $message"
  elif [ "$status" = "ERROR" ]; then
    echo "  [ERROR]   $message"
  fi
}

echo ""
echo "======================================"
echo " CodeRAG — Ollama Verification"
echo "======================================"
echo ""

# ---------------------------
# 1. Check if ollama CLI exists
# ---------------------------
echo "1. Checking Ollama CLI..."
if command -v ollama &> /dev/null; then
  OLLAMA_VERSION=$(ollama --version 2>/dev/null || echo "unknown")
  print_status "OK" "Ollama CLI found ($OLLAMA_VERSION)"
  PASS=$((PASS + 1))
else
  print_status "MISSING" "Ollama CLI not found in PATH"
  echo "         Install: https://ollama.com/download"
  FAIL=$((FAIL + 1))
fi

echo ""

# ---------------------------
# 2. Check API connectivity
# ---------------------------
echo "2. Checking Ollama API connectivity at $OLLAMA_API_URL ..."
if curl -sf --max-time 5 "$OLLAMA_API_URL" > /dev/null 2>&1; then
  print_status "OK" "Ollama API is reachable at $OLLAMA_API_URL"
  PASS=$((PASS + 1))
else
  print_status "ERROR" "Cannot connect to Ollama API at $OLLAMA_API_URL"
  echo "         Make sure Ollama is running: ollama serve"
  FAIL=$((FAIL + 1))
fi

echo ""

# ---------------------------
# 3. Check required models
# ---------------------------
echo "3. Checking required models..."

if command -v ollama &> /dev/null; then
  INSTALLED_MODELS=$(ollama list 2>/dev/null || echo "")

  for model in "${REQUIRED_MODELS[@]}"; do
    if echo "$INSTALLED_MODELS" | grep -qi "$model"; then
      print_status "OK" "Model '$model' is available"
      PASS=$((PASS + 1))
    else
      print_status "MISSING" "Model '$model' is not pulled"
      echo "         Run: ollama pull $model"
      FAIL=$((FAIL + 1))
    fi
  done
else
  for model in "${REQUIRED_MODELS[@]}"; do
    print_status "ERROR" "Cannot check model '$model' (Ollama CLI not available)"
    FAIL=$((FAIL + 1))
  done
fi

echo ""

# ---------------------------
# Summary
# ---------------------------
echo "======================================"
TOTAL=$((PASS + FAIL))
echo " Results: $PASS/$TOTAL checks passed"

if [ "$FAIL" -gt 0 ]; then
  echo " Status:  FAILED ($FAIL issue(s) found)"
  echo "======================================"
  echo ""
  exit 1
else
  echo " Status:  ALL CHECKS PASSED"
  echo "======================================"
  echo ""
  exit 0
fi
