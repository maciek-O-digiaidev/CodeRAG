#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Background indexing script for CodeRAG
# Runs coderag index with auto-restart on failure, logging to .coderag/index.log
#
# Usage:
#   ./scripts/index-bg.sh [--full]    # run in foreground
#   nohup ./scripts/index-bg.sh &     # run in background
#
# Monitor progress:
#   tail -f .coderag/index.log
#   cat .coderag/index-progress.json
# ---------------------------------------------------------------------------

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STORAGE_DIR="$PROJECT_DIR/.coderag"
LOG_FILE="$STORAGE_DIR/index.log"

MAX_RETRIES=3
RETRY_DELAY=10  # seconds

# Ensure storage dir exists before anything writes to it
mkdir -p "$STORAGE_DIR"

# Lock file to prevent multiple concurrent instances
LOCK_FILE="$STORAGE_DIR/index.lock"

if [ -f "$LOCK_FILE" ]; then
  existing_pid=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$existing_pid" 2>/dev/null; then
    echo "ERROR: Another indexing process is already running (PID $existing_pid)"
    echo "  If this is stale, remove: $LOCK_FILE"
    exit 1
  else
    echo "Removing stale lock file (PID $existing_pid is no longer running)"
    rm -f "$LOCK_FILE"
  fi
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# Extract exported env vars from shell profile (avoids sourcing interactive setup)
# This picks up ADO_PAT and other credentials defined in user's shell config
for profile in "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.bashrc"; do
  if [ -f "$profile" ]; then
    while IFS= read -r line; do
      eval "$line" 2>/dev/null || true
    done < <(grep '^export [A-Z_]*=' "$profile" 2>/dev/null || true)
  fi
done

cd "$PROJECT_DIR"

# Ollama parallel inference — allows multiple requests to be processed concurrently
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-6}"

log() {
  local timestamp
  timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "[$timestamp] [index-bg] $*" | tee -a "$LOG_FILE"
}

log "=== Background indexing started (PID $$) ==="
log "Project: $PROJECT_DIR"
log "Max retries: $MAX_RETRIES"
log "ADO_PAT set: $([ -n "${ADO_PAT:-}" ] && echo 'yes' || echo 'no')"

attempt=0
while [ $attempt -lt $MAX_RETRIES ]; do
  attempt=$((attempt + 1))
  log "--- Attempt $attempt/$MAX_RETRIES ---"

  # Run coderag index, passing through any args (e.g. --full)
  set +e
  node "$PROJECT_DIR/packages/cli/dist/index.js" index "$@" 2>&1 | tee -a "$LOG_FILE"
  exit_code=${PIPESTATUS[0]}
  set -e

  if [ "$exit_code" -eq 0 ]; then
    log "=== Indexing completed successfully ==="
    exit 0
  fi

  log "Indexing failed with exit code $exit_code"

  if [ $attempt -lt $MAX_RETRIES ]; then
    log "Retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
  fi
done

log "=== All $MAX_RETRIES attempts failed ==="
exit 1
