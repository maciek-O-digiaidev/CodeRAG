import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { LanceDBStore, BM25Index, type CodeRAGConfig } from '@code-rag/core';
import { rebuildMergedIndex, IndexLogger } from './index-cmd.js';

const DIMENSIONS = 4; // Use tiny vectors for speed

/** Create a minimal CodeRAGConfig for testing. */
function makeConfig(): CodeRAGConfig {
  return {
    version: '1',
    project: { name: 'test', languages: ['typescript'] },
    embedding: {
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: DIMENSIONS,
      autoStart: false,
      autoStop: false,
      docker: { image: 'ollama/ollama' as const, gpu: 'auto' as const },
    },
    llm: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
    storage: { path: '.coderag' },
    ingestion: { maxTokensPerChunk: 512, exclude: [] },
    search: { topK: 10, vectorWeight: 0.7, bm25Weight: 0.3 },
  } as CodeRAGConfig;
}

/** Seed a per-repo LanceDB store with test data. */
async function seedRepoStore(
  storagePath: string,
  chunks: Array<{ id: string; content: string; nlSummary: string; filePath: string; name: string; startLine: number; endLine: number; repoName: string }>,
): Promise<void> {
  await mkdir(storagePath, { recursive: true });

  const store = new LanceDBStore(storagePath, DIMENSIONS);
  await store.connect();

  const ids = chunks.map((c) => c.id);
  // Simple deterministic vectors
  const embeddings = chunks.map((_, i) => {
    const vec = new Array(DIMENSIONS).fill(0);
    vec[i % DIMENSIONS] = 1.0;
    return vec;
  });
  const metadata = chunks.map((c) => ({
    content: c.content,
    nl_summary: c.nlSummary,
    chunk_type: 'function',
    file_path: c.filePath,
    language: 'typescript',
    start_line: c.startLine,
    end_line: c.endLine,
    name: c.name,
    repo_name: c.repoName,
  }));

  const result = await store.upsert(ids, embeddings, metadata);
  expect(result.isOk()).toBe(true);
  store.close();
}

