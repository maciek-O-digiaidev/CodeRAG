import { ok, err, type Result } from 'neverthrow';
import { DependencyGraph, type GraphNode, type GraphEdge } from './dependency-graph.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DependencyType = 'npm' | 'go' | 'cargo' | 'pip' | 'api';

export interface CrossRepoDependency {
  sourceRepo: string;
  targetRepo: string;
  sourceChunkId: string;
  targetPackage: string;
  dependencyType: DependencyType;
}

export interface PackageManifest {
  repoName: string;
  packageName: string;
  dependencies: string[];
  devDependencies: string[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CrossRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrossRepoError';
  }
}

// ---------------------------------------------------------------------------
// Manifest parsers
// ---------------------------------------------------------------------------

/**
 * Parse a package.json file and extract the package name plus dependencies.
 */
export function parsePackageJson(
  content: string,
  repoName: string,
): Result<PackageManifest, CrossRepoError> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) {
      return err(new CrossRepoError('package.json must be a JSON object'));
    }

    const obj = parsed as Record<string, unknown>;
    const packageName = typeof obj['name'] === 'string' ? obj['name'] : '';

    const extractDeps = (field: unknown): string[] => {
      if (typeof field !== 'object' || field === null) {
        return [];
      }
      return Object.keys(field as Record<string, unknown>);
    };

    return ok({
      repoName,
      packageName,
      dependencies: extractDeps(obj['dependencies']),
      devDependencies: extractDeps(obj['devDependencies']),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new CrossRepoError(`Failed to parse package.json: ${message}`));
  }
}

/**
 * Parse a go.mod file and extract the module name plus required modules.
 */
