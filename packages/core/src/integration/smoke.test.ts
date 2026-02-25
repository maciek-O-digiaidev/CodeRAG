import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ok, type Result } from 'neverthrow';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { TreeSitterParser } from '../parser/tree-sitter-parser.js';
import { MarkdownParser } from '../parser/markdown-parser.js';
import { ASTChunker } from '../chunker/ast-chunker.js';
import { LanceDBStore } from '../embedding/lancedb-store.js';
import { BM25Index } from '../embedding/bm25-index.js';
import { HybridSearch } from '../embedding/hybrid-search.js';
import type { EmbeddingProvider } from '../types/provider.js';
import { EmbedError } from '../types/provider.js';
import type { Chunk, ChunkType } from '../types/chunk.js';
import type { SearchConfig } from '../types/config.js';
import type { SearchResult } from '../types/search.js';

// ---------------------------------------------------------------------------
// Deterministic mock embedding provider
// ---------------------------------------------------------------------------

const MOCK_DIMENSIONS = 64;

/**
 * Generate a deterministic vector from text content using a hash-based approach.
 * The same text always produces the same vector, enabling reproducible searches.
 */
function hashToVector(text: string, dimensions: number): number[] {
  const hash = createHash('sha256').update(text).digest();
  const vector: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    // Use hash bytes cyclically, normalize to [-1, 1]
    const byteIndex = i % hash.length;
    const byte = hash[byteIndex] as number;
    vector.push((byte / 127.5) - 1);
  }
  // Normalize the vector to unit length
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] = (vector[i] as number) / magnitude;
    }
  }
  return vector;
}

/**
 * Deterministic embedding provider that produces consistent vectors
 * from text content using SHA-256 hashing. No external service needed.
 */
class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = MOCK_DIMENSIONS;

  async embed(texts: string[]): Promise<Result<number[][], EmbedError>> {
    const embeddings = texts.map((text) => hashToVector(text, this.dimensions));
    return ok(embeddings);
  }
}

// ---------------------------------------------------------------------------
// Fixture file definitions
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  'fixtures',
);

interface FixtureFile {
  readonly relativePath: string;
  readonly isMarkdown: boolean;
}

const FIXTURE_FILES: readonly FixtureFile[] = [
  { relativePath: 'auth-service.ts', isMarkdown: false },
  { relativePath: 'user-types.ts', isMarkdown: false },
  { relativePath: 'utils.ts', isMarkdown: false },
  { relativePath: 'config.ts', isMarkdown: false },
  { relativePath: 'api-routes.ts', isMarkdown: false },
  { relativePath: 'validators.ts', isMarkdown: false },
  { relativePath: 'README.md', isMarkdown: true },
];

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

const VALID_CHUNK_TYPES: readonly ChunkType[] = [
  'function', 'method', 'class', 'module', 'interface',
  'type_alias', 'config_block', 'import_block', 'doc',
];

const SEARCH_CONFIG: SearchConfig = {
  topK: 10,
  vectorWeight: 0.7,
  bm25Weight: 0.3,
};

