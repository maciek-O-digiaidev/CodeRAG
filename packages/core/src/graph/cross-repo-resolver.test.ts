import { describe, it, expect } from 'vitest';
import { DependencyGraph } from './dependency-graph.js';
import {
  CrossRepoResolver,
  parsePackageJson,
  parseGoMod,
  parseCargoToml,
  type PackageManifest,
} from './cross-repo-resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(nodes: Array<{ id: string; filePath: string; symbols?: string[] }>): DependencyGraph {
  const graph = new DependencyGraph();
  for (const n of nodes) {
    graph.addNode({
      id: n.id,
      filePath: n.filePath,
      symbols: n.symbols ?? [],
      type: 'module',
    });
  }
  return graph;
}

// ---------------------------------------------------------------------------
// parsePackageJson
// ---------------------------------------------------------------------------

describe('parsePackageJson', () => {
  it('should extract package name and dependencies', () => {
    const content = JSON.stringify({
      name: '@myorg/shared-utils',
      version: '1.0.0',
      dependencies: {
        lodash: '^4.17.21',
        neverthrow: '^6.0.0',
      },
      devDependencies: {
        vitest: '^1.0.0',
      },
    });

    const result = parsePackageJson(content, 'shared-utils');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.repoName).toBe('shared-utils');
      expect(result.value.packageName).toBe('@myorg/shared-utils');
      expect(result.value.dependencies).toEqual(['lodash', 'neverthrow']);
      expect(result.value.devDependencies).toEqual(['vitest']);
    }
  });

  it('should handle missing dependencies field', () => {
    const content = JSON.stringify({ name: 'bare-package' });

    const result = parsePackageJson(content, 'bare');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.packageName).toBe('bare-package');
      expect(result.value.dependencies).toEqual([]);
      expect(result.value.devDependencies).toEqual([]);
    }
  });

  it('should handle missing name field', () => {
    const content = JSON.stringify({
      dependencies: { foo: '1.0.0' },
    });

    const result = parsePackageJson(content, 'unnamed');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.packageName).toBe('');
      expect(result.value.dependencies).toEqual(['foo']);
    }
  });

  it('should return error for invalid JSON', () => {
    const result = parsePackageJson('not valid json', 'bad');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.name).toBe('CrossRepoError');
      expect(result.error.message).toContain('Failed to parse package.json');
    }
  });

  it('should return error for non-object JSON', () => {
    const result = parsePackageJson('"just a string"', 'bad');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('must be a JSON object');
    }
  });
});

// ---------------------------------------------------------------------------
// parseGoMod
// ---------------------------------------------------------------------------

describe('parseGoMod', () => {
  it('should extract module name and require directives', () => {
    const content = [
      'module github.com/myorg/my-service',
      '',
      'go 1.21',
      '',
      'require (',
      '\tgithub.com/gin-gonic/gin v1.9.1',
      '\tgithub.com/myorg/shared-lib v0.2.0',
      ')',
    ].join('\n');

    const result = parseGoMod(content, 'my-service');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.repoName).toBe('my-service');
      expect(result.value.packageName).toBe('github.com/myorg/my-service');
      expect(result.value.dependencies).toEqual([
        'github.com/gin-gonic/gin',
        'github.com/myorg/shared-lib',
      ]);
      expect(result.value.devDependencies).toEqual([]);
    }
  });

  it('should handle single-line require', () => {
    const content = [
      'module github.com/foo/bar',
      '',
      'require github.com/baz/qux v1.0.0',
    ].join('\n');

    const result = parseGoMod(content, 'bar');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dependencies).toEqual(['github.com/baz/qux']);
    }
  });

  it('should skip comments inside require block', () => {
    const content = [
      'module github.com/foo/bar',
      '',
      'require (',
      '\t// indirect dependency',
      '\tgithub.com/real/dep v1.0.0',
      ')',
    ].join('\n');

    const result = parseGoMod(content, 'bar');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dependencies).toEqual(['github.com/real/dep']);
    }
  });

  it('should handle empty go.mod', () => {
    const result = parseGoMod('module github.com/empty/mod', 'empty');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.packageName).toBe('github.com/empty/mod');
      expect(result.value.dependencies).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// parseCargoToml
// ---------------------------------------------------------------------------

describe('parseCargoToml', () => {
  it('should extract package name and dependencies', () => {
    const content = [
      '[package]',
      'name = "my-crate"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'serde = "1.0"',
      'tokio = { version = "1", features = ["full"] }',
      '',
      '[dev-dependencies]',
      'criterion = "0.5"',
    ].join('\n');

    const result = parseCargoToml(content, 'my-crate-repo');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.repoName).toBe('my-crate-repo');
      expect(result.value.packageName).toBe('my-crate');
      expect(result.value.dependencies).toEqual(['serde', 'tokio']);
      expect(result.value.devDependencies).toEqual(['criterion']);
    }
  });

  it('should handle inline table dependencies section', () => {
    const content = [
      '[package]',
      'name = "foo"',
      '',
      '[dependencies.serde]',
      'version = "1.0"',
      'features = ["derive"]',
    ].join('\n');

    const result = parseCargoToml(content, 'foo-repo');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dependencies).toContain('serde');
    }
  });

  it('should handle Cargo.toml with no dependencies', () => {
    const content = [
      '[package]',
      'name = "minimal"',
      'version = "0.1.0"',
    ].join('\n');

    const result = parseCargoToml(content, 'minimal');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.packageName).toBe('minimal');
      expect(result.value.dependencies).toEqual([]);
      expect(result.value.devDependencies).toEqual([]);
    }
  });

  it('should skip comments', () => {
    const content = [
      '[package]',
      '# This is a comment',
      'name = "commented"',
      '',
      '[dependencies]',
      '# serde is great',
      'serde = "1.0"',
    ].join('\n');

    const result = parseCargoToml(content, 'commented');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.packageName).toBe('commented');
      expect(result.value.dependencies).toEqual(['serde']);
    }
  });
});

