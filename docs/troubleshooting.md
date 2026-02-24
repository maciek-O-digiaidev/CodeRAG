# Troubleshooting

This page covers common issues you may encounter when using CodeRAG, along with diagnostic commands and solutions.

---

## 1. Ollama Not Running

**Symptom:** `coderag init` reports "Ollama is not reachable" or `coderag index` fails with a connection error.

**Diagnostic:**

```bash
curl http://localhost:11434/api/tags
```

If this returns a connection error, Ollama is not running.

**Solution:**

```bash
# Start the Ollama server
ollama serve

# Or on macOS, open the Ollama desktop app (it starts the server automatically)
```

If Ollama is running on a non-default host:

```bash
export OLLAMA_HOST=http://my-server:11434
```

---

## 2. Ollama Model Not Found

**Symptom:** Indexing fails with an error like `model 'nomic-embed-text' not found` or `model 'qwen2.5-coder:7b' not found`.

**Diagnostic:**

```bash
ollama list
```

Check whether the required models appear in the output.

**Solution:**

```bash
# Pull the embedding model
ollama pull nomic-embed-text

# Pull the NL enrichment model
ollama pull qwen2.5-coder:7b
```

If you are using a different model, verify the `embedding.model` and `llm.model` fields in your `.coderag.yaml` match an installed model name exactly.

---

## 3. Config File Not Found

**Symptom:** `coderag index` or `coderag search` fails with `Config file not found: /path/to/.coderag.yaml`.

**Solution:**

Run `coderag init` in your project root to generate the config file:

```bash
cd /path/to/your/project
coderag init
```

If you already have a `.coderag.yaml` in a different location, make sure you are running the command from the correct directory.

---

## 4. Config Validation Error

**Symptom:** CodeRAG prints an error like `Config validation failed: embedding.dimensions: Dimensions must be positive`.

**Diagnostic:**

```bash
# Check your config file for syntax errors
cat .coderag.yaml
```

**Solution:**

The error message indicates which field is invalid. Common mistakes:

| Error | Cause | Fix |
|-------|-------|-----|
| `Dimensions must be positive` | `dimensions: 0` or negative | Set to a positive integer (768 for nomic-embed-text) |
| `vectorWeight must be between 0 and 1` | Weight > 1 or < 0 | Set to a value between 0.0 and 1.0 |
| `Embedding provider must not be empty` | `provider: ""` or missing | Set to `auto`, `ollama`, `openai-compatible`, `voyage`, or `openai` |
| `Project name must not be empty` | `name: ""` | Set a project name |
| `Storage path must not be empty` | `path: ""` | Set to `.coderag` or another valid path |
| `Missing environment variable(s): ADO_PAT` | `${ADO_PAT}` in config but env var not set | `export ADO_PAT=your-token` |

You can also remove the `.coderag.yaml` and regenerate it:

```bash
coderag init --force
```

---

## 5. Permission Errors During Indexing

**Symptom:** `coderag index` fails with `EACCES: permission denied` or `EPERM: operation not permitted`.

**Diagnostic:**

```bash
ls -la .coderag/
ls -la .coderag.yaml
```

**Solution:**

Ensure you have write permissions to both the config file and the storage directory:

```bash
chmod -R u+rw .coderag/
chmod u+rw .coderag.yaml
```

On macOS, if you see permission errors related to reading source files, check that your terminal app has "Full Disk Access" in System Settings > Privacy & Security.

---

## 6. Large Repository Timeout

**Symptom:** Indexing hangs or takes excessively long (> 30 minutes for a medium-sized repo).

**Diagnostic:**

```bash
# Check indexing progress
cat .coderag/index-progress.json

# Check the indexing log
tail -50 .coderag/index.log
```

**Solution:**

1. **NL enrichment is the bottleneck.** Use a smaller LLM model:

   ```yaml
   llm:
     provider: ollama
     model: "qwen2.5-coder:1.5b"  # Faster, less RAM
   ```

