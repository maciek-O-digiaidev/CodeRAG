import { ok, err, type Result } from 'neverthrow';
import { dirname, resolve, extname } from 'node:path';
import type { ParsedFile } from '../types/provider.js';
import { DependencyGraph, type GraphNode, type GraphEdge } from './dependency-graph.js';
import { extractImports } from './import-resolver.js';

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

/** Maps a file path to a stable node ID. */
function filePathToNodeId(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Resolve a relative import source to a file path, trying common extensions.
 * Returns undefined if the import cannot be resolved to a known file.
 */
function resolveImportPath(
  importSource: string,
  importerFilePath: string,
  rootDir: string,
  knownPaths: Set<string>,
): string | undefined {
  // Skip bare specifiers (npm packages, built-ins, etc.)
  if (!importSource.startsWith('.') && !importSource.startsWith('/')) {
    return undefined;
  }

  const importerDir = dirname(resolve(rootDir, importerFilePath));
  const basePath = resolve(importerDir, importSource);
  const relativePath = basePath.startsWith(resolve(rootDir))
    ? basePath.slice(resolve(rootDir).length + 1).replace(/\\/g, '/')
    : undefined;

  if (relativePath === undefined) {
    return undefined;
  }

  // Direct match (including extensions like .js, .ts already in the source)
  if (knownPaths.has(relativePath)) {
    return relativePath;
  }

  // Try stripping .js and adding common extensions (ESM convention: import with .js extension)
  const withoutExt = relativePath.replace(/\.js$/, '');
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go'];
  for (const ext of extensions) {
    const candidate = withoutExt + ext;
    if (knownPaths.has(candidate)) {
      return candidate;
    }
  }

  // Try /index resolution
  for (const ext of extensions) {
    const candidate = withoutExt + '/index' + ext;
    if (knownPaths.has(candidate)) {
      return candidate;
    }
  }

  // Try the original relative path with extensions (no .js stripping)
  if (extname(relativePath) === '') {
    for (const ext of extensions) {
      const candidate = relativePath + ext;
      if (knownPaths.has(candidate)) {
        return candidate;
      }
    }
    for (const ext of extensions) {
      const candidate = relativePath + '/index' + ext;
      if (knownPaths.has(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export class GraphBuilder {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  buildFromFiles(files: ParsedFile[]): Result<DependencyGraph, GraphError> {
    try {
      const graph = new DependencyGraph();
      const knownPaths = new Set(files.map((f) => f.filePath));

      // Create nodes for each file
      for (const file of files) {
        const nodeId = filePathToNodeId(file.filePath);
        const node: GraphNode = {
          id: nodeId,
          filePath: file.filePath,
          symbols: file.declarations,
          type: 'module',
        };
        graph.addNode(node);
      }

      // Create edges based on imports
      for (const file of files) {
        const imports = extractImports(file.content, file.language);
        const sourceId = filePathToNodeId(file.filePath);

        for (const imp of imports) {
          const resolvedPath = resolveImportPath(
            imp.source,
            file.filePath,
            this.rootDir,
            knownPaths,
          );

          if (resolvedPath !== undefined) {
            const targetId = filePathToNodeId(resolvedPath);
            const edge: GraphEdge = {
              source: sourceId,
              target: targetId,
              type: 'imports',
            };
            graph.addEdge(edge);
          }
        }
      }

      return ok(graph);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new GraphError(`Failed to build dependency graph: ${message}`));
    }
  }
}
