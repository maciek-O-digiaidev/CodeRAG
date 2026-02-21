import { describe, it, expect } from 'vitest';
import { TokenBudgetOptimizer } from './token-budget.js';
import type { ExpandedContext, RelatedChunk } from './context-expander.js';
import type { SearchResult } from '../types/search.js';

function makeSearchResult(
  chunkId: string,
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    chunkId,
    content: `content of ${chunkId}`,
    nlSummary: `summary of ${chunkId}`,
    score: 0.9,
    method: 'hybrid',
    metadata: {
      chunkType: 'function',
      name: chunkId,
      declarations: [],
      imports: [],
      exports: [],
    },
    chunk: {
      id: chunkId,
      content: `content of ${chunkId}`,
      nlSummary: `summary of ${chunkId}`,
      filePath: `src/${chunkId}.ts`,
      startLine: 1,
      endLine: 10,
      language: 'typescript',
      metadata: {
        chunkType: 'function',
        name: chunkId,
        declarations: [],
        imports: [],
        exports: [],
      },
    },
    ...overrides,
  };
}

function makeRelatedChunk(
  chunkId: string,
  relationship: RelatedChunk['relationship'] = 'imports',
  distance = 1,
): RelatedChunk {
  return {
    chunk: makeSearchResult(chunkId),
    relationship,
    distance,
  };
}

function makeExpandedContext(
  overrides: Partial<ExpandedContext> = {},
): ExpandedContext {
  return {
    primaryResults: [
      makeSearchResult('primary1', { score: 0.95 }),
      makeSearchResult('primary2', { score: 0.85 }),
    ],
    relatedChunks: [
      makeRelatedChunk('related1', 'imports', 1),
      makeRelatedChunk('related2', 'imported_by', 2),
    ],
    graphExcerpt: {
      nodes: ['primary1', 'primary2', 'related1', 'related2'],
      edges: [
        { from: 'primary1', to: 'related1', type: 'imports' },
        { from: 'related2', to: 'primary2', type: 'imports' },
      ],
    },
    ...overrides,
  };
}