2. **Exclude unnecessary files.** Add more patterns to the exclude list:

   ```yaml
   ingestion:
     exclude:
       - node_modules
       - dist
       - .git
       - coverage
       - "*.min.js"
       - "*.generated.*"
       - vendor
       - __pycache__
   ```

3. **Run incrementally.** After the first full index, subsequent runs only process changed files:

   ```bash
   coderag index          # Incremental (fast)
   coderag index --full   # Full rebuild (slow)
   ```

4. **Prevent macOS sleep** during long indexing runs:

   ```bash
   caffeinate -dims coderag index
   ```

---

## 7. LanceDB Storage Issues

**Symptom:** Search returns 0 results even after indexing, or you see errors about LanceDB tables.

**Diagnostic:**

```bash
# Check index status
coderag status --json

# Check if the storage directory has data
ls -la .coderag/
du -sh .coderag/
```

If `totalChunks` is 0 but you indexed files, the data may be corrupted.

**Solution:**

1. **Re-index from scratch:**

   ```bash
   rm -rf .coderag/
   mkdir .coderag
   coderag index --full
   ```

2. **Check storage path.** Ensure `storage.path` in `.coderag.yaml` matches the actual directory:

   ```yaml
   storage:
     path: .coderag
   ```

3. **Disk space.** LanceDB stores data locally. Ensure sufficient disk space:

   ```bash
   df -h .
   ```

---

## 8. BM25 Index Corruption

**Symptom:** Search works but keyword matching seems broken -- only vector results appear, or search returns unexpected results.

**Diagnostic:**

```bash
# Check if the BM25 index file exists and has content
ls -la .coderag/bm25-index.json
wc -c .coderag/bm25-index.json
```

If the file is empty (0 bytes) or missing, the BM25 index was not built.

**Solution:**

Re-index to rebuild both the vector and BM25 indices:

```bash
coderag index --full
```

If you only want to verify search without BM25, set `bm25Weight: 0` temporarily:

```yaml
search:
  vectorWeight: 1.0
  bm25Weight: 0.0
```

---

## 9. Tree-sitter WASM Loading Errors

**Symptom:** Indexing fails with errors like `Cannot load tree-sitter WASM`, `RuntimeError: memory access out of bounds`, or `ABI version mismatch`.

**Diagnostic:**

```bash
# Check Node.js version
node --version

# Check if tree-sitter WASM files are present
ls node_modules/tree-sitter-wasms/out/
```

**Solution:**

1. **Node.js version.** Tree-sitter WASM bindings require Node.js >= 20. Upgrade if needed:

   ```bash
   nvm install 20
   nvm use 20
   ```

2. **Reinstall dependencies.** WASM binary incompatibilities can occur after Node.js upgrades:

   ```bash
   rm -rf node_modules
   pnpm install
   ```

3. **ABI mismatch.** If you see `ABI version mismatch` errors, ensure `web-tree-sitter` and `tree-sitter-wasms` versions are compatible. Check `packages/core/package.json` for the expected versions.

---

## 10. API Key Errors (Voyage / OpenAI)

**Symptom:** Embedding fails with `401 Unauthorized` or `Invalid API key` when using Voyage or OpenAI providers.

**Diagnostic:**

```bash
# Check if the environment variable is set
echo $VOYAGE_API_KEY
echo $OPENAI_API_KEY
```

**Solution:**

1. **Set the API key as an environment variable:**

   ```bash
   # Voyage
   export VOYAGE_API_KEY=your-api-key-here

   # OpenAI
   export OPENAI_API_KEY=your-api-key-here
   ```

2. **Persist across sessions** by adding to your shell profile:

   ```bash
   # ~/.zshrc or ~/.bashrc
   export VOYAGE_API_KEY=your-api-key-here
   ```

3. **Verify the provider and model match.** If you set `provider: voyage` but the model name is an OpenAI model, you will get errors:

   ```yaml
   embedding:
     provider: voyage           # Must match the API key
     model: voyage-code-3       # Must be a Voyage model
     dimensions: 1024           # Must match the model's output
   ```

---

## 11. Docker GPU Issues

