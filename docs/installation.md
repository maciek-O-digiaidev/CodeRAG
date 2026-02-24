# Installation

This guide covers three ways to install CodeRAG: npm global install, Docker, and building from source.

## Prerequisites

| Requirement | Minimum Version | Purpose |
|-------------|-----------------|---------|
| **Node.js** | >= 20 | Runtime |
| **pnpm** | >= 9 | Package manager (only for build-from-source) |
| **Ollama** | latest | Local embedding + LLM inference |
| **Git** | any recent | Source control, file watcher |

CodeRAG is designed **local-first**. Everything runs on your machine with Ollama and LanceDB -- no cloud accounts required for the default setup.

### Install Ollama

Download and install Ollama from [ollama.com](https://ollama.com/download):

```bash
# macOS (Homebrew)
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download the installer from https://ollama.com/download/windows
```

Start the Ollama server:

```bash
ollama serve
```

On macOS, the Ollama desktop app starts the server automatically. Verify it is running by visiting `http://localhost:11434` in your browser.

### Pull Required Models

CodeRAG requires two Ollama models -- one for embeddings and one for natural language enrichment:

```bash
# Embedding model (required for indexing and search)
ollama pull nomic-embed-text

# LLM for NL enrichment (required for indexing)
ollama pull qwen2.5-coder:7b
```

The `qwen2.5-coder:7b` model is approximately 4.7 GB. If your machine has limited RAM (< 8 GB), use the smaller `qwen2.5-coder:1.5b` variant and update your `.coderag.yaml` accordingly.

Verify the models are available:

```bash
ollama list
# You should see both nomic-embed-text and qwen2.5-coder:7b
```

---

## Method A: npm Global Install

The simplest way to get started. Requires Node.js >= 20.

```bash
# Install the CLI globally
npm install -g @coderag/cli

# Verify installation
coderag --version
```

This gives you the `coderag` command globally. Navigate to any project directory and run:

```bash
cd /path/to/your/project
coderag init
coderag index
coderag search "your query"
```

### Updating

```bash
npm update -g @coderag/cli
```

---

## Method B: Docker

Use Docker to run the CodeRAG API server without installing Node.js locally. The Dockerfile is located at `packages/api-server/Dockerfile`.

### Build the image

```bash
git clone https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG
cd CodeRAG

docker build -t coderag-api -f packages/api-server/Dockerfile .
```

### Run the container

```bash
docker run -d \
  --name coderag-api \
  -p 3100:3100 \
  -v /path/to/your/project:/data \
  -e CODERAG_ROOT=/data \
  -e OLLAMA_HOST=http://host.docker.internal:11434 \
  coderag-api
```

Key environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CODERAG_PORT` | `3100` | Port the API server listens on |
| `CODERAG_ROOT` | `/data` | Path to the project root inside the container |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL (use `host.docker.internal` from Docker) |
| `NODE_ENV` | `production` | Node.js environment |

### Health check

```bash
curl http://localhost:3100/health
```

### Docker with Ollama on the host

When running CodeRAG in Docker while Ollama runs on the host machine, use `host.docker.internal` (macOS/Windows) or the host's network IP (Linux):

```bash
# macOS / Windows
-e OLLAMA_HOST=http://host.docker.internal:11434

# Linux (use host network mode)
docker run --network host ...
# or specify the host IP explicitly
-e OLLAMA_HOST=http://192.168.1.100:11434
```

### Docker with GPU access

If you want Ollama to use a GPU inside Docker:

```bash
# NVIDIA GPU
docker run --gpus all \
  -e OLLAMA_HOST=http://host.docker.internal:11434 \
  ...
```

Note: The CodeRAG container itself does not need GPU access. GPU is only needed by the Ollama server for model inference.

---

## Method C: Build from Source

For development or to get the latest unreleased features.

### Step 1: Clone the repository

```bash
git clone https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG
cd CodeRAG
```

### Step 2: Install dependencies

```bash
# Install pnpm if you do not have it
npm install -g pnpm

# Install all workspace dependencies
pnpm install
```

### Step 3: Build all packages

```bash
pnpm build
```

This compiles all 7 packages in the monorepo:

```
packages/
  core/              # Core library
  cli/               # CLI tool (the `coderag` command)
  mcp-server/        # MCP server for AI agents
  api-server/        # REST API server
  viewer/            # Web-based viewer UI
  vscode-extension/  # VS Code extension
  benchmarks/        # Benchmark suite
```

### Step 4: Link the CLI globally

```bash
cd packages/cli
pnpm link --global
cd ../..
```

After linking, the `coderag` command is available from any directory:

```bash
coderag --version
# 0.1.0
```

### Step 5: Verify with tests

```bash
pnpm test
```

All 1,670 tests should pass.

### Alternative: Run without global link

If you prefer not to link globally, use `npx` from the repository root:

```bash
npx coderag --version
```

---

## Verify Ollama Connectivity

After installation, verify CodeRAG can reach Ollama:

```bash
# Manual check
curl http://localhost:11434/api/tags

# Or let coderag init check automatically
coderag init
# Output: Ollama is running at http://localhost:11434
```

If Ollama runs on a non-default host, set the environment variable:

```bash
export OLLAMA_HOST=http://my-server:11434
```

## Non-default Embedding Providers

If you prefer cloud-based embeddings instead of Ollama, you can use Voyage or OpenAI. Update your `.coderag.yaml` after running `coderag init`:

```yaml
# Voyage (requires VOYAGE_API_KEY environment variable)
embedding:
  provider: voyage
  model: voyage-code-3
  dimensions: 1024

# OpenAI (requires OPENAI_API_KEY environment variable)
embedding:
  provider: openai
  model: text-embedding-3-small
  dimensions: 1536
```

See [Configuration](configuration.md) for the full reference.

## Next Steps

- [Configuration](configuration.md) -- Customize `.coderag.yaml` for your setup
- [Troubleshooting](troubleshooting.md) -- Common issues and solutions
