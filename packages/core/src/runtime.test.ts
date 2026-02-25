import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntime, RuntimeError } from './runtime.js';

const MINIMAL_CONFIG = `
version: "1"
project:
  name: test-project
  languages: auto
ingestion:
  maxTokensPerChunk: 512
  exclude: [node_modules, dist]
embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: 768
llm:
  provider: ollama
  model: qwen2.5-coder:7b
search:
  topK: 10
  vectorWeight: 0.7
  bm25Weight: 0.3
storage:
  path: .coderag
`;

const OPENAI_COMPAT_CONFIG = `
version: "1"
project:
  name: test-project
  languages: auto
ingestion:
  maxTokensPerChunk: 512
  exclude: [node_modules, dist]
embedding:
  provider: openai-compatible
  model: nomic-embed-text
  dimensions: 768
  openai_compatible:
    base_url: http://localhost:1234/v1
    max_batch_size: 100
llm:
  provider: ollama
  model: qwen2.5-coder:7b
search:
  topK: 10
  vectorWeight: 0.7
  bm25Weight: 0.3
storage:
  path: .coderag
`;

describe('createRuntime', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coderag-runtime-'));
    await mkdir(join(tempDir, '.coderag'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return RuntimeError when config is missing', async () => {
    const result = await createRuntime({ rootDir: tempDir });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(RuntimeError);
      expect(result.error.message).toContain('Config load failed');
    }
  });

  it('should return RuntimeError when storage path escapes root', async () => {
    const maliciousConfig = MINIMAL_CONFIG.replace(
      'path: .coderag',
      'path: /etc/secrets',
    );
    await writeFile(join(tempDir, '.coderag.yaml'), maliciousConfig);

    const result = await createRuntime({ rootDir: tempDir });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Storage path escapes project root');
    }
  });

  it('should create runtime with all services in default mode', async () => {
    await writeFile(join(tempDir, '.coderag.yaml'), MINIMAL_CONFIG);

    const result = await createRuntime({ rootDir: tempDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const runtime = result.value;
      expect(runtime.config).toBeDefined();
      expect(runtime.store).toBeDefined();
      expect(runtime.hybridSearch).toBeDefined();
      expect(runtime.contextExpander).not.toBeNull();
      expect(runtime.graph).toBeDefined();
      // reranker is null because config doesn't enable it
      expect(runtime.reranker).toBeNull();

      runtime.close();
    }
  });

  it('should skip graph, reranker, and context expander in searchOnly mode', async () => {
    await writeFile(join(tempDir, '.coderag.yaml'), MINIMAL_CONFIG);

    const result = await createRuntime({ rootDir: tempDir, searchOnly: true });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const runtime = result.value;
      expect(runtime.config).toBeDefined();
      expect(runtime.store).toBeDefined();
      expect(runtime.hybridSearch).toBeDefined();
      expect(runtime.contextExpander).toBeNull();
      expect(runtime.reranker).toBeNull();

      runtime.close();
    }
  });

  it('should create OpenAI-compatible provider from config', async () => {
    await writeFile(join(tempDir, '.coderag.yaml'), OPENAI_COMPAT_CONFIG);

    const result = await createRuntime({ rootDir: tempDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const runtime = result.value;
      expect(runtime.config.embedding.provider).toBe('openai-compatible');
      expect(runtime.hybridSearch).toBeDefined();

      runtime.close();
    }
  });

  it('should create reranker when enabled in config', async () => {
    const configWithReranker = MINIMAL_CONFIG + `
reranker:
  enabled: true
  model: qwen2.5-coder:7b
  topN: 20
`;
    await writeFile(join(tempDir, '.coderag.yaml'), configWithReranker);

    const result = await createRuntime({ rootDir: tempDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const runtime = result.value;
      expect(runtime.reranker).not.toBeNull();

      runtime.close();
    }
  });

  it('should load BM25 index from file if available', async () => {
    await writeFile(join(tempDir, '.coderag.yaml'), MINIMAL_CONFIG);

    // Write a BM25 index file (empty but valid serialization)
    const bm25Path = join(tempDir, '.coderag', 'bm25-index.json');
    // BM25Index.serialize() produces a MiniSearch JSON blob.
    // We don't need a valid one — the runtime should not fail if deserialize fails.
    await writeFile(bm25Path, '{"invalid": true}');

    // Should still succeed (falling back to empty BM25)
    const result = await createRuntime({ rootDir: tempDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      runtimeClose(result.value);
    }
  });

  it('should load graph from file if available', async () => {
    await writeFile(join(tempDir, '.coderag.yaml'), MINIMAL_CONFIG);

    // Write a graph file
    const graphPath = join(tempDir, '.coderag', 'graph.json');
    const graphData = {
      nodes: [
        { id: 'A', filePath: 'src/a.ts', symbols: ['funcA'], type: 'module' },
        { id: 'B', filePath: 'src/b.ts', symbols: ['funcB'], type: 'module' },
      ],
      edges: [
        { source: 'A', target: 'B', type: 'imports' },
      ],
    };
    await writeFile(graphPath, JSON.stringify(graphData));

    const result = await createRuntime({ rootDir: tempDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const runtime = result.value;
      // Verify graph was loaded
      const nodeA = runtime.graph.getNode('A');
      expect(nodeA).toBeDefined();
      expect(nodeA?.filePath).toBe('src/a.ts');

      const edges = runtime.graph.getEdges('A');
      expect(edges).toHaveLength(1);
      expect(edges[0]?.target).toBe('B');

      runtime.close();
    }
  });

  it('close() should not throw when called', async () => {
    await writeFile(join(tempDir, '.coderag.yaml'), MINIMAL_CONFIG);

    const result = await createRuntime({ rootDir: tempDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(() => result.value.close()).not.toThrow();
    }
  });
});

/** Helper to close runtime without verbose null checks. */
function runtimeClose(runtime: { close(): void }): void {
  runtime.close();
}