// ---------------------------------------------------------------------------
// CrossRepoResolver.resolveCrossRepoDependencies
// ---------------------------------------------------------------------------

describe('CrossRepoResolver', () => {
  describe('resolveCrossRepoDependencies', () => {
    it('should find inter-repo dependencies when repo A depends on repo B package', () => {
      const resolver = new CrossRepoResolver();

      const graphA = makeGraph([{ id: 'src/index.ts', filePath: 'src/index.ts' }]);
      const graphB = makeGraph([{ id: 'src/lib.ts', filePath: 'src/lib.ts' }]);

      const repoGraphs = new Map<string, DependencyGraph>([
        ['repo-a', graphA],
        ['repo-b', graphB],
      ]);

      const manifestA: PackageManifest = {
        repoName: 'repo-a',
        packageName: '@myorg/frontend',
        dependencies: ['@myorg/shared-lib', 'lodash'],
        devDependencies: [],
      };

      const manifestB: PackageManifest = {
        repoName: 'repo-b',
        packageName: '@myorg/shared-lib',
        dependencies: [],
        devDependencies: [],
      };

      const repoManifests = new Map<string, PackageManifest>([
        ['repo-a', manifestA],
        ['repo-b', manifestB],
      ]);

      const result = resolver.resolveCrossRepoDependencies(repoGraphs, repoManifests);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toEqual({
          sourceRepo: 'repo-a',
          targetRepo: 'repo-b',
          sourceChunkId: 'src/index.ts',
          targetPackage: '@myorg/shared-lib',
          dependencyType: 'npm',
        });
      }
    });

    it('should return empty array for independent repos (no cross-repo deps)', () => {
      const resolver = new CrossRepoResolver();

      const graphA = makeGraph([{ id: 'src/a.ts', filePath: 'src/a.ts' }]);
      const graphB = makeGraph([{ id: 'src/b.ts', filePath: 'src/b.ts' }]);

      const repoGraphs = new Map<string, DependencyGraph>([
        ['repo-a', graphA],
        ['repo-b', graphB],
      ]);

      const manifestA: PackageManifest = {
        repoName: 'repo-a',
        packageName: '@org/alpha',
        dependencies: ['express'],
        devDependencies: [],
      };

      const manifestB: PackageManifest = {
        repoName: 'repo-b',
        packageName: '@org/beta',
        dependencies: ['fastify'],
        devDependencies: [],
      };

      const repoManifests = new Map<string, PackageManifest>([
        ['repo-a', manifestA],
        ['repo-b', manifestB],
      ]);

      const result = resolver.resolveCrossRepoDependencies(repoGraphs, repoManifests);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should find multiple cross-repo dependencies', () => {
      const resolver = new CrossRepoResolver();

      const graphA = makeGraph([{ id: 'src/app.ts', filePath: 'src/app.ts' }]);
      const graphB = makeGraph([{ id: 'src/utils.ts', filePath: 'src/utils.ts' }]);
      const graphC = makeGraph([{ id: 'src/models.ts', filePath: 'src/models.ts' }]);

      const repoGraphs = new Map<string, DependencyGraph>([
        ['frontend', graphA],
        ['utils', graphB],
        ['models', graphC],
      ]);

      const manifestA: PackageManifest = {
        repoName: 'frontend',
        packageName: '@org/frontend',
        dependencies: ['@org/utils', '@org/models'],
        devDependencies: [],
      };

      const manifestB: PackageManifest = {
        repoName: 'utils',
        packageName: '@org/utils',
        dependencies: ['@org/models'],
        devDependencies: [],
      };

      const manifestC: PackageManifest = {
        repoName: 'models',
        packageName: '@org/models',
        dependencies: [],
        devDependencies: [],
      };

      const repoManifests = new Map<string, PackageManifest>([
        ['frontend', manifestA],
        ['utils', manifestB],
        ['models', manifestC],
      ]);

      const result = resolver.resolveCrossRepoDependencies(repoGraphs, repoManifests);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);

        // frontend -> utils
        expect(result.value).toContainEqual(
          expect.objectContaining({
            sourceRepo: 'frontend',
            targetRepo: 'utils',
            targetPackage: '@org/utils',
          }),
        );

        // frontend -> models
        expect(result.value).toContainEqual(
          expect.objectContaining({
            sourceRepo: 'frontend',
            targetRepo: 'models',
            targetPackage: '@org/models',
          }),
        );

        // utils -> models
        expect(result.value).toContainEqual(
          expect.objectContaining({
            sourceRepo: 'utils',
            targetRepo: 'models',
            targetPackage: '@org/models',
          }),
        );
      }
    });

    it('should not create self-referencing dependencies', () => {
      const resolver = new CrossRepoResolver();

      const graph = makeGraph([{ id: 'src/index.ts', filePath: 'src/index.ts' }]);

      const repoGraphs = new Map<string, DependencyGraph>([
        ['my-repo', graph],
      ]);

      const manifest: PackageManifest = {
        repoName: 'my-repo',
        packageName: '@org/my-package',
        dependencies: ['@org/my-package'], // self-reference (e.g. workspaces)
        devDependencies: [],
      };

      const repoManifests = new Map<string, PackageManifest>([
        ['my-repo', manifest],
      ]);

      const result = resolver.resolveCrossRepoDependencies(repoGraphs, repoManifests);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should include devDependencies in cross-repo resolution', () => {
      const resolver = new CrossRepoResolver();

      const graphA = makeGraph([{ id: 'src/a.ts', filePath: 'src/a.ts' }]);
      const graphB = makeGraph([{ id: 'src/b.ts', filePath: 'src/b.ts' }]);

      const repoGraphs = new Map<string, DependencyGraph>([
        ['consumer', graphA],
        ['test-utils', graphB],
      ]);

      const manifestA: PackageManifest = {
        repoName: 'consumer',
        packageName: '@org/consumer',
        dependencies: [],
        devDependencies: ['@org/test-utils'],
      };

      const manifestB: PackageManifest = {
        repoName: 'test-utils',
        packageName: '@org/test-utils',
        dependencies: [],
        devDependencies: [],
      };

      const repoManifests = new Map<string, PackageManifest>([
        ['consumer', manifestA],
        ['test-utils', manifestB],
      ]);

      const result = resolver.resolveCrossRepoDependencies(repoGraphs, repoManifests);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.targetPackage).toBe('@org/test-utils');
      }
    });

    it('should handle repos without graphs', () => {
      const resolver = new CrossRepoResolver();

      const repoGraphs = new Map<string, DependencyGraph>();

      const manifestA: PackageManifest = {
        repoName: 'repo-a',
        packageName: '@org/alpha',
        dependencies: ['@org/beta'],
        devDependencies: [],
      };

      const manifestB: PackageManifest = {
        repoName: 'repo-b',
        packageName: '@org/beta',
        dependencies: [],
        devDependencies: [],
      };

      const repoManifests = new Map<string, PackageManifest>([
        ['repo-a', manifestA],
        ['repo-b', manifestB],
      ]);

      const result = resolver.resolveCrossRepoDependencies(repoGraphs, repoManifests);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.sourceChunkId).toBe('repo-a:root');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // mergeGraphs
  // ---------------------------------------------------------------------------

  describe('mergeGraphs', () => {
    it('should merge two graphs with cross-repo edges', () => {
      const resolver = new CrossRepoResolver();

      const graphA = makeGraph([
        { id: 'src/app.ts', filePath: 'src/app.ts', symbols: ['App'] },
      ]);
      const graphB = makeGraph([
        { id: 'src/lib.ts', filePath: 'src/lib.ts', symbols: ['helper'] },
      ]);

      const graphs = new Map<string, DependencyGraph>([
        ['frontend', graphA],
        ['shared', graphB],
      ]);

      const crossDeps = [
        {
          sourceRepo: 'frontend',
          targetRepo: 'shared',
          sourceChunkId: 'src/app.ts',
          targetPackage: '@org/shared',
          dependencyType: 'npm' as const,
        },
      ];

      const result = resolver.mergeGraphs(graphs, crossDeps);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const merged = result.value;

        // Both graphs' nodes should be present, prefixed
        expect(merged.getNode('frontend::src/app.ts')).toBeDefined();
        expect(merged.getNode('shared::src/lib.ts')).toBeDefined();

        // Cross-repo edge should exist
        const edges = merged.getAllEdges();
        const crossEdge = edges.find(
          (e) =>
            e.source.startsWith('frontend::') &&
            e.target.startsWith('shared::'),
        );
        expect(crossEdge).toBeDefined();
        expect(crossEdge?.type).toBe('imports');
      }
    });

    it('should preserve intra-repo edges after merge', () => {
      const resolver = new CrossRepoResolver();

      const graph = new DependencyGraph();
      graph.addNode({ id: 'src/a.ts', filePath: 'src/a.ts', symbols: [], type: 'module' });
      graph.addNode({ id: 'src/b.ts', filePath: 'src/b.ts', symbols: [], type: 'module' });
      graph.addEdge({ source: 'src/a.ts', target: 'src/b.ts', type: 'imports' });

      const graphs = new Map<string, DependencyGraph>([
        ['my-repo', graph],
      ]);

      const result = resolver.mergeGraphs(graphs, []);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const merged = result.value;
        expect(merged.nodeCount()).toBe(2);
        expect(merged.edgeCount()).toBe(1);

        const deps = merged.getDependencies('my-repo::src/a.ts');
        expect(deps).toContain('my-repo::src/b.ts');
      }
    });

    it('should handle empty graphs map', () => {
      const resolver = new CrossRepoResolver();

      const graphs = new Map<string, DependencyGraph>();

      const result = resolver.mergeGraphs(graphs, []);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.nodeCount()).toBe(0);
        expect(result.value.edgeCount()).toBe(0);
      }
    });

    it('should create placeholder nodes for missing graphs in cross-deps', () => {
      const resolver = new CrossRepoResolver();

      const graphs = new Map<string, DependencyGraph>();

      const crossDeps = [
        {
          sourceRepo: 'missing-a',
          targetRepo: 'missing-b',
          sourceChunkId: 'root',
          targetPackage: '@org/missing-b',
          dependencyType: 'npm' as const,
        },
      ];

      const result = resolver.mergeGraphs(graphs, crossDeps);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const merged = result.value;
        // Placeholder nodes should have been created
        expect(merged.getNode('missing-a::root')).toBeDefined();
        expect(merged.getNode('missing-b::root')).toBeDefined();
        expect(merged.edgeCount()).toBe(1);
      }
    });

    it('should support graph expansion across cross-repo edges', () => {
      const resolver = new CrossRepoResolver();

      const graphA = makeGraph([
        { id: 'src/consumer.ts', filePath: 'src/consumer.ts' },
      ]);
      const graphB = makeGraph([
        { id: 'src/provider.ts', filePath: 'src/provider.ts' },
      ]);

      const graphs = new Map<string, DependencyGraph>([
        ['consumer-repo', graphA],
        ['provider-repo', graphB],
      ]);

      const crossDeps = [
        {
          sourceRepo: 'consumer-repo',
          targetRepo: 'provider-repo',
          sourceChunkId: 'src/consumer.ts',
          targetPackage: '@org/provider',
          dependencyType: 'npm' as const,
        },
      ];

      const result = resolver.mergeGraphs(graphs, crossDeps);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const merged = result.value;

        // BFS from consumer should reach provider across repo boundary
        const related = merged.getRelatedNodes('consumer-repo::src/consumer.ts', 2);
        expect(related.has('provider-repo::src/provider.ts')).toBe(true);
      }
    });
  });
});
