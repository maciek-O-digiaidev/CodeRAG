import type { SearchResult } from '../types/index.js';
import type { GraphNode, GraphEdge } from '../graph/index.js';

/** Read-only graph interface for dependency inversion. */
export interface ReadonlyGraph {
  getNode(id: string): GraphNode | undefined;
  getEdges(nodeId: string): GraphEdge[];
  getIncomingEdges(nodeId: string): GraphEdge[];
}

export type RelationshipType =
  | 'imports'
  | 'imported_by'
  | 'test_for'
  | 'interface_of'
  | 'sibling'
  | 'backlog';

export interface RelatedChunk {
  chunk: SearchResult;
  relationship: RelationshipType;
  distance: number;
}

export interface GraphExcerpt {
  nodes: string[];
  edges: Array<{ from: string; to: string; type: string }>;
}

export interface ExpandedContext {
  primaryResults: SearchResult[];
  relatedChunks: RelatedChunk[];
  graphExcerpt: GraphExcerpt;
}

const DEFAULT_MAX_RELATED = 10;

/** Callback to resolve a chunk by its ID. May be sync or async (await handles both). */
export type ChunkLookupFn = (chunkId: string) => SearchResult | undefined | Promise<SearchResult | undefined>;

export class ContextExpander {
  private readonly graph: ReadonlyGraph;
  private readonly chunkLookup: ChunkLookupFn;

  constructor(
    dependencyGraph: ReadonlyGraph,
    chunkLookup: ChunkLookupFn,
  ) {
    this.graph = dependencyGraph;
    this.chunkLookup = chunkLookup;
  }

  /**
   * Expand search results with graph-based context.
   * For each result, walks the dependency graph to find related chunks
   * and classifies their relationships.
   */
  async expand(
    results: SearchResult[],
    maxRelated: number = DEFAULT_MAX_RELATED,
  ): Promise<ExpandedContext> {
    const relatedMap = new Map<string, RelatedChunk>();
    const graphNodes = new Set<string>();
    const graphEdges: Array<{ from: string; to: string; type: string }> = [];
    const primaryIds = new Set(results.map((r) => r.chunkId));

    for (const result of results) {
      const nodeId = result.chunkId;
      graphNodes.add(nodeId);

      // Single BFS pass: get related nodes and their distances in one traversal
      const distanceMap = this.computeDistances(nodeId);
      const relatedNodeIds = new Set(distanceMap.keys());

      for (const relatedId of relatedNodeIds) {
        graphNodes.add(relatedId);

        // Don't add primary results as related chunks
        if (primaryIds.has(relatedId)) continue;

        // Don't add duplicates — keep the one with shortest distance
        if (relatedMap.has(relatedId)) continue;

        const relatedResult = await this.chunkLookup(relatedId);
        if (!relatedResult) continue;

        const relationship = this.classifyRelationship(nodeId, relatedId);
        const distance = distanceMap.get(relatedId) ?? 3;

        relatedMap.set(relatedId, {
          chunk: relatedResult,
          relationship,
          distance,
        });
      }

      // Collect edges for graph excerpt
      this.collectEdges(nodeId, relatedNodeIds, graphEdges);
    }

    // Sort related chunks by distance (closest first), then limit
    const relatedChunks = [...relatedMap.values()]
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxRelated);