describe('TokenBudgetOptimizer', () => {
  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const optimizer = new TokenBudgetOptimizer();
      // Validate by checking estimateTokens works
      expect(optimizer.estimateTokens('hello')).toBe(2);
    });

    it('should merge partial config with defaults', () => {
      const optimizer = new TokenBudgetOptimizer({ maxTokens: 4000 });
      // The optimizer should work with partial config
      const result = optimizer.assemble(makeExpandedContext());
      expect(result).toBeDefined();
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens as text.length / 4', () => {
      const optimizer = new TokenBudgetOptimizer();
      expect(optimizer.estimateTokens('abcd')).toBe(1);
      expect(optimizer.estimateTokens('abcdefgh')).toBe(2);
      expect(optimizer.estimateTokens('abc')).toBe(1); // ceil(3/4) = 1
    });

    it('should return 0 for empty string', () => {
      const optimizer = new TokenBudgetOptimizer();
      expect(optimizer.estimateTokens('')).toBe(0);
    });

    it('should round up fractional tokens', () => {
      const optimizer = new TokenBudgetOptimizer();
      // 5 chars / 4 = 1.25 -> ceil = 2
      expect(optimizer.estimateTokens('abcde')).toBe(2);
    });
  });

  describe('assemble', () => {
    it('should produce a content string with sections', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(makeExpandedContext());

      expect(result.content).toContain('## Primary Results');
      expect(result.content).toContain('## Related Context');
      expect(result.content).toContain('## Dependency Graph');
    });

    it('should include primary chunk content', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(makeExpandedContext());

      expect(result.content).toContain('content of primary1');
      expect(result.content).toContain('content of primary2');
    });

    it('should include related chunk content', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(makeExpandedContext());

      expect(result.content).toContain('content of related1');
    });

    it('should include file path headers for primary chunks', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(makeExpandedContext());

      expect(result.content).toContain('File: src/primary1.ts');
    });

    it('should include relationship labels for related chunks', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(makeExpandedContext());

      expect(result.content).toContain('[imports');
    });

    it('should include graph excerpt', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(makeExpandedContext());

      expect(result.content).toContain('primary1 --[imports]--> related1');
    });

    it('should sort primary results by score descending', () => {
      const expanded = makeExpandedContext({
        primaryResults: [
          makeSearchResult('low', { score: 0.3 }),
          makeSearchResult('high', { score: 0.99 }),
          makeSearchResult('mid', { score: 0.6 }),
        ],
      });

      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(expanded);

      // high (0.99) should come before mid (0.6) which should come before low (0.3)
      const highIdx = result.content.indexOf('content of high');
      const midIdx = result.content.indexOf('content of mid');
      const lowIdx = result.content.indexOf('content of low');
      expect(highIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(lowIdx);
    });

    it('should sort related chunks by distance ascending', () => {
      const expanded = makeExpandedContext({
        relatedChunks: [
          makeRelatedChunk('far', 'imports', 3),
          makeRelatedChunk('near', 'imports', 1),
          makeRelatedChunk('mid', 'imports', 2),
        ],
      });

      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(expanded);

      const nearIdx = result.content.indexOf('content of near');
      const midIdx = result.content.indexOf('content of mid');
      const farIdx = result.content.indexOf('content of far');
      expect(nearIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(farIdx);
    });

    it('should set truncated=false when everything fits', () => {
      const optimizer = new TokenBudgetOptimizer({ maxTokens: 100000 });
      const result = optimizer.assemble(makeExpandedContext());

      expect(result.truncated).toBe(false);
    });

    it('should return included primary chunks', () => {
      const optimizer = new TokenBudgetOptimizer();
      const expanded = makeExpandedContext();
      const result = optimizer.assemble(expanded);

      expect(result.primaryChunks.length).toBeGreaterThan(0);
      expect(result.primaryChunks.length).toBeLessThanOrEqual(
        expanded.primaryResults.length,
      );
    });

    it('should return included related chunks', () => {
      const optimizer = new TokenBudgetOptimizer();
      const expanded = makeExpandedContext();
      const result = optimizer.assemble(expanded);

      expect(result.relatedChunks.length).toBeGreaterThanOrEqual(0);
      expect(result.relatedChunks.length).toBeLessThanOrEqual(
        expanded.relatedChunks.length,
      );
    });

    it('should report token count', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(makeExpandedContext());

      expect(result.tokenCount).toBeGreaterThan(0);
    });
  });

  describe('budget overflow handling', () => {
    it('should truncate primary results when budget is very small', () => {
      const optimizer = new TokenBudgetOptimizer({
        maxTokens: 100,
        reserveForAnswer: 0,
        primaryWeight: 1.0,
        relatedWeight: 0,
        graphWeight: 0,
      });

      // Create many large primary results
      const bigResults = Array.from({ length: 20 }, (_, i) =>
        makeSearchResult(`chunk${i}`, {
          score: 0.9 - i * 0.01,
          content: 'x'.repeat(200), // Each chunk ~50 tokens
        }),
      );

      const expanded = makeExpandedContext({
        primaryResults: bigResults,
        relatedChunks: [],
        graphExcerpt: { nodes: [], edges: [] },
      });

      const result = optimizer.assemble(expanded);

      expect(result.primaryChunks.length).toBeLessThan(bigResults.length);
      expect(result.truncated).toBe(true);
    });

    it('should truncate related chunks when budget is limited', () => {
      const optimizer = new TokenBudgetOptimizer({
        maxTokens: 200,
        reserveForAnswer: 0,
        primaryWeight: 0.5,
        relatedWeight: 0.5,
        graphWeight: 0,
      });

      const manyRelated = Array.from({ length: 20 }, (_, i) =>
        makeRelatedChunk(`rel${i}`, 'imports', i + 1),
      );

      const expanded = makeExpandedContext({
        primaryResults: [makeSearchResult('p1', { score: 0.9, content: 'short' })],
        relatedChunks: manyRelated,
        graphExcerpt: { nodes: [], edges: [] },
      });

      const result = optimizer.assemble(expanded);

      expect(result.relatedChunks.length).toBeLessThan(manyRelated.length);
      expect(result.truncated).toBe(true);
    });

    it('should skip graph excerpt when budget is exhausted', () => {
      const optimizer = new TokenBudgetOptimizer({
        maxTokens: 100,
        reserveForAnswer: 0,
        primaryWeight: 0.9,
        relatedWeight: 0.09,
        graphWeight: 0.01, // Only 1 token for graph
      });

      const expanded = makeExpandedContext({
        primaryResults: [makeSearchResult('p1', { score: 0.9, content: 'short' })],
        relatedChunks: [],
        graphExcerpt: {
          nodes: ['a', 'b', 'c', 'd', 'e'],
          edges: [
            { from: 'a', to: 'b', type: 'imports' },
            { from: 'b', to: 'c', type: 'imports' },
            { from: 'c', to: 'd', type: 'imports' },
          ],
        },
      });

      const result = optimizer.assemble(expanded);
      // Graph is too large for 1 token, so it should be excluded and truncated=true
      expect(result.truncated).toBe(true);
    });
  });

  describe('empty inputs', () => {
    it('should handle empty expanded context', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble({
        primaryResults: [],
        relatedChunks: [],
        graphExcerpt: { nodes: [], edges: [] },
      });

      expect(result.content).toBe('');
      expect(result.primaryChunks).toHaveLength(0);
      expect(result.relatedChunks).toHaveLength(0);
      expect(result.tokenCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it('should handle context with only primary results', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble({
        primaryResults: [makeSearchResult('p1')],
        relatedChunks: [],
        graphExcerpt: { nodes: [], edges: [] },
      });

      expect(result.content).toContain('## Primary Results');
      expect(result.content).not.toContain('## Related Context');
      expect(result.content).not.toContain('## Dependency Graph');
    });

    it('should handle context with only related chunks', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble({
        primaryResults: [],
        relatedChunks: [makeRelatedChunk('r1')],
        graphExcerpt: { nodes: [], edges: [] },
      });

      expect(result.content).not.toContain('## Primary Results');
      expect(result.content).toContain('## Related Context');
    });
  });

  describe('budget allocation', () => {
    it('should respect custom weight allocation', () => {
      const optimizer = new TokenBudgetOptimizer({
        maxTokens: 10000,
        reserveForAnswer: 0,
        primaryWeight: 1.0,
        relatedWeight: 0,
        graphWeight: 0,
      });

      const expanded = makeExpandedContext();
      const result = optimizer.assemble(expanded);

      // With 0 weight for related and graph, they should be empty
      expect(result.relatedChunks).toHaveLength(0);
      expect(result.content).not.toContain('## Related Context');
      expect(result.content).not.toContain('## Dependency Graph');
    });

    it('should reserve tokens for answer', () => {
      // With maxTokens=200, reserveForAnswer=190, only 10 tokens available
      const optimizer = new TokenBudgetOptimizer({
        maxTokens: 200,
        reserveForAnswer: 190,
        primaryWeight: 1.0,
        relatedWeight: 0,
        graphWeight: 0,
      });

      const bigResults = Array.from({ length: 10 }, (_, i) =>
        makeSearchResult(`chunk${i}`, {
          score: 0.9,
          content: 'x'.repeat(100),
        }),
      );

      const result = optimizer.assemble({
        primaryResults: bigResults,
        relatedChunks: [],
        graphExcerpt: { nodes: [], edges: [] },
      });

      // Very limited budget should restrict how many primary results fit
      expect(result.primaryChunks.length).toBeLessThan(bigResults.length);
    });
  });

  describe('formatting', () => {
    it('should format primary chunks with name and type', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(
        makeExpandedContext({
          primaryResults: [
            makeSearchResult('myFunc', {
              score: 0.9,
              metadata: {
                chunkType: 'function',
                name: 'myFunc',
                declarations: [],
                imports: [],
                exports: [],
              },
            }),
          ],
        }),
      );

      expect(result.content).toContain('### myFunc (function)');
    });

    it('should format related chunks with relationship and distance', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(
        makeExpandedContext({
          primaryResults: [],
          relatedChunks: [
            makeRelatedChunk('helper', 'imported_by', 2),
          ],
        }),
      );

      expect(result.content).toContain('[imported_by, distance=2]');
    });

    it('should format graph excerpt with node list and edges', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(
        makeExpandedContext({
          primaryResults: [],
          relatedChunks: [],
          graphExcerpt: {
            nodes: ['A', 'B'],
            edges: [{ from: 'A', to: 'B', type: 'imports' }],
          },
        }),
      );

      expect(result.content).toContain('Nodes: A, B');
      expect(result.content).toContain('A --[imports]--> B');
    });

    it('should wrap code in code blocks', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(
        makeExpandedContext({
          primaryResults: [makeSearchResult('p1', { score: 0.9 })],
        }),
      );

      expect(result.content).toContain('```');
    });

    it('should include line numbers in file path when available', () => {
      const optimizer = new TokenBudgetOptimizer();
      const result = optimizer.assemble(
        makeExpandedContext({
          primaryResults: [
            makeSearchResult('p1', {
              score: 0.9,
              chunk: {
                id: 'p1',
                content: 'code',
                nlSummary: 'summary',
                filePath: 'src/foo.ts',
                startLine: 10,
                endLine: 20,
                language: 'typescript',
                metadata: {
                  chunkType: 'function',
                  name: 'p1',
                  declarations: [],
                  imports: [],
                  exports: [],
                },
              },
            }),
          ],
        }),
      );

      expect(result.content).toContain('[L10-20]');
    });
  });
});
