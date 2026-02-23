export interface GraphNode {
  id: string;
  filePath: string;
  symbols: string[];
  type: 'module' | 'class' | 'function' | 'backlog';
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'imports' | 'extends' | 'implements' | 'calls' | 'references';
}

export class DependencyGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly outgoing = new Map<string, GraphEdge[]>();
  private readonly incoming = new Map<string, GraphEdge[]>();

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    const outEdges = this.outgoing.get(edge.source);
    if (outEdges) {
      outEdges.push(edge);
    } else {
      this.outgoing.set(edge.source, [edge]);
    }

    const inEdges = this.incoming.get(edge.target);
    if (inEdges) {
      inEdges.push(edge);
    } else {
      this.incoming.set(edge.target, [edge]);
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /** All edges originating from nodeId. */
  getEdges(nodeId: string): GraphEdge[] {
    return this.outgoing.get(nodeId) ?? [];
  }

  /** All edges pointing to nodeId. */
  getIncomingEdges(nodeId: string): GraphEdge[] {
    return this.incoming.get(nodeId) ?? [];
  }

  /** IDs of nodes that nodeId depends on (targets of outgoing edges). */
  getDependencies(nodeId: string): string[] {
    return this.getEdges(nodeId).map((e) => e.target);
  }

  /** IDs of nodes that depend on nodeId (sources of incoming edges). */
  getDependents(nodeId: string): string[] {
    return this.getIncomingEdges(nodeId).map((e) => e.source);
  }

  /**
   * BFS traversal to find related nodes within maxDepth hops.
   * Follows both outgoing and incoming edges.
   */
  getRelatedNodes(nodeId: string, maxDepth = 2): Set<string> {
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.id)) {
        continue;
      }
      visited.add(current.id);

      if (current.depth < maxDepth) {
        const neighbors = [
          ...this.getDependencies(current.id),
          ...this.getDependents(current.id),
        ];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push({ id: neighbor, depth: current.depth + 1 });
          }
        }
      }
    }

    // Remove the starting node itself — return only related nodes
    visited.delete(nodeId);
    return visited;
  }

  getAllNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  getAllEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const edgeList of this.outgoing.values()) {
      edges.push(...edgeList);
    }
    return edges;
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  edgeCount(): number {
    let count = 0;
    for (const edgeList of this.outgoing.values()) {
      count += edgeList.length;
    }
    return count;
  }

  toJSON(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: this.getAllNodes(),
      edges: this.getAllEdges(),
    };
  }

  static fromJSON(data: { nodes: GraphNode[]; edges: GraphEdge[] }): DependencyGraph {
    const graph = new DependencyGraph();
    for (const node of data.nodes) {
      graph.addNode(node);
    }
    for (const edge of data.edges) {
      graph.addEdge(edge);
    }
    return graph;
  }
}