    return {
      primaryResults: results,
      relatedChunks,
      graphExcerpt: {
        nodes: [...graphNodes],
        edges: deduplicateEdges(graphEdges),
      },
    };
  }

  /**
   * Classify the relationship between two nodes based on graph edges and naming conventions.
   */
  private classifyRelationship(
    sourceId: string,
    relatedId: string,
  ): RelationshipType {
    const sourceNode = this.graph.getNode(sourceId);
    const relatedNode = this.graph.getNode(relatedId);

    // Check if either node is a backlog item
    if (sourceNode?.type === 'backlog' || relatedNode?.type === 'backlog') {
      return 'backlog';
    }

    // Check if the related file is a test file for the source
    if (relatedNode?.filePath && isTestFileFor(relatedNode.filePath, sourceNode?.filePath)) {
      return 'test_for';
    }
    if (sourceNode?.filePath && isTestFileFor(sourceNode.filePath, relatedNode?.filePath)) {
      return 'test_for';
    }

    // Check direct edges for imports / imported_by
    const outgoingEdges = this.graph.getEdges(sourceId);
    for (const edge of outgoingEdges) {
      if (edge.target === relatedId) {
        if (edge.type === 'implements') {
          return 'interface_of';
        }
        return 'imports';
      }
    }

    const incomingEdges = this.graph.getIncomingEdges(sourceId);
    for (const edge of incomingEdges) {
      if (edge.source === relatedId) {
        if (edge.type === 'implements') {
          return 'interface_of';
        }
        return 'imported_by';
      }
    }

    // Check if they share the same directory (siblings)
    if (
      sourceNode?.filePath &&
      relatedNode?.filePath &&
      sameDirectory(sourceNode.filePath, relatedNode.filePath)
    ) {
      return 'sibling';
    }

    // Default: treat as imports if connected at all
    return 'imports';
  }

  /**
   * Single-pass BFS from source, returning a Map of nodeId → distance
   * for all nodes reachable within 2 hops (excludes the source itself).
   */
  private computeDistances(sourceId: string): Map<string, number> {
    const distances = new Map<string, number>();
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [
      { id: sourceId, depth: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.id)) continue;
      visited.add(current.id);

      if (current.id !== sourceId) {
        distances.set(current.id, current.depth);
      }

      if (current.depth < 2) {
        const neighbors = [
          ...this.graph.getEdges(current.id).map((e) => e.target),
          ...this.graph.getIncomingEdges(current.id).map((e) => e.source),
        ];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push({ id: neighbor, depth: current.depth + 1 });
          }
        }
      }
    }

    return distances;
  }

  /**
   * Collect graph edges from a node and its related nodes for the excerpt.
   */
  private collectEdges(
    nodeId: string,
    relatedNodeIds: Set<string>,
    graphEdges: Array<{ from: string; to: string; type: string }>,
  ): void {
    const relevantIds = new Set([nodeId, ...relatedNodeIds]);

    // Add outgoing edges from the node
    for (const edge of this.graph.getEdges(nodeId)) {
      if (relevantIds.has(edge.target)) {
        graphEdges.push({
          from: edge.source,
          to: edge.target,
          type: edge.type,
        });
      }
    }

    // Add incoming edges to the node
    for (const edge of this.graph.getIncomingEdges(nodeId)) {
      if (relevantIds.has(edge.source)) {
        graphEdges.push({
          from: edge.source,
          to: edge.target,
          type: edge.type,
        });
      }
    }

    // Add edges between related nodes
    for (const relatedId of relatedNodeIds) {
      for (const edge of this.graph.getEdges(relatedId)) {
        if (relevantIds.has(edge.target)) {
          graphEdges.push({
            from: edge.source,
            to: edge.target,
            type: edge.type,
          });
        }
      }
    }
  }
}

/** Check if `testPath` is a test file for `sourcePath`. */
function isTestFileFor(
  testPath: string,
  sourcePath: string | undefined,
): boolean {
  if (!sourcePath) return false;

  // Check patterns: foo.test.ts, foo.spec.ts, __tests__/foo.ts
  const testPatterns = ['.test.', '.spec.', '/__tests__/'];
  const isTestFile = testPatterns.some((p) => testPath.includes(p));
  if (!isTestFile) return false;

  // Check if the base file names match
  const sourceBase = getBaseName(sourcePath);
  const testBase = getBaseName(testPath)
    .replace(/\.test$/, '')
    .replace(/\.spec$/, '');

  return sourceBase === testBase;
}

/** Extract base file name without extension. */
function getBaseName(filePath: string): string {
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1] ?? '';
  // Remove all extensions
  const dotIndex = fileName.indexOf('.');
  return dotIndex === -1 ? fileName : fileName.substring(0, dotIndex);
}

/** Check if two file paths share the same directory. */
function sameDirectory(pathA: string, pathB: string): boolean {
  const dirA = pathA.substring(0, pathA.lastIndexOf('/'));
  const dirB = pathB.substring(0, pathB.lastIndexOf('/'));
  return dirA === dirB && dirA.length > 0;
}

/** Deduplicate graph edges by from+to+type. */
function deduplicateEdges(
  edges: Array<{ from: string; to: string; type: string }>,
): Array<{ from: string; to: string; type: string }> {
  const seen = new Set<string>();
  const result: Array<{ from: string; to: string; type: string }> = [];

  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }

  return result;
}