describe('rebuildMergedIndex', () => {
  let tempDir: string;
  let rootStorage: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coderag-merge-'));
    rootStorage = join(tempDir, '.coderag');
    await mkdir(rootStorage, { recursive: true });
    // Suppress console output (IndexLogger uses ora + console)
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should merge chunks from multiple per-repo stores into root', async () => {
    const repoAPath = join(rootStorage, 'repo-a');
    const repoBPath = join(rootStorage, 'repo-b');

    await seedRepoStore(repoAPath, [
      { id: 'chunk-a1', content: 'function foo() {}', nlSummary: 'A function foo', filePath: 'src/foo.ts', name: 'foo', startLine: 1, endLine: 5, repoName: 'repo-a' },
      { id: 'chunk-a2', content: 'function bar() {}', nlSummary: 'A function bar', filePath: 'src/bar.ts', name: 'bar', startLine: 1, endLine: 3, repoName: 'repo-a' },
    ]);

    await seedRepoStore(repoBPath, [
      { id: 'chunk-b1', content: 'class Widget {}', nlSummary: 'A class Widget', filePath: 'lib/widget.ts', name: 'Widget', startLine: 10, endLine: 50, repoName: 'repo-b' },
    ]);

    const config = makeConfig();
    const logger = new IndexLogger(rootStorage, true);

    await rebuildMergedIndex(
      rootStorage,
      [
        { repoName: 'repo-a', repoPath: '/tmp/a', repoStoragePath: repoAPath, parsedFiles: [] },
        { repoName: 'repo-b', repoPath: '/tmp/b', repoStoragePath: repoBPath, parsedFiles: [] },
      ],
      config,
      logger,
    );

    // Verify root LanceDB has all 3 chunks
    const rootStore = new LanceDBStore(rootStorage, DIMENSIONS);
    await rootStore.connect();
    const internal = rootStore as unknown as {
      table: { query: () => { toArray: () => Promise<Array<{ id: string; metadata: string }>> } } | null;
    };
    const rows = await internal.table!.query().toArray();
    expect(rows.length).toBe(3);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(['chunk-a1', 'chunk-a2', 'chunk-b1']);
    rootStore.close();
  });

  it('should preserve all metadata fields without double-serialization', async () => {
    const repoAPath = join(rootStorage, 'repo-a');

    await seedRepoStore(repoAPath, [
      { id: 'chunk-1', content: 'const x = 1;', nlSummary: 'A constant', filePath: 'src/x.ts', name: 'x', startLine: 42, endLine: 99, repoName: 'repo-a' },
    ]);

    const config = makeConfig();
    const logger = new IndexLogger(rootStorage, true);

    await rebuildMergedIndex(
      rootStorage,
      [{ repoName: 'repo-a', repoPath: '/tmp/a', repoStoragePath: repoAPath, parsedFiles: [] }],
      config,
      logger,
    );

    // Read the merged row and parse metadata
    const rootStore = new LanceDBStore(rootStorage, DIMENSIONS);
    await rootStore.connect();
    const internal = rootStore as unknown as {
      table: { query: () => { toArray: () => Promise<Array<{ id: string; metadata: string; content: string; file_path: string }>> } } | null;
    };
    const rows = await internal.table!.query().toArray();
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(row.content).toBe('const x = 1;');
    expect(row.file_path).toBe('src/x.ts');

    // Parse metadata — should NOT be double-serialized
    const meta = JSON.parse(row.metadata) as Record<string, unknown>;
    expect(meta['start_line']).toBe(42);
    expect(meta['end_line']).toBe(99);
    expect(meta['name']).toBe('x');
    expect(meta['repo_name']).toBe('repo-a');
    // Verify metadata.content is a string, not another JSON blob
    expect(typeof meta['content']).toBe('string');
    expect(meta['content']).toBe('const x = 1;');

    rootStore.close();
  });

  it('should create BM25 index at root level', async () => {
    const repoAPath = join(rootStorage, 'repo-a');

    await seedRepoStore(repoAPath, [
      { id: 'chunk-1', content: 'authentication login', nlSummary: 'Auth login', filePath: 'auth.ts', name: 'login', startLine: 1, endLine: 10, repoName: 'repo-a' },
    ]);

    const config = makeConfig();
    const logger = new IndexLogger(rootStorage, true);

    await rebuildMergedIndex(
      rootStorage,
      [{ repoName: 'repo-a', repoPath: '/tmp/a', repoStoragePath: repoAPath, parsedFiles: [] }],
      config,
      logger,
    );

    const bm25Path = join(rootStorage, 'bm25-index.json');
    expect(existsSync(bm25Path)).toBe(true);

    const bm25Data = await readFile(bm25Path, 'utf-8');
    const bm25 = BM25Index.deserialize(bm25Data);
    const results = bm25.search('authentication login', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.chunkId).toBe('chunk-1');
  });

  it('should create graph.json at root level', async () => {
    const repoAPath = join(rootStorage, 'repo-a');

    await seedRepoStore(repoAPath, [
      { id: 'chunk-1', content: 'test', nlSummary: 'test', filePath: 'a.ts', name: 'a', startLine: 1, endLine: 1, repoName: 'repo-a' },
    ]);

    // Write a per-repo graph
    const graphData = {
      nodes: [{ id: 'node-1', filePath: 'a.ts', name: 'a', type: 'function', language: 'typescript' }],
      edges: [],
    };
    await writeFile(join(repoAPath, 'graph.json'), JSON.stringify(graphData), 'utf-8');

    const config = makeConfig();
    const logger = new IndexLogger(rootStorage, true);

    await rebuildMergedIndex(
      rootStorage,
      [{ repoName: 'repo-a', repoPath: '/tmp/a', repoStoragePath: repoAPath, parsedFiles: [] }],
      config,
      logger,
    );

    const rootGraphPath = join(rootStorage, 'graph.json');
    expect(existsSync(rootGraphPath)).toBe(true);
    const rootGraph = JSON.parse(await readFile(rootGraphPath, 'utf-8')) as { nodes: unknown[] };
    expect(rootGraph.nodes.length).toBe(1);
  });

  it('should handle repo with empty LanceDB gracefully', async () => {
    const repoAPath = join(rootStorage, 'repo-a');
    await mkdir(repoAPath, { recursive: true });
    // No LanceDB data seeded — empty repo

    const config = makeConfig();
    const logger = new IndexLogger(rootStorage, true);

    // Should not throw
    await rebuildMergedIndex(
      rootStorage,
      [{ repoName: 'repo-a', repoPath: '/tmp/a', repoStoragePath: repoAPath, parsedFiles: [] }],
      config,
      logger,
    );

    // Root BM25 should exist but be empty
    const bm25Path = join(rootStorage, 'bm25-index.json');
    expect(existsSync(bm25Path)).toBe(true);
    const bm25Data = await readFile(bm25Path, 'utf-8');
    const parsed = JSON.parse(bm25Data) as { documentCount: number };
    expect(parsed.documentCount).toBe(0);
  });

  it('should handle vectors from Arrow types (Array.from conversion)', async () => {
    // This test verifies that even if vector data has exotic types,
    // the conversion via Array.from produces valid number arrays
    const repoAPath = join(rootStorage, 'repo-a');

    await seedRepoStore(repoAPath, [
      { id: 'vec-test', content: 'vector test', nlSummary: 'test', filePath: 'v.ts', name: 'v', startLine: 1, endLine: 1, repoName: 'repo-a' },
    ]);

    const config = makeConfig();
    const logger = new IndexLogger(rootStorage, true);

    await rebuildMergedIndex(
      rootStorage,
      [{ repoName: 'repo-a', repoPath: '/tmp/a', repoStoragePath: repoAPath, parsedFiles: [] }],
      config,
      logger,
    );

    // Verify root store can be queried (which means vectors were stored correctly)
    const rootStore = new LanceDBStore(rootStorage, DIMENSIONS);
    await rootStore.connect();
    const queryVec = new Array(DIMENSIONS).fill(0);
    queryVec[0] = 1.0;
    const queryResult = await rootStore.query(queryVec, 5);
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isOk()) {
      expect(queryResult.value.length).toBe(1);
      expect(queryResult.value[0]!.id).toBe('vec-test');
    }
    rootStore.close();
  });
});
