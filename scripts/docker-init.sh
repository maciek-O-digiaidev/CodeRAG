#!/bin/bash
set -euo pipefail

echo "Starting CodeRAG development services..."
docker compose up -d ollama

echo "Waiting for Ollama to be ready..."
until docker compose exec ollama ollama list &>/dev/null; do
  sleep 2
done

echo "Pulling required models..."
docker compose exec ollama ollama pull nomic-embed-text
docker compose exec ollama ollama pull qwen2.5-coder:7b

echo "Verifying models..."
docker compose exec ollama ollama list

echo ""
echo "CodeRAG dev services ready!"
echo "  Ollama: http://localhost:11434"
echo ""
echo "To also start Qdrant: docker compose --profile qdrant up -d"
