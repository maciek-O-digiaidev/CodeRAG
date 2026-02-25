import { describe, it, expect } from 'vitest';
import { ContextExpander } from './context-expander.js';
import { DependencyGraph } from '../graph/dependency-graph.js';
import type { GraphNode, GraphEdge } from '../graph/dependency-graph.js';
import type { SearchResult } from '../types/search.js';

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    filePath: `src/${id}.ts`,
    symbols: [],
    type: 'module',
    ...overrides,
  };
}

function makeEdge(
  source: string,
  target: string,
  type: GraphEdge['type'] = 'imports',
): GraphEdge {
  return { source, target, type };
}

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
    ...overrides,
  };
}

function buildTestGraph(): DependencyGraph {
  const graph = new DependencyGraph();
  // A imports B, B imports C, D imports A
  graph.addNode(makeNode('A'));
  graph.addNode(makeNode('B'));
  graph.addNode(makeNode('C'));
  graph.addNode(makeNode('D'));
  graph.addEdge(makeEdge('A', 'B'));
  graph.addEdge(makeEdge('B', 'C'));
  graph.addEdge(makeEdge('D', 'A'));
  return graph;
}

describe('ContextExpander', () => {
  describe('basic expansion', () => {
    it('should return primary results unchanged', async () => {
      const graph = buildTestGraph();
      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));
      lookupMap.set('C', makeSearchResult('C'));
      lookupMap.set('D', makeSearchResult('D'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const primary = [makeSearchResult('A')];
      const result = await expander.expand(primary);

      expect(result.primaryResults).toEqual(primary);
      expect(result.primaryResults).toHaveLength(1);
    });

    it('should find related chunks via BFS traversal', async () => {
      const graph = buildTestGraph();
      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));
      lookupMap.set('C', makeSearchResult('C'));
      lookupMap.set('D', makeSearchResult('D'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const primary = [makeSearchResult('A')];
      const result = await expander.expand(primary);

      // A -> B (depth 1), B -> C (depth 2), D -> A (depth 1)
      const relatedIds = result.relatedChunks.map((rc) => rc.chunk.chunkId);
      expect(relatedIds).toContain('B');
      expect(relatedIds).toContain('C');
      expect(relatedIds).toContain('D');
    });

    it('should not include primary results in related chunks', async () => {
      const graph = buildTestGraph();
      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('A', makeSearchResult('A'));
      lookupMap.set('B', makeSearchResult('B'));
      lookupMap.set('C', makeSearchResult('C'));
      lookupMap.set('D', makeSearchResult('D'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      // A and B are both primary results
      const primary = [makeSearchResult('A'), makeSearchResult('B')];
      const result = await expander.expand(primary);

      const relatedIds = result.relatedChunks.map((rc) => rc.chunk.chunkId);
      expect(relatedIds).not.toContain('A');
      expect(relatedIds).not.toContain('B');
    });

    it('should deduplicate related chunks', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      graph.addNode(makeNode('B'));
      graph.addNode(makeNode('C'));
      graph.addEdge(makeEdge('A', 'C'));
      graph.addEdge(makeEdge('B', 'C'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('C', makeSearchResult('C'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      // Both A and B connect to C; C should appear only once
      const primary = [makeSearchResult('A'), makeSearchResult('B')];
      const result = await expander.expand(primary);

      const cChunks = result.relatedChunks.filter(
        (rc) => rc.chunk.chunkId === 'C',
      );
      expect(cChunks).toHaveLength(1);
    });

    it('should skip related nodes that have no chunk lookup', async () => {
      const graph = buildTestGraph();
      // Only provide lookup for B, not C or D
      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const primary = [makeSearchResult('A')];
      const result = await expander.expand(primary);

      const relatedIds = result.relatedChunks.map((rc) => rc.chunk.chunkId);
      expect(relatedIds).toContain('B');
      expect(relatedIds).not.toContain('C');
      expect(relatedIds).not.toContain('D');
    });

    it('should work with async chunkLookup', async () => {
      const graph = buildTestGraph();
      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));
      lookupMap.set('D', makeSearchResult('D'));

      const asyncLookup = async (id: string): Promise<SearchResult | undefined> => {
        return lookupMap.get(id);
      };

      const expander = new ContextExpander(graph, asyncLookup);
      const primary = [makeSearchResult('A')];
      const result = await expander.expand(primary);

      const relatedIds = result.relatedChunks.map((rc) => rc.chunk.chunkId);
      expect(relatedIds).toContain('B');
      expect(relatedIds).toContain('D');
    });
  });

  describe('maxRelated limiting', () => {
    it('should respect maxRelated parameter', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      const lookupMap = new Map<string, SearchResult>();

      for (let i = 0; i < 20; i++) {
        const id = `N${i}`;
        graph.addNode(makeNode(id));
        graph.addEdge(makeEdge('A', id));
        lookupMap.set(id, makeSearchResult(id));
      }

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const primary = [makeSearchResult('A')];
      const result = await expander.expand(primary, 5);

      expect(result.relatedChunks.length).toBeLessThanOrEqual(5);
    });

    it('should default maxRelated to 10', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      const lookupMap = new Map<string, SearchResult>();

      for (let i = 0; i < 20; i++) {
        const id = `N${i}`;
        graph.addNode(makeNode(id));
        graph.addEdge(makeEdge('A', id));
        lookupMap.set(id, makeSearchResult(id));
      }

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const primary = [makeSearchResult('A')];
      const result = await expander.expand(primary);

      expect(result.relatedChunks.length).toBeLessThanOrEqual(10);
    });
  });

  describe('relationship classification', () => {
    it('should classify outgoing edge as "imports"', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      graph.addNode(makeNode('B'));
      graph.addEdge(makeEdge('A', 'B', 'imports'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      const bRelated = result.relatedChunks.find(
        (rc) => rc.chunk.chunkId === 'B',
      );
      expect(bRelated?.relationship).toBe('imports');
    });

    it('should classify incoming edge as "imported_by"', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      graph.addNode(makeNode('B'));
      graph.addEdge(makeEdge('B', 'A', 'imports'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      const bRelated = result.relatedChunks.find(
        (rc) => rc.chunk.chunkId === 'B',
      );
      expect(bRelated?.relationship).toBe('imported_by');
    });

    it('should classify test files as "test_for"', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A', { filePath: 'src/parser.ts' }));
      graph.addNode(makeNode('B', { filePath: 'src/parser.test.ts' }));
      graph.addEdge(makeEdge('B', 'A'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      const bRelated = result.relatedChunks.find(
        (rc) => rc.chunk.chunkId === 'B',
      );
      expect(bRelated?.relationship).toBe('test_for');
    });

    it('should classify spec files as "test_for"', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A', { filePath: 'src/parser.ts' }));
      graph.addNode(makeNode('B', { filePath: 'src/parser.spec.ts' }));
      graph.addEdge(makeEdge('B', 'A'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      const bRelated = result.relatedChunks.find(
        (rc) => rc.chunk.chunkId === 'B',
      );
      expect(bRelated?.relationship).toBe('test_for');
    });

    it('should classify implements edge as "interface_of"', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      graph.addNode(makeNode('B'));
      graph.addEdge(makeEdge('A', 'B', 'implements'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      const bRelated = result.relatedChunks.find(
        (rc) => rc.chunk.chunkId === 'B',
      );
      expect(bRelated?.relationship).toBe('interface_of');
    });

    it('should classify same-directory nodes as "sibling"', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A', { filePath: 'src/graph/foo.ts' }));
      graph.addNode(makeNode('B', { filePath: 'src/graph/bar.ts' }));
      // Connected but no direct edge between them — through a shared node
      graph.addNode(makeNode('C', { filePath: 'src/other/baz.ts' }));
      graph.addEdge(makeEdge('A', 'C'));
      graph.addEdge(makeEdge('B', 'C'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      const bRelated = result.relatedChunks.find(
        (rc) => rc.chunk.chunkId === 'B',
      );
      // B is reachable via A -> C <- B (depth 2), and they share src/graph/
      expect(bRelated?.relationship).toBe('sibling');
    });
  });

  describe('distance computation', () => {
    it('should assign distance 1 to direct neighbors', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      graph.addNode(makeNode('B'));
      graph.addEdge(makeEdge('A', 'B'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      const bRelated = result.relatedChunks.find(
        (rc) => rc.chunk.chunkId === 'B',
      );
      expect(bRelated?.distance).toBe(1);
    });

    it('should assign distance 2 to second-hop neighbors', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      graph.addNode(makeNode('B'));
      graph.addNode(makeNode('C'));
      graph.addEdge(makeEdge('A', 'B'));
      graph.addEdge(makeEdge('B', 'C'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('C', makeSearchResult('C'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      const cRelated = result.relatedChunks.find(
        (rc) => rc.chunk.chunkId === 'C',
      );
      expect(cRelated?.distance).toBe(2);
    });

    it('should sort related chunks by distance ascending', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      graph.addNode(makeNode('B'));
      graph.addNode(makeNode('C'));
      graph.addEdge(makeEdge('A', 'B'));
      graph.addEdge(makeEdge('B', 'C'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));
      lookupMap.set('C', makeSearchResult('C'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      expect(result.relatedChunks.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < result.relatedChunks.length; i++) {
        const prev = result.relatedChunks[i - 1]!;
        const curr = result.relatedChunks[i]!;
        expect(prev.distance).toBeLessThanOrEqual(curr.distance);
      }
    });
  });

  describe('graph excerpt', () => {
    it('should include nodes from primary and related results', async () => {
      const graph = buildTestGraph();
      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));
      lookupMap.set('C', makeSearchResult('C'));
      lookupMap.set('D', makeSearchResult('D'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      expect(result.graphExcerpt.nodes).toContain('A');
      expect(result.graphExcerpt.nodes).toContain('B');
    });

    it('should include edges between relevant nodes', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      graph.addNode(makeNode('B'));
      graph.addEdge(makeEdge('A', 'B'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      const result = await expander.expand([makeSearchResult('A')]);

      expect(result.graphExcerpt.edges).toContainEqual({
        from: 'A',
        to: 'B',
        type: 'imports',
      });
    });

    it('should deduplicate graph edges', async () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('A'));
      graph.addNode(makeNode('B'));
      graph.addEdge(makeEdge('A', 'B'));

      const lookupMap = new Map<string, SearchResult>();
      lookupMap.set('B', makeSearchResult('B'));

      const expander = new ContextExpander(graph, (id) => lookupMap.get(id));
      // Pass A twice as primary to trigger duplicate edge collection
      const result = await expander.expand([
        makeSearchResult('A'),
        makeSearchResult('A', { chunkId: 'A' }),
      ]);

      const abEdges = result.graphExcerpt.edges.filter(
        (e) => e.from === 'A' && e.to === 'B',
      );
      expect(abEdges).toHaveLength(1);
    });
  });

  describe('empty inputs', () => {
    it('should handle empty results array', async () => {
      const graph = new DependencyGraph();
      const expander = new ContextExpander(graph, () => undefined);
      const result = await expander.expand([]);

      expect(result.primaryResults).toHaveLength(0);
      expect(result.relatedChunks).toHaveLength(0);
      expect(result.graphExcerpt.nodes).toHaveLength(0);
      expect(result.graphExcerpt.edges).toHaveLength(0);
    });

    it('should handle results with no graph nodes', async () => {
      const graph = new DependencyGraph();
      const expander = new ContextExpander(graph, () => undefined);
      const result = await expander.expand([makeSearchResult('X')]);

      expect(result.primaryResults).toHaveLength(1);
      expect(result.relatedChunks).toHaveLength(0);
    });
  });
});
