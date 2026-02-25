#!/bin/sh
set -e

OLLAMA_HOST="${OLLAMA_HOST:-http://ollama:11434}"
EMBED_MODEL="${CODERAG_EMBEDDING_MODEL:-nomic-embed-text}"
ENRICH_MODEL="${CODERAG_ENRICHMENT_MODEL:-qwen2.5-coder:1.5b}"

echo "=== CodeRAG Ollama Init ==="
echo "Ollama host: $OLLAMA_HOST"
echo "Embedding model: $EMBED_MODEL"
echo "Enrichment model: $ENRICH_MODEL"
echo ""

pull_model() {
  local model="$1"
  echo "Checking model: $model"
  if ollama list 2>/dev/null | grep -q "$model"; then
    echo "  Already present: $model"
  else
    echo "  Pulling $model (this may take a few minutes)..."
    ollama pull "$model"
    echo "  Done: $model"
  fi
}

pull_model "$EMBED_MODEL"
pull_model "$ENRICH_MODEL"

echo ""
echo "All models ready:"
ollama list