describe('Integration smoke test: full pipeline', () => {
  let tmpDir: string;
  let lanceStore: LanceDBStore;
  let bm25Index: BM25Index;
  let hybridSearch: HybridSearch;
  let embeddingProvider: DeterministicEmbeddingProvider;
  let allChunks: Chunk[];
  let parser: TreeSitterParser;

  beforeAll(async () => {
    // 1. Create temp directory for LanceDB storage
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderag-smoke-'));

    // 2. Initialize parsers
    parser = new TreeSitterParser();
    const initResult = await parser.initialize();
    expect(initResult.isOk()).toBe(true);

    const mdParser = new MarkdownParser({ maxTokensPerChunk: 1024 });

    // 3. Initialize chunker
    const chunker = new ASTChunker({ maxTokensPerChunk: 1024 });

    // 4. Parse all fixture files
    allChunks = [];

    for (const fixture of FIXTURE_FILES) {
      const filePath = path.join(FIXTURES_DIR, fixture.relativePath);
      const content = fs.readFileSync(filePath, 'utf-8');

      if (fixture.isMarkdown) {
        // Parse markdown files directly into chunks
        const mdResult = mdParser.parse(fixture.relativePath, content);
        expect(mdResult.isOk()).toBe(true);
        if (mdResult.isOk()) {
          allChunks.push(...mdResult.value.chunks);
        }
      } else {
        // Parse TypeScript files with tree-sitter, then chunk
        const parseResult = await parser.parse(fixture.relativePath, content);
        expect(parseResult.isOk()).toBe(true);
        if (parseResult.isOk()) {
          const chunkResult = await chunker.chunk(parseResult.value);
          expect(chunkResult.isOk()).toBe(true);
          if (chunkResult.isOk()) {
            allChunks.push(...chunkResult.value);
          }
        }
      }
    }

    expect(allChunks.length).toBeGreaterThan(0);

    // 5. Embed all chunks
    embeddingProvider = new DeterministicEmbeddingProvider();

    const textsToEmbed = allChunks.map(
      (chunk) => chunk.nlSummary || chunk.content,
    );
    const embedResult = await embeddingProvider.embed(textsToEmbed);
    expect(embedResult.isOk()).toBe(true);

    const embeddings = embedResult.isOk() ? embedResult.value : [];

    // 6. Store in LanceDB
    lanceStore = new LanceDBStore(tmpDir, MOCK_DIMENSIONS);
    await lanceStore.connect();

    const ids = allChunks.map((chunk) => chunk.id);
    const metadata = allChunks.map((chunk) => ({
      content: chunk.content,
      nl_summary: chunk.nlSummary,
      chunk_type: chunk.metadata.chunkType,
      file_path: chunk.filePath,
      language: chunk.language,
      name: chunk.metadata.name,
    }));

    const upsertResult = await lanceStore.upsert(ids, embeddings, metadata);
    expect(upsertResult.isOk()).toBe(true);

    // 7. Build BM25 index
    bm25Index = new BM25Index();
    bm25Index.addChunks(allChunks);

    // 8. Create HybridSearch
    hybridSearch = new HybridSearch(
      lanceStore,
      bm25Index,
      embeddingProvider,
      SEARCH_CONFIG,
    );
  }, 30000);

  afterAll(() => {
    parser.dispose();
    lanceStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Pipeline verification tests
  // -------------------------------------------------------------------------

  describe('parsing and chunking', () => {
    it('should produce chunks from all fixture files', () => {
      // Each fixture file should contribute at least one chunk
      const filePathsInChunks = new Set(
        allChunks.map((chunk) => chunk.filePath),
      );

      for (const fixture of FIXTURE_FILES) {
        const expectedPath = fixture.relativePath;
        expect(filePathsInChunks.has(expectedPath)).toBe(true);
      }
    });

    it('should produce a reasonable number of chunks from 7 fixture files', () => {
      // 6 TS files + 1 MD file should produce at least 7 chunks (one per file minimum)
      // and realistically many more (one per declaration)
      expect(allChunks.length).toBeGreaterThanOrEqual(7);
      // But not an unreasonable number
      expect(allChunks.length).toBeLessThan(200);
    });

    it('should assign valid chunk types to all chunks', () => {
      for (const chunk of allChunks) {
        expect(VALID_CHUNK_TYPES).toContain(chunk.metadata.chunkType);
      }
    });

    it('should have non-empty content in every chunk', () => {
      for (const chunk of allChunks) {
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      }
    });

    it('should produce class chunks from auth-service.ts', () => {
      const authChunks = allChunks.filter(
        (c) => c.filePath === 'auth-service.ts' && c.metadata.chunkType === 'class',
      );
      expect(authChunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce interface chunks from user-types.ts', () => {
      const interfaceChunks = allChunks.filter(
        (c) => c.filePath === 'user-types.ts' && c.metadata.chunkType === 'interface',
      );
      expect(interfaceChunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce function chunks from utils.ts', () => {
      const fnChunks = allChunks.filter(
        (c) => c.filePath === 'utils.ts' && c.metadata.chunkType === 'function',
      );
      expect(fnChunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce module chunks from config.ts', () => {
      const configChunks = allChunks.filter(
        (c) => c.filePath === 'config.ts' && c.metadata.chunkType === 'module',
      );
      expect(configChunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce doc chunks from README.md', () => {
      const docChunks = allChunks.filter(
        (c) => c.filePath === 'README.md' && c.metadata.chunkType === 'doc',
      );
      expect(docChunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should set language to typescript for TS files', () => {
      const tsChunks = allChunks.filter((c) => c.filePath.endsWith('.ts'));
      for (const chunk of tsChunks) {
        expect(chunk.language).toBe('typescript');
      }
    });

    it('should set language to markdown for MD files', () => {
      const mdChunks = allChunks.filter((c) => c.filePath.endsWith('.md'));
      for (const chunk of mdChunks) {
        expect(chunk.language).toBe('markdown');
      }
    });
  });

  describe('embedding and storage', () => {
    it('should store all chunks in LanceDB', async () => {
      const countResult = await lanceStore.count();
      expect(countResult.isOk()).toBe(true);
      if (countResult.isOk()) {
        expect(countResult.value).toBe(allChunks.length);
      }
    });

    it('should store all chunks in BM25 index', () => {
      expect(bm25Index.count()).toBe(allChunks.length);
    });

    it('should produce deterministic embeddings for the same text', async () => {
      const text = 'function hashPassword';
      const result1 = await embeddingProvider.embed([text]);
      const result2 = await embeddingProvider.embed([text]);

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      if (result1.isOk() && result2.isOk()) {
        expect(result1.value[0]).toEqual(result2.value[0]);
      }
    });

    it('should produce different embeddings for different text', async () => {
      const result = await embeddingProvider.embed([
        'authentication login',
        'database configuration',
      ]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]).not.toEqual(result.value[1]);
      }
    });
  });

  describe('search: authentication queries', () => {
    it('should find auth-service chunks when searching for authentication', async () => {
      const result = await hybridSearch.search('authentication login session');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
        verifySearchResults(result.value);

        // At least one result should be from auth-service.ts
        const authResults = result.value.filter((r) =>
          r.chunk?.filePath === 'auth-service.ts' || r.metadata.name.includes('AuthService'),
        );
        expect(authResults.length).toBeGreaterThan(0);
      }
    });

    it('should return results with non-empty content for auth queries', async () => {
      const result = await hybridSearch.search('login logout token');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        for (const r of result.value) {
          expect(r.content.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('search: type definition queries', () => {
    it('should find user type definitions', async () => {
      const result = await hybridSearch.search('user interface type definition');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
        verifySearchResults(result.value);

        // At least one result should reference user types
        const userTypeResults = result.value.filter(
          (r) =>
            r.chunk?.filePath === 'user-types.ts' ||
            r.content.includes('interface User') ||
            r.content.includes('interface AuthToken'),
        );
        expect(userTypeResults.length).toBeGreaterThan(0);
      }
    });
  });

  describe('search: utility function queries', () => {
    it('should find utility functions', async () => {
      const result = await hybridSearch.search('utility helper function hash password');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
        verifySearchResults(result.value);

        // At least one result should be from utils.ts
        const utilResults = result.value.filter(
          (r) =>
            r.chunk?.filePath === 'utils.ts' ||
            r.content.includes('hashPassword') ||
            r.content.includes('generateId'),
        );
        expect(utilResults.length).toBeGreaterThan(0);
      }
    });
  });

  describe('search: configuration queries', () => {
    it('should find configuration constants', async () => {
      const result = await hybridSearch.search('configuration constants database port');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
        verifySearchResults(result.value);

        // At least one result should be from config.ts
        const configResults = result.value.filter(
          (r) =>
            r.chunk?.filePath === 'config.ts' ||
            r.content.includes('DATABASE_CONFIG') ||
            r.content.includes('DEFAULT_PORT'),
        );
        expect(configResults.length).toBeGreaterThan(0);
      }
    });
  });

  describe('search: validation queries', () => {
    it('should find validation functions', async () => {
      const result = await hybridSearch.search('validate email password input sanitize');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
        verifySearchResults(result.value);

        const validatorResults = result.value.filter(
          (r) =>
            r.chunk?.filePath === 'validators.ts' ||
            r.content.includes('isValidEmail') ||
            r.content.includes('isStrongPassword'),
        );
        expect(validatorResults.length).toBeGreaterThan(0);
      }
    });
  });

  describe('search: documentation queries', () => {
    it('should find markdown documentation chunks', async () => {
      const result = await hybridSearch.search('fixture application structure modules');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
        verifySearchResults(result.value);

        const docResults = result.value.filter(
          (r) =>
            r.chunk?.filePath === 'README.md' ||
            r.metadata.chunkType === 'doc',
        );
        expect(docResults.length).toBeGreaterThan(0);
      }
    });
  });

  describe('search: result metadata correctness', () => {
    it('should include valid filePath in all results', async () => {
      const result = await hybridSearch.search('function class interface');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        for (const r of result.value) {
          if (r.chunk) {
            expect(r.chunk.filePath.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should include valid chunkType in all results', async () => {
      const result = await hybridSearch.search('authentication');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        for (const r of result.value) {
          expect(VALID_CHUNK_TYPES).toContain(r.metadata.chunkType);
        }
      }
    });

    it('should have positive scores for all results', async () => {
      const result = await hybridSearch.search('user');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        for (const r of result.value) {
          expect(r.score).toBeGreaterThan(0);
        }
      }
    });

    it('should return results sorted by score descending', async () => {
      const result = await hybridSearch.search('password hash');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        for (let i = 1; i < result.value.length; i++) {
          const prev = result.value[i - 1] as SearchResult;
          const curr = result.value[i] as SearchResult;
          expect(prev.score).toBeGreaterThanOrEqual(curr.score);
        }
      }
    });

    it('should use hybrid search method for all results', async () => {
      const result = await hybridSearch.search('token');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        for (const r of result.value) {
          expect(r.method).toBe('hybrid');
        }
      }
    });
  });

  describe('search: topK control', () => {
    it('should respect topK limit', async () => {
      const result = await hybridSearch.search('function', { topK: 3 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeLessThanOrEqual(3);
        expect(result.value.length).toBeGreaterThan(0);
      }
    });

    it('should return more results with higher topK', async () => {
      const result3 = await hybridSearch.search('function', { topK: 3 });
      const result10 = await hybridSearch.search('function', { topK: 10 });

      expect(result3.isOk()).toBe(true);
      expect(result10.isOk()).toBe(true);
      if (result3.isOk() && result10.isOk()) {
        expect(result10.value.length).toBeGreaterThanOrEqual(result3.value.length);
      }
    });
  });

  describe('BM25 standalone search', () => {
    it('should find results by keyword matching', () => {
      const results = bm25Index.search('AuthService', 5);
      expect(results.length).toBeGreaterThan(0);

      const authResult = results.find(
        (r) => r.content.includes('AuthService') || r.content.includes('login'),
      );
      expect(authResult).toBeDefined();
    });

    it('should find validation functions by name', () => {
      const results = bm25Index.search('isValidEmail', 5);
      expect(results.length).toBeGreaterThan(0);

      const emailResult = results.find(
        (r) => r.content.includes('isValidEmail'),
      );
      expect(emailResult).toBeDefined();
    });
  });
}, 30000);

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Verify that search results have the required fields populated correctly.
 */
function verifySearchResults(results: SearchResult[]): void {
  for (const result of results) {
    expect(result.chunkId.length).toBeGreaterThan(0);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
    expect(result.method).toBe('hybrid');
    expect(result.metadata).toBeDefined();
    expect(VALID_CHUNK_TYPES).toContain(result.metadata.chunkType);
  }
}
