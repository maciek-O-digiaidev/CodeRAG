import { describe, it, expect } from 'vitest';
import { DependencyGraph } from './dependency-graph.js';
import type { GraphNode, GraphEdge } from './dependency-graph.js';

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

describe('DependencyGraph', () => {
  describe('empty graph', () => {
    it('should have zero nodes and edges', () => {
      const graph = new DependencyGraph();
      expect(graph.nodeCount()).toBe(0);
      expect(graph.edgeCount()).toBe(0);
      expect(graph.getAllNodes()).toEqual([]);
      expect(graph.getAllEdges()).toEqual([]);
    });

    it('should return undefined for unknown node', () => {
      const graph = new DependencyGraph();
      expect(graph.getNode('nonexistent')).toBeUndefined();
    });

    it('should return empty arrays for unknown node edges', () => {
      const graph = new DependencyGraph();
      expect(graph.getEdges('nonexistent')).toEqual([]);
      expect(graph.getIncomingEdges('nonexistent')).toEqual([]);
      expect(graph.getDependencies('nonexistent')).toEqual([]);
      expect(graph.getDependents('nonexistent')).toEqual([]);
    });

    it('should return empty set for getRelatedNodes on unknown node', () => {
      const graph = new DependencyGraph();
      expect(graph.getRelatedNodes('nonexistent')).toEqual(new Set());
    });
  });

  describe('addNode / getNode', () => {
    it('should add and retrieve a node', () => {
      const graph = new DependencyGraph();
      const node = makeNode('a', { symbols: ['foo', 'bar'], type: 'class' });
      graph.addNode(node);

      expect(graph.getNode('a')).toEqual(node);
      expect(graph.nodeCount()).toBe(1);
    });

    it('should overwrite a node with the same id', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a', { symbols: ['old'] }));
      graph.addNode(makeNode('a', { symbols: ['new'] }));

      expect(graph.getNode('a')?.symbols).toEqual(['new']);
      expect(graph.nodeCount()).toBe(1);
    });

    it('should store multiple nodes', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));

      expect(graph.nodeCount()).toBe(3);
      expect(graph.getAllNodes().map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('addEdge / getEdges / getIncomingEdges', () => {
    it('should add and retrieve outgoing edges', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      const edge = makeEdge('a', 'b');
      graph.addEdge(edge);

      expect(graph.getEdges('a')).toEqual([edge]);
      expect(graph.getEdges('b')).toEqual([]);
      expect(graph.edgeCount()).toBe(1);
    });

    it('should add and retrieve incoming edges', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      const edge = makeEdge('a', 'b');
      graph.addEdge(edge);

      expect(graph.getIncomingEdges('b')).toEqual([edge]);
      expect(graph.getIncomingEdges('a')).toEqual([]);
    });

    it('should handle multiple edges from same node', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));
      graph.addEdge(makeEdge('a', 'b'));
      graph.addEdge(makeEdge('a', 'c'));

      expect(graph.getEdges('a')).toHaveLength(2);
      expect(graph.edgeCount()).toBe(2);
    });

    it('should handle multiple edges to same node', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));
      graph.addEdge(makeEdge('a', 'c'));
      graph.addEdge(makeEdge('b', 'c'));

      expect(graph.getIncomingEdges('c')).toHaveLength(2);
    });

    it('should support different edge types', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addEdge(makeEdge('a', 'b', 'extends'));

      expect(graph.getEdges('a')[0]?.type).toBe('extends');
    });
  });

  describe('getDependencies / getDependents', () => {
    it('should return dependency IDs', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));
      graph.addEdge(makeEdge('a', 'b'));
      graph.addEdge(makeEdge('a', 'c'));

      expect(graph.getDependencies('a').sort()).toEqual(['b', 'c']);
    });

    it('should return dependent IDs', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));
      graph.addEdge(makeEdge('b', 'a'));
      graph.addEdge(makeEdge('c', 'a'));

      expect(graph.getDependents('a').sort()).toEqual(['b', 'c']);
    });

    it('should return empty arrays for nodes without edges', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));

      expect(graph.getDependencies('a')).toEqual([]);
      expect(graph.getDependents('a')).toEqual([]);
    });
  });

  describe('getRelatedNodes', () => {
    it('should find directly connected nodes at depth 1', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));
      graph.addEdge(makeEdge('a', 'b'));
      graph.addEdge(makeEdge('b', 'c'));

      const related = graph.getRelatedNodes('a', 1);
      expect(related).toEqual(new Set(['b']));
    });

    it('should find nodes at depth 2 (default)', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));
      graph.addNode(makeNode('d'));
      graph.addEdge(makeEdge('a', 'b'));
      graph.addEdge(makeEdge('b', 'c'));
      graph.addEdge(makeEdge('c', 'd'));

      const related = graph.getRelatedNodes('a');
      expect(related).toEqual(new Set(['b', 'c']));
    });

    it('should follow both incoming and outgoing edges', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));
      graph.addEdge(makeEdge('a', 'b'));
      graph.addEdge(makeEdge('c', 'a'));

      const related = graph.getRelatedNodes('a', 1);
      expect(related).toEqual(new Set(['b', 'c']));
    });

    it('should not include the starting node', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addEdge(makeEdge('a', 'b'));

      const related = graph.getRelatedNodes('a', 1);
      expect(related.has('a')).toBe(false);
    });

    it('should handle cycles without infinite loops', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));
      graph.addEdge(makeEdge('a', 'b'));
      graph.addEdge(makeEdge('b', 'c'));
      graph.addEdge(makeEdge('c', 'a'));

      const related = graph.getRelatedNodes('a', 10);
      expect(related).toEqual(new Set(['b', 'c']));
    });

    it('should return empty set for isolated node', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));

      expect(graph.getRelatedNodes('a')).toEqual(new Set());
    });

    it('should respect depth 0 and return no nodes', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addEdge(makeEdge('a', 'b'));

      expect(graph.getRelatedNodes('a', 0)).toEqual(new Set());
    });
  });

  describe('getAllNodes / getAllEdges', () => {
    it('should return all nodes', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));

      const nodes = graph.getAllNodes();
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    });

    it('should return all edges', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      graph.addNode(makeNode('c'));
      graph.addEdge(makeEdge('a', 'b'));
      graph.addEdge(makeEdge('b', 'c'));

      const edges = graph.getAllEdges();
      expect(edges).toHaveLength(2);
    });
  });

  describe('nodeCount / edgeCount', () => {
    it('should reflect correct counts after mutations', () => {
      const graph = new DependencyGraph();
      expect(graph.nodeCount()).toBe(0);
      expect(graph.edgeCount()).toBe(0);

      graph.addNode(makeNode('a'));
      graph.addNode(makeNode('b'));
      expect(graph.nodeCount()).toBe(2);

      graph.addEdge(makeEdge('a', 'b'));
      expect(graph.edgeCount()).toBe(1);

      graph.addEdge(makeEdge('b', 'a'));
      expect(graph.edgeCount()).toBe(2);
    });
  });

  describe('toJSON / fromJSON roundtrip', () => {
    it('should serialize and deserialize an empty graph', () => {
      const graph = new DependencyGraph();
      const json = graph.toJSON();
      const restored = DependencyGraph.fromJSON(json);

      expect(restored.nodeCount()).toBe(0);
      expect(restored.edgeCount()).toBe(0);
    });

    it('should serialize and deserialize a populated graph', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('a', { symbols: ['Foo'], type: 'class' }));
      graph.addNode(makeNode('b', { symbols: ['bar'], type: 'function' }));
      graph.addEdge(makeEdge('a', 'b', 'imports'));
      graph.addEdge(makeEdge('a', 'b', 'calls'));

      const json = graph.toJSON();
      const restored = DependencyGraph.fromJSON(json);

      expect(restored.nodeCount()).toBe(2);
      expect(restored.edgeCount()).toBe(2);
      expect(restored.getNode('a')?.symbols).toEqual(['Foo']);
      expect(restored.getNode('a')?.type).toBe('class');
      expect(restored.getNode('b')?.type).toBe('function');
      expect(restored.getEdges('a')).toHaveLength(2);
      expect(restored.getIncomingEdges('b')).toHaveLength(2);
      expect(restored.getDependencies('a')).toEqual(['b', 'b']);
    });

    it('should produce valid JSON that can be stringified and parsed', () => {
      const graph = new DependencyGraph();
      graph.addNode(makeNode('x'));
      graph.addNode(makeNode('y'));
      graph.addEdge(makeEdge('x', 'y'));

      const jsonStr = JSON.stringify(graph.toJSON());
      const parsed = JSON.parse(jsonStr) as { nodes: GraphNode[]; edges: GraphEdge[] };
      const restored = DependencyGraph.fromJSON(parsed);

      expect(restored.nodeCount()).toBe(2);
      expect(restored.edgeCount()).toBe(1);
      expect(restored.getNode('x')).toBeDefined();
      expect(restored.getNode('y')).toBeDefined();
    });
  });
});
