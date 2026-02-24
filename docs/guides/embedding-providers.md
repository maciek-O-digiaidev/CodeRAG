---
tags:
  - guide
  - embedding
  - ollama
  - voyage
  - openai
  - providers
aliases:
  - embedding-providers
  - embeddings
  - embedding-setup
---

# Embedding Providers

CodeRAG supports multiple embedding providers for converting code and documentation into vector representations. All providers implement the `EmbeddingProvider` interface:

```typescript
interface EmbeddingProvider {
  embed(texts: string[]): Promise<Result<number[][], EmbedError>>;
  readonly dimensions: number;
}
```

## Supported Providers

### Ollama (Local, Default)

Ollama runs embedding models locally with zero cloud dependencies. This is the default and recommended provider for privacy-sensitive environments.

**Setup:**

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull the embedding model
ollama pull nomic-embed-text

# Verify it's running
curl http://localhost:11434/api/tags
```

**Configuration:**

```yaml
embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: 768
```

**Provider details:**

| Setting | Default | Description |
|---------|---------|-------------|
| `baseUrl` | `http://localhost:11434` | Ollama server URL |
| `model` | `nomic-embed-text` | Embedding model name |
| `dimensions` | `768` | Output vector dimensions |
| `timeout` | `30000` | Request timeout in ms |

The `OllamaEmbeddingProvider` automatically batches large inputs into groups of 50 texts per API call to avoid overwhelming the local server.

> [!tip]
> For codebases with many languages, `nomic-embed-text` provides excellent multilingual embedding quality. For pure code embedding, consider `codellama` variants if available in Ollama.

### Voyage Code (API)

Voyage AI's `voyage-code-3` model is specifically trained on source code and achieves state-of-the-art retrieval quality on code benchmarks.

**Setup:**

1. Sign up at https://www.voyageai.com/
2. Generate an API key in the dashboard
3. Set the environment variable:

```bash
export VOYAGE_API_KEY="your-api-key"
```

**Configuration:**

```yaml
embedding:
  provider: voyage
  model: voyage-code-3
  dimensions: 1024
```

### OpenAI (API)

OpenAI's `text-embedding-3-small` provides a good balance of quality and cost for general-purpose embedding.

**Setup:**

1. Create an API key at https://platform.openai.com/api-keys
2. Set the environment variable:

```bash
export OPENAI_API_KEY="sk-..."
```

**Configuration:**

```yaml
embedding:
  provider: openai
  model: text-embedding-3-small
  dimensions: 1536
```

## Provider Comparison

| Feature | Ollama | Voyage Code | OpenAI |
|---------|--------|-------------|--------|
| **Model** | nomic-embed-text | voyage-code-3 | text-embedding-3-small |
| **Dimensions** | 768 | 1024 | 1536 |
| **Code quality** | Good | Excellent | Good |
| **Speed** | Depends on hardware | Fast (API) | Fast (API) |
| **Cost** | Free (local compute) | Pay per token | Pay per token |
| **Privacy** | Full (local) | Data sent to API | Data sent to API |
| **Offline** | Yes | No | No |
| **Setup** | Install Ollama + model | API key only | API key only |

> [!note]
> The "Code quality" rating reflects general performance on code retrieval benchmarks. Voyage Code's `voyage-code-3` model is purpose-built for code and typically outperforms general-purpose models on code search tasks.

## Configuration in .coderag.yaml

The embedding section of `.coderag.yaml` controls which provider is used:

```yaml
embedding:
  provider: ollama    # 'ollama' | 'voyage' | 'openai'
  model: nomic-embed-text
  dimensions: 768
```

The `EmbeddingConfig` type:

```typescript
interface EmbeddingConfig {
  provider: string;    // Provider identifier
  model: string;       // Model name
  dimensions: number;  // Output vector dimensions
}
```

> [!warning]
> The `dimensions` value must match the model's actual output dimensions. Mismatched dimensions will cause indexing or search failures.

## Switching Providers

Changing the embedding provider **requires a full reindex** because:

1. Different models produce vectors with different dimensions
2. Even models with the same dimensions encode semantics differently
3. Mixing embeddings from different models in the same vector store produces meaningless similarity scores

**Steps to switch:**

```bash
# 1. Update .coderag.yaml with the new provider settings
# 2. Delete the existing index
rm -rf .coderag/

# 3. Run a full reindex
coderag index --full
```

> [!warning]
> Deleting `.coderag/` removes all indexed data including dependency graphs and BM25 indices. This is intentional -- a provider switch requires rebuilding everything from scratch.

## Adding a Custom Provider

To add a new embedding provider, implement the `EmbeddingProvider` interface:

```typescript
import { ok, err, type Result } from 'neverthrow';
import { EmbedError, type EmbeddingProvider } from '@code-rag/core';

export class MyCustomProvider implements EmbeddingProvider {
  readonly dimensions = 512;

  async embed(texts: string[]): Promise<Result<number[][], EmbedError>> {
    try {
      // Your embedding logic here
      const embeddings = await myEmbeddingAPI(texts);
      return ok(embeddings);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new EmbedError(`Custom embed failed: ${message}`));
    }
  }
}
```

Key requirements:
- Return `Result<number[][], EmbedError>` using the neverthrow pattern
- Handle empty input arrays (return `ok([])`)
- The `dimensions` property must match the actual output dimensions
- Handle batching internally if the upstream API has size limits

## See Also

- [[configuration]] -- full `.coderag.yaml` reference
- [[interfaces]] -- all provider interfaces
- [[design-decisions]] -- why NL enrichment happens before embedding