**Symptom:** Ollama inside Docker cannot access the GPU, resulting in very slow inference.

**Solution:**

CodeRAG itself does not need GPU access. The GPU is needed by the **Ollama server** for model inference. Run Ollama on the host machine and point the Docker container to it:

```bash
# Run Ollama on the host
ollama serve

# Point Docker container to host Ollama
docker run \
  -e OLLAMA_HOST=http://host.docker.internal:11434 \
  coderag-api
```

On Linux, if you need Ollama inside Docker with GPU:

```bash
# Ensure NVIDIA Container Toolkit is installed
# https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html

docker run --gpus all \
  -e NVIDIA_VISIBLE_DEVICES=all \
  ollama/ollama
```

---

## 12. MCP Server Connection Failures

**Symptom:** AI agent cannot connect to the CodeRAG MCP server, or the server exits immediately.

**Diagnostic:**

```bash
# Test stdio mode manually
coderag serve 2>stderr.log
# The server should stay running, reading from stdin

# Test SSE mode
coderag serve --port 3000
curl http://localhost:3000/sse
```

**Solution:**

1. **stdio mode** (default): Ensure the agent spawns the server correctly. The server reads JSON-RPC from stdin and writes to stdout. Check your agent's MCP configuration:

   ```json
   {
     "mcpServers": {
       "coderag": {
         "command": "npx",
         "args": ["coderag", "serve"],
         "cwd": "/path/to/your/project"
       }
     }
   }
   ```

2. **SSE mode**: If the port is in use:

   ```bash
   # Find what is using the port
   lsof -i :3000

   # Use a different port
   coderag serve --port 3001
   ```

3. **Missing index.** The MCP server needs an indexed codebase. Run `coderag index` first.

---

## 13. Incremental Index Not Detecting Changes

**Symptom:** After editing files, `coderag index` reports "no changes detected" and skips re-indexing.

**Diagnostic:**

```bash
# Check the index state file
cat .coderag/index-state.json | head -20

# Check file modification times
ls -la src/modified-file.ts
```

**Solution:**

1. **Force a full re-index:**

   ```bash
   coderag index --full
   ```

2. **Check `.gitignore`.** If the changed file is in `.gitignore`, CodeRAG will not index it.

3. **Check `exclude` patterns.** Make sure the file is not excluded in `.coderag.yaml`:

   ```yaml
   ingestion:
     exclude:
       - node_modules
       - dist
       # Make sure your file is not matched by these patterns
   ```

---

## 14. Out of Memory During Indexing

**Symptom:** Node.js crashes with `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`.

**Solution:**

1. **Increase Node.js memory limit:**

   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" coderag index
   ```

2. **Reduce chunk size** to lower memory per batch:

   ```yaml
   ingestion:
     maxTokensPerChunk: 256
   ```

3. **Exclude large files** like generated code, vendor bundles, or data files:

   ```yaml
   ingestion:
     exclude:
       - "*.min.js"
       - "*.bundle.js"
       - vendor
       - generated
   ```

---

## 15. Concurrent Indexing Lock Error

**Symptom:** `coderag index` fails with `Another indexing process is already running` or a lock file error.

**Diagnostic:**

```bash
ls -la .coderag/index.lock
```

**Solution:**

If no other indexing process is running (e.g., the previous run crashed), remove the stale lock file:

```bash
rm .coderag/index.lock
coderag index
```

---

## Getting Help

If your issue is not covered here:

1. **Check the index log** for detailed error output:

   ```bash
   cat .coderag/index.log
   ```

2. **Run with verbose Node.js output:**

   ```bash
   NODE_DEBUG=* coderag index 2>debug.log
   ```

3. **Check the status** for a high-level health report:

   ```bash
   coderag status --json
   ```

4. **File an issue** at [CodeRAG Issues](https://dev.azure.com/momc-pl/CodeRAG/_workitems) with the output of:

   ```bash
   node --version
   pnpm --version
   ollama list
   coderag status --json
   cat .coderag.yaml
   tail -100 .coderag/index.log
   ```
