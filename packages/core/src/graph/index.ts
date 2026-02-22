export type { GraphNode, GraphEdge } from './dependency-graph.js';
export { DependencyGraph } from './dependency-graph.js';

export type { ImportInfo } from './import-resolver.js';
export { extractImports } from './import-resolver.js';

export { GraphBuilder, GraphError } from './graph-builder.js';

export type { CrossRepoDependency, PackageManifest, DependencyType } from './cross-repo-resolver.js';
export { CrossRepoResolver, CrossRepoError, parsePackageJson, parseGoMod, parseCargoToml } from './cross-repo-resolver.js';
