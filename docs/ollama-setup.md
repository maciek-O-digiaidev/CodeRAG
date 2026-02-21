# Ollama Setup Guide

This guide covers the installation and configuration of [Ollama](https://ollama.com/) for local model inference in CodeRAG.

## Why Ollama?

CodeRAG uses local LLM inference for two key capabilities:

- **Embedding generation** -- converting code chunks into vector representations for semantic search
- **Natural language enrichment** -- generating human-readable summaries and descriptions of code

Running models locally ensures data privacy, zero API costs, and offline capability.

## Installation

### macOS (Homebrew)

```bash
brew install ollama
```

After installation, start the Ollama service:

```bash
ollama serve
```

Alternatively, you can install the macOS desktop app from [ollama.com/download](https://ollama.com/download) which runs the service automatically in the background.

### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

The installer will set up Ollama as a systemd service. It starts automatically after installation.

To check service status:

```bash
systemctl status ollama
```

### Windows

Download the installer from [ollama.com/download](https://ollama.com/download) and run it. The service starts automatically after installation.

Alternatively, if using WSL2:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

## Required Models

CodeRAG requires two models:

| Model | Purpose | Size | Usage |
|---|---|---|---|
| `nomic-embed-text` | Embedding generation | ~274 MB | Converts code into 384-dimensional vector embeddings for semantic search |
| `qwen2.5-coder:7b` | NL enrichment | ~4.7 GB | Generates natural language descriptions and summaries of code |

### Pull Models

```bash
ollama pull nomic-embed-text
ollama pull qwen2.5-coder:7b
```

### Verify Models Are Available

```bash
ollama list
```

You should see both models in the output:

```
NAME                    ID              SIZE      MODIFIED
nomic-embed-text:latest <hash>          274 MB    <date>
qwen2.5-coder:7b        <hash>          4.7 GB    <date>
```

### Test Model Inference

Test the embedding model:

```bash
curl http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "function hello() { return 42; }"
}'
```

You should receive a JSON response containing an `embedding` array.

Test the code model:

```bash
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5-coder:7b",
  "prompt": "Explain what this function does: function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }",
  "stream": false
}'
```

You should receive a JSON response with a `response` field containing a natural language explanation.

## Configuration in CodeRAG

CodeRAG reads Ollama connection settings from `.coderag.yaml` in the project root. The default configuration:

```yaml
ollama:
  baseUrl: http://localhost:11434
  models:
    embedding: nomic-embed-text
    enrichment: qwen2.5-coder:7b
  timeout: 30000        # Request timeout in ms
  maxRetries: 3          # Retry count on failure
```

### Custom Host / Port

If Ollama is running on a different host or port (e.g., a remote server):

```yaml
ollama:
  baseUrl: http://192.168.1.100:11434
```

You can also set the environment variable:

```bash
export OLLAMA_HOST=http://192.168.1.100:11434
```

## Verification Script

A convenience script is provided to verify your Ollama setup:

```bash
./scripts/verify-ollama.sh
```

This checks that the Ollama CLI is installed, required models are pulled, and the API is reachable.

## Troubleshooting

| Problem | Possible Cause | Solution |
|---|---|---|
| `connection refused` on port 11434 | Ollama service is not running | Run `ollama serve` (macOS/Linux) or start the desktop app (Windows/macOS). On Linux, check `systemctl status ollama`. |
| `model not found` error | Model has not been pulled yet | Run `ollama pull nomic-embed-text` and `ollama pull qwen2.5-coder:7b`. Verify with `ollama list`. |
| Slow performance / high latency | Insufficient hardware resources or model running on CPU only | Ensure you have at least 8 GB RAM free. For GPU acceleration, verify your GPU drivers are up to date. On macOS, Metal acceleration is used automatically. On Linux, NVIDIA GPU requires CUDA drivers. |
| Out of memory (OOM) | Not enough RAM for the model | Close other memory-intensive applications. The 7B model requires approximately 5-6 GB RAM. If OOM persists, consider using a smaller model variant (e.g., `qwen2.5-coder:3b`) and update `.coderag.yaml` accordingly. |
| `permission denied` on Linux install | Installer needs elevated permissions | Run with `sudo`: `curl -fsSL https://ollama.com/install.sh \| sudo sh` |
| Ollama CLI works but API is unreachable | Firewall or binding issue | Check that Ollama is binding to the correct interface. Set `OLLAMA_HOST=0.0.0.0:11434` to bind to all interfaces. |

## Hardware Recommendations

- **Minimum**: 8 GB RAM, any modern CPU (embedding model only)
- **Recommended**: 16 GB RAM, GPU with 6+ GB VRAM (for code enrichment model)
- **macOS**: Apple Silicon (M1/M2/M3/M4) provides excellent performance via Metal acceleration
- **Linux**: NVIDIA GPU with CUDA support recommended for best performance