export function parseGoMod(
  content: string,
  repoName: string,
): Result<PackageManifest, CrossRepoError> {
  try {
    const lines = content.split('\n');

    // Extract module name from "module <name>"
    let packageName = '';
    const moduleRe = /^module\s+(\S+)/;
    for (const line of lines) {
      const match = moduleRe.exec(line.trim());
      if (match) {
        packageName = match[1]!;
        break;
      }
    }

    // Extract require directives
    const dependencies: string[] = [];
    let inRequireBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Single-line require: require github.com/foo/bar v1.0.0
      const singleRequireRe = /^require\s+(\S+)\s+\S+/;
      const singleMatch = singleRequireRe.exec(trimmed);
      if (singleMatch && !trimmed.includes('(')) {
        dependencies.push(singleMatch[1]!);
        continue;
      }

      // Start of require block
      if (trimmed === 'require (' || trimmed.startsWith('require (')) {
        inRequireBlock = true;
        continue;
      }

      // End of require block
      if (inRequireBlock && trimmed === ')') {
        inRequireBlock = false;
        continue;
      }

      // Inside require block: module version
      if (inRequireBlock && trimmed.length > 0 && !trimmed.startsWith('//')) {
        const parts = trimmed.split(/\s+/);
        if (parts[0] && parts[0].length > 0) {
          dependencies.push(parts[0]);
        }
      }
    }

    return ok({
      repoName,
      packageName,
      dependencies,
      devDependencies: [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new CrossRepoError(`Failed to parse go.mod: ${message}`));
  }
}

/**
 * Parse a Cargo.toml file and extract the package name plus dependencies.
 * Uses a lightweight line-based parser (no TOML library dependency).
 */
export function parseCargoToml(
  content: string,
  repoName: string,
): Result<PackageManifest, CrossRepoError> {
  try {
    const lines = content.split('\n');

    let packageName = '';
    let currentSection = '';
    const dependencies: string[] = [];
    const devDependencies: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed.length === 0) {
        continue;
      }

      // Section header: [package], [dependencies], [dev-dependencies], etc.
      const sectionRe = /^\[([^\]]+)\]$/;
      const sectionMatch = sectionRe.exec(trimmed);
      if (sectionMatch) {
        currentSection = sectionMatch[1]!.trim();
        continue;
      }

      // Key = value within a section
      const kvRe = /^(\S+)\s*=\s*(.*)/;
      const kvMatch = kvRe.exec(trimmed);
      if (!kvMatch) {
        continue;
      }

      const key = kvMatch[1]!;
      const value = kvMatch[2]!.trim();

      // Extract package name
      if (currentSection === 'package' && key === 'name') {
        // Remove quotes: "foo" -> foo
        packageName = value.replace(/^["']|["']$/g, '');
        continue;
      }

      // Regular dependencies
      if (currentSection === 'dependencies') {
        dependencies.push(key);
        continue;
      }

      // Dev dependencies
      if (currentSection === 'dev-dependencies') {
        devDependencies.push(key);
        continue;
      }

      // Inline table dependencies: [dependencies.serde]
      if (currentSection.startsWith('dependencies.')) {
        const depName = currentSection.slice('dependencies.'.length);
        if (!dependencies.includes(depName)) {
          dependencies.push(depName);
        }
        continue;
      }

      // Inline table dev-dependencies: [dev-dependencies.tokio]
      if (currentSection.startsWith('dev-dependencies.')) {
        const depName = currentSection.slice('dev-dependencies.'.length);
        if (!devDependencies.includes(depName)) {
          devDependencies.push(depName);
        }
      }
    }

    return ok({
      repoName,
      packageName,
      dependencies,
      devDependencies,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new CrossRepoError(`Failed to parse Cargo.toml: ${message}`));
  }
}

// ---------------------------------------------------------------------------
// CrossRepoResolver
// ---------------------------------------------------------------------------

export class CrossRepoResolver {
  /**
   * Scan manifests for inter-repo dependencies.
   *
   * For each repo, checks whether any of its declared dependencies match a
   * package name published by another repo.  When a match is found, a
   * `CrossRepoDependency` record is emitted.
   */
  resolveCrossRepoDependencies(
    repoGraphs: ReadonlyMap<string, DependencyGraph>,
    repoManifests: ReadonlyMap<string, PackageManifest>,
  ): Result<CrossRepoDependency[], CrossRepoError> {
    try {
      // Build a lookup: packageName -> repoName
      const packageToRepo = new Map<string, string>();
      for (const manifest of repoManifests.values()) {
        if (manifest.packageName.length > 0) {
          packageToRepo.set(manifest.packageName, manifest.repoName);
        }
      }

      const crossDeps: CrossRepoDependency[] = [];

      for (const [repoName, manifest] of repoManifests.entries()) {
        const graph = repoGraphs.get(repoName);

        // Determine a representative chunk ID for this repo
        const sourceChunkId = graph
          ? (graph.getAllNodes()[0]?.id ?? `${repoName}:root`)
          : `${repoName}:root`;

        const allDeps = [...manifest.dependencies, ...manifest.devDependencies];

        for (const dep of allDeps) {
          const targetRepo = packageToRepo.get(dep);
          if (targetRepo !== undefined && targetRepo !== repoName) {
            crossDeps.push({
              sourceRepo: repoName,
              targetRepo,
              sourceChunkId,
              targetPackage: dep,
              dependencyType: detectDependencyType(manifest),
            });
          }
        }
      }

      return ok(crossDeps);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(
        new CrossRepoError(`Failed to resolve cross-repo dependencies: ${message}`),
      );
    }
  }

  /**
   * Merge multiple per-repo dependency graphs into a single unified graph,
   * adding cross-repo edges for the supplied `crossDeps`.
   *
   * Nodes from each repo are prefixed with the repo name to avoid ID
   * collisions (e.g. `my-repo::src/index.ts`).
   */
  mergeGraphs(
    graphs: ReadonlyMap<string, DependencyGraph>,
    crossDeps: readonly CrossRepoDependency[],
  ): Result<DependencyGraph, CrossRepoError> {
    try {
      const merged = new DependencyGraph();

      // Copy all nodes and edges, prefixing IDs with repo name
      for (const [repoName, graph] of graphs.entries()) {
        for (const node of graph.getAllNodes()) {
          const prefixed: GraphNode = {
            ...node,
            id: `${repoName}::${node.id}`,
            filePath: `${repoName}::${node.filePath}`,
          };
          merged.addNode(prefixed);
        }

        for (const edge of graph.getAllEdges()) {
          const prefixed: GraphEdge = {
            source: `${repoName}::${edge.source}`,
            target: `${repoName}::${edge.target}`,
            type: edge.type,
          };
          merged.addEdge(prefixed);
        }
      }

      // Add cross-repo edges
      for (const dep of crossDeps) {
        const sourceGraph = graphs.get(dep.sourceRepo);
        const targetGraph = graphs.get(dep.targetRepo);

        // Use first node of each graph as representative endpoints
        const sourceNodeId = sourceGraph
          ? `${dep.sourceRepo}::${sourceGraph.getAllNodes()[0]?.id ?? 'root'}`
          : `${dep.sourceRepo}::root`;

        const targetNodeId = targetGraph
          ? `${dep.targetRepo}::${targetGraph.getAllNodes()[0]?.id ?? 'root'}`
          : `${dep.targetRepo}::root`;

        // Ensure placeholder nodes exist if graphs are missing
        if (!merged.getNode(sourceNodeId)) {
          merged.addNode({
            id: sourceNodeId,
            filePath: sourceNodeId,
            symbols: [],
            type: 'module',
          });
        }
        if (!merged.getNode(targetNodeId)) {
          merged.addNode({
            id: targetNodeId,
            filePath: targetNodeId,
            symbols: [],
            type: 'module',
          });
        }

        const crossEdge: GraphEdge = {
          source: sourceNodeId,
          target: targetNodeId,
          type: 'imports',
        };
        merged.addEdge(crossEdge);
      }

      return ok(merged);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new CrossRepoError(`Failed to merge graphs: ${message}`));
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Infer the dependency type from the manifest's package name patterns.
 * Falls back to 'npm' when heuristics don't match.
 */
function detectDependencyType(manifest: PackageManifest): DependencyType {
  const name = manifest.packageName;

  // Go modules typically use domain-based naming
  if (name.includes('/') && (name.includes('.') || name.startsWith('go'))) {
    return 'go';
  }

  // Cargo packages don't use slashes, but we can't tell from name alone.
  // If there are no dependencies at all this heuristic won't fire.
  // We default to npm for JS/TS ecosystems.
  return 'npm';
}
