/**
 * Query template engine for generating benchmark queries with ground-truth.
 *
 * Takes a RepoManifest (from the synthetic repo generator) and produces
 * concrete benchmark queries with deterministic expected chunk IDs.
 *
 * Templates cover: function lookup, class lookup, test finding, caller finding,
 * import tracing, concept search, cross-file navigation, and error investigation.
 *
 * Output format matches the existing BenchmarkDataset / BenchmarkQuery schema
 * in `packages/benchmarks/src/types.ts`.
 */

import { SeededRng } from './seed-rng.js';
import type { RepoManifest, ManifestEntity } from './repo-generator.js';
import type {
  BenchmarkDataset,
  BenchmarkQuery,
  ExpectedChunk,
  QueryCategory,
  QueryDifficulty,
} from '../types.js';

// ---------------------------------------------------------------------------
// Template Definition
// ---------------------------------------------------------------------------

interface QueryTemplate {
  /** Human-readable template pattern (for documentation). */
  readonly pattern: string;
  /** Difficulty level for queries this template produces. */
  readonly difficulty: QueryDifficulty;
  /** Category for queries this template produces. */
  readonly category: QueryCategory;
  /** Tags to attach to generated queries. */
  readonly tags: readonly string[];
  /**
   * Given the manifest and a PRNG, produce zero or more concrete queries.
   * Each returns an array of queries (one template may expand to multiple queries).
   */
  readonly generate: (manifest: RepoManifest, rng: SeededRng) => ConcreteQuery[];
}

interface ConcreteQuery {
  readonly query: string;
  readonly expectedChunks: ExpectedChunk[];
  readonly extraTags: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entityToExpectedChunk(
  entity: ManifestEntity,
  relevance: 'primary' | 'secondary',
): ExpectedChunk {
  return {
    filePath: entity.filePath,
    chunkType: entity.entityType,
    name: entity.entityType === 'method' ? entity.name.split('.').pop()! : entity.name,
    relevance,
  };
}

function filterEntities(
  manifest: RepoManifest,
  entityType: string,
): readonly ManifestEntity[] {
  return manifest.entities.filter((e) => e.entityType === entityType);
}

function pickN<T>(rng: SeededRng, items: readonly T[], n: number): T[] {
  if (items.length === 0) return [];
  return rng.sample([...items], Math.min(n, items.length));
}

// ---------------------------------------------------------------------------
// Query Templates
// ---------------------------------------------------------------------------

/** Template 1: Direct function lookup by name. */
const functionLookupTemplate: QueryTemplate = {
  pattern: 'Find the {functionName} function',
  difficulty: 'easy',
  category: 'function_lookup',
  tags: ['function', 'lookup'],
  generate(manifest, rng) {
    const functions = filterEntities(manifest, 'function');
    return pickN(rng, functions, 8).map((fn) => ({
      query: `Find the ${fn.name} function`,
      expectedChunks: [entityToExpectedChunk(fn, 'primary')],
      extraTags: [fn.module],
    }));
  },
};

/** Template 2: Direct class lookup by name. */
const classLookupTemplate: QueryTemplate = {
  pattern: 'Show the {className} class',
  difficulty: 'easy',
  category: 'function_lookup',
  tags: ['class', 'lookup'],
  generate(manifest, rng) {
    const classes = filterEntities(manifest, 'class');
    return pickN(rng, classes, 6).map((cls) => ({
      query: `Show the ${cls.name} class`,
      expectedChunks: [entityToExpectedChunk(cls, 'primary')],
      extraTags: [cls.module],
    }));
  },
};

/** Template 3: Interface lookup. */
const interfaceLookupTemplate: QueryTemplate = {
  pattern: 'Where is the {interfaceName} interface defined',
  difficulty: 'easy',
  category: 'function_lookup',
  tags: ['interface', 'lookup'],
  generate(manifest, rng) {
    const interfaces = filterEntities(manifest, 'interface');
    return pickN(rng, interfaces, 4).map((iface) => ({
      query: `Where is the ${iface.name} interface defined`,
      expectedChunks: [entityToExpectedChunk(iface, 'primary')],
      extraTags: [iface.module],
    }));
  },
};

/** Template 4: Find tests for a specific entity. */
const testFindingTemplate: QueryTemplate = {
  pattern: 'Find the tests for {entityName}',
  difficulty: 'medium',
  category: 'concept_search',
  tags: ['test', 'finding'],
  generate(manifest, rng) {
    const tests = filterEntities(manifest, 'test');
    const queries: ConcreteQuery[] = [];

    // For each test, find the entity it tests
    const testsByDep = new Map<string, ManifestEntity[]>();
    for (const test of tests) {
      for (const dep of test.dependencies) {
        const existing = testsByDep.get(dep) ?? [];
        existing.push(test);
        testsByDep.set(dep, existing);
      }
    }

    const depNames = [...testsByDep.keys()];
    for (const depName of pickN(rng, depNames, 5)) {
      const testEntities = testsByDep.get(depName) ?? [];
      if (testEntities.length === 0) continue;

      // Find the source entity
      const sourceEntity = manifest.entities.find(
        (e) => e.name === depName && e.entityType !== 'test',
      );
      if (!sourceEntity) continue;

      const expectedChunks: ExpectedChunk[] = testEntities.map((t) =>
        entityToExpectedChunk(t, 'primary'),
      );
      // Also include the source entity as secondary
      expectedChunks.push(entityToExpectedChunk(sourceEntity, 'secondary'));

      queries.push({
        query: `Find the tests for ${depName}`,
        expectedChunks,
        extraTags: [sourceEntity.module],
      });
    }

    return queries;
  },
};

/** Template 5: Concept search — how does module X work. */
const conceptModuleTemplate: QueryTemplate = {
  pattern: 'How does the {module} module work',
  difficulty: 'medium',
  category: 'concept_search',
  tags: ['concept', 'module'],
  generate(manifest, rng) {
    return pickN(rng, [...manifest.modules], 4).map((mod) => {
      const moduleEntities = manifest.entities.filter(
        (e) => e.module === mod && (e.entityType === 'class' || e.entityType === 'function'),
      );
      const primary = pickN(rng, moduleEntities, 2).map((e) =>
        entityToExpectedChunk(e, 'primary'),
      );
      const secondary = pickN(
        rng,
        moduleEntities.filter((e) => !primary.some((p) => p.name === e.name)),
        1,
      ).map((e) => entityToExpectedChunk(e, 'secondary'));

      return {
        query: `How does the ${mod} module work`,
        expectedChunks: [...primary, ...secondary],
        extraTags: [mod],
      };
    });
  },
};

/** Template 6: Caller/dependency lookup. */
const callerFindingTemplate: QueryTemplate = {
  pattern: 'What uses {entityName}',
  difficulty: 'medium',
  category: 'cross_file',
  tags: ['caller', 'dependency'],
  generate(manifest, rng) {
    // Find entities that have dependencies (imports from other entities)
    const withDeps = manifest.entities.filter((e) => e.dependencies.length > 0);
    const queries: ConcreteQuery[] = [];

    for (const entity of pickN(rng, withDeps, 4)) {
      for (const dep of entity.dependencies) {
        const depEntity = manifest.entities.find(
          (e) => e.name === dep && e.entityType !== 'test',
        );
        if (!depEntity) continue;

        queries.push({
          query: `What uses ${dep}`,
          expectedChunks: [
            entityToExpectedChunk(entity, 'primary'),
            entityToExpectedChunk(depEntity, 'secondary'),
          ],
          extraTags: [entity.module],
        });
      }
    }

    return queries;
  },
};

/** Template 7: Cross-file navigation between related entities. */
const crossFileTemplate: QueryTemplate = {
  pattern: 'How does {class} relate to {otherEntity} across files',
  difficulty: 'hard',
  category: 'cross_file',
  tags: ['cross-file', 'navigation'],
  generate(manifest, rng) {
    const classes = filterEntities(manifest, 'class');
    const queries: ConcreteQuery[] = [];

    for (const cls of pickN(rng, classes, 4)) {
      // Find entities in the same module but different files
      const sameModuleDiffFile = manifest.entities.filter(
        (e) =>
          e.module === cls.module &&
          e.filePath !== cls.filePath &&
          (e.entityType === 'class' || e.entityType === 'function'),
      );
      if (sameModuleDiffFile.length === 0) continue;

      const other = rng.pick(sameModuleDiffFile);
      queries.push({
        query: `How does ${cls.name} relate to ${other.name} in the ${cls.module} module`,
        expectedChunks: [
          entityToExpectedChunk(cls, 'primary'),
          entityToExpectedChunk(other, 'primary'),
        ],
        extraTags: [cls.module],
      });
    }

    return queries;
  },
};

/** Template 8: Method lookup on a class. */
const methodLookupTemplate: QueryTemplate = {
  pattern: 'Find the {methodName} method on {className}',
  difficulty: 'easy',
  category: 'function_lookup',
  tags: ['method', 'lookup'],
  generate(manifest, rng) {
    const methods = filterEntities(manifest, 'method');
    return pickN(rng, methods, 5).map((method) => {
      const parts = method.name.split('.');
      const className = parts[0] ?? '';
      const methodName = parts[1] ?? '';
      const classEntity = manifest.entities.find(
        (e) => e.name === className && e.entityType === 'class',
      );

      const expectedChunks: ExpectedChunk[] = [
        entityToExpectedChunk(method, 'primary'),
      ];
      if (classEntity) {
        expectedChunks.push(entityToExpectedChunk(classEntity, 'secondary'));
      }

      return {
        query: `Find the ${methodName} method on ${className}`,
        expectedChunks,
        extraTags: [method.module],
      };
    });
  },
};

/** Template 9: Error / validation pattern search. */
const errorInvestigationTemplate: QueryTemplate = {
  pattern: 'How does {module} handle validation and errors',
  difficulty: 'hard',
  category: 'error_investigation',
  tags: ['error', 'validation'],
  generate(manifest, rng) {
    return pickN(rng, [...manifest.modules], 3).map((mod) => {
      const moduleEntities = manifest.entities.filter(
        (e) =>
          e.module === mod &&
          (e.entityType === 'class' || e.entityType === 'function') &&
          (e.name.toLowerCase().includes('validate') ||
            e.description.toLowerCase().includes('validate') ||
            e.description.toLowerCase().includes('filter') ||
            e.description.toLowerCase().includes('parse')),
      );

      // If no validation-related entities, fall back to any entity in the module
      const targets =
        moduleEntities.length > 0
          ? moduleEntities
          : manifest.entities.filter(
              (e) =>
                e.module === mod &&
                (e.entityType === 'class' || e.entityType === 'function'),
            );

      const primary = pickN(rng, targets, 2).map((e) =>
        entityToExpectedChunk(e, 'primary'),
      );

      return {
        query: `How does the ${mod} module handle validation and errors`,
        expectedChunks: primary,
        extraTags: [mod, 'error-handling'],
      };
    });
  },
};

/** Template 10: Import tracing — what does file X import. */
const importTracingTemplate: QueryTemplate = {
  pattern: 'What does {fileName} import from other modules',
  difficulty: 'medium',
  category: 'cross_file',
  tags: ['import', 'tracing'],
  generate(manifest, rng) {
    const withDeps = manifest.entities.filter(
      (e) => e.dependencies.length > 0 && e.entityType !== 'test',
    );
    const queries: ConcreteQuery[] = [];

    for (const entity of pickN(rng, withDeps, 3)) {
      const fileName = entity.filePath.split('/').pop() ?? '';
      const depEntities = entity.dependencies
        .map((dep) =>
          manifest.entities.find((e) => e.name === dep && e.entityType !== 'test'),
        )
        .filter((e): e is ManifestEntity => e !== undefined);

      if (depEntities.length === 0) continue;

      queries.push({
        query: `What does ${fileName} import from other modules`,
        expectedChunks: [
          entityToExpectedChunk(entity, 'primary'),
          ...depEntities.map((d) => entityToExpectedChunk(d, 'secondary')),
        ],
        extraTags: [entity.module],
      });
    }

    return queries;
  },
};

/** Template 11: Description-based natural language search. */
const descriptionSearchTemplate: QueryTemplate = {
  pattern: 'Find code that {description}',
  difficulty: 'medium',
  category: 'concept_search',
  tags: ['description', 'semantic'],
  generate(manifest, rng) {
    const entities = manifest.entities.filter(
      (e) => e.entityType === 'function' || e.entityType === 'class',
    );
    return pickN(rng, entities, 4).map((entity) => ({
      query: entity.description,
      expectedChunks: [entityToExpectedChunk(entity, 'primary')],
      extraTags: [entity.module],
    }));
  },
};

/** Template 12: Module overview — list all services in a domain. */
const moduleOverviewTemplate: QueryTemplate = {
  pattern: 'List all services in the {module} domain',
  difficulty: 'medium',
  category: 'concept_search',
  tags: ['overview', 'module'],
  generate(manifest, rng) {
    return pickN(rng, [...manifest.modules], 3).map((mod) => {
      const services = manifest.entities.filter(
        (e) => e.module === mod && e.entityType === 'class' && e.name.includes('Service'),
      );
      const primary = pickN(rng, services, 3).map((e) =>
        entityToExpectedChunk(e, 'primary'),
      );

      // If no services found, use any class
      if (primary.length === 0) {
        const classes = manifest.entities.filter(
          (e) => e.module === mod && e.entityType === 'class',
        );
        const fallback = pickN(rng, classes, 2).map((e) =>
          entityToExpectedChunk(e, 'primary'),
        );
        return {
          query: `List all classes in the ${mod} domain`,
          expectedChunks: fallback,
          extraTags: [mod],
        };
      }

      return {
        query: `List all services in the ${mod} domain`,
        expectedChunks: primary,
        extraTags: [mod],
      };
    });
  },
};

// ---------------------------------------------------------------------------
// All Templates
// ---------------------------------------------------------------------------

const ALL_TEMPLATES: readonly QueryTemplate[] = [
  functionLookupTemplate,      // ~8 queries
  classLookupTemplate,         // ~6 queries
  interfaceLookupTemplate,     // ~4 queries
  methodLookupTemplate,        // ~5 queries
  testFindingTemplate,         // ~5 queries
  conceptModuleTemplate,       // ~4 queries
  callerFindingTemplate,       // ~4 queries
  crossFileTemplate,           // ~4 queries
  errorInvestigationTemplate,  // ~3 queries
  importTracingTemplate,       // ~3 queries
  descriptionSearchTemplate,   // ~4 queries
  moduleOverviewTemplate,      // ~3 queries
];
// Total: ~53 queries minimum for repos with 10+ files

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface QueryEngineOptions {
  /** PRNG seed for deterministic query selection. */
  readonly seed: number;
  /** Minimum number of queries to generate. Defaults to 50. */
  readonly minQueries?: number;
  /** Target repo name / identifier. */
  readonly targetRepo?: string;
}

/**
 * Generate benchmark queries from a repo manifest using templates.
 *
 * Same seed + same manifest = identical queries (deterministic).
 * Produces at least `minQueries` (default 50) queries.
 *
 * @param manifest - Manifest from generateRepo()
 * @param options - Query generation options
 * @returns A BenchmarkDataset compatible with the existing schema
 */
export function generateQueries(
  manifest: RepoManifest,
  options: QueryEngineOptions,
): BenchmarkDataset {
  const { seed, minQueries = 50, targetRepo = 'synthetic-repo' } = options;
  const rng = new SeededRng(seed);

  let allQueries: ConcreteQuery[] = [];

  // Run each template
  for (const template of ALL_TEMPLATES) {
    const generated = template.generate(manifest, rng);
    for (const q of generated) {
      allQueries.push(q);
    }
  }

  // If we don't have enough queries, run templates again with offset seed
  let attempts = 0;
  while (allQueries.length < minQueries && attempts < 5) {
    attempts++;
    const extraRng = new SeededRng(seed + attempts * 1000);
    for (const template of ALL_TEMPLATES) {
      const generated = template.generate(manifest, extraRng);
      for (const q of generated) {
        // Deduplicate by query text
        if (!allQueries.some((existing) => existing.query === q.query)) {
          allQueries.push(q);
        }
      }
      if (allQueries.length >= minQueries) break;
    }
  }

  // Filter out queries with no expected chunks
  allQueries = allQueries.filter((q) => q.expectedChunks.length > 0);

  // Convert to BenchmarkQuery format
  const benchmarkQueries: BenchmarkQuery[] = allQueries.map((q, index) => {
    // Determine difficulty from template or infer from expected chunk count
    const chunkCount = q.expectedChunks.length;
    let difficulty: QueryDifficulty;
    if (chunkCount === 1) difficulty = 'easy';
    else if (chunkCount <= 3) difficulty = 'medium';
    else difficulty = 'hard';

    // Determine category from tags
    let category: QueryCategory;
    if (q.extraTags.includes('error-handling') || q.expectedChunks.some((c) => c.name.includes('validate'))) {
      category = 'error_investigation';
    } else if (q.expectedChunks.length > 1 && q.expectedChunks.some((c) => c.relevance === 'secondary')) {
      category = 'cross_file';
    } else if (q.query.toLowerCase().startsWith('how') || q.query.toLowerCase().includes('module')) {
      category = 'concept_search';
    } else {
      category = 'function_lookup';
    }

    const id = `gen-${String(index + 1).padStart(3, '0')}`;

    return {
      id,
      query: q.query,
      difficulty,
      category,
      expectedChunks: q.expectedChunks,
      tags: [...new Set([...q.extraTags])],
    };
  });

  return {
    name: `synthetic-benchmark-seed-${manifest.seed}`,
    description: `Auto-generated benchmark dataset from synthetic repo (seed=${manifest.seed}, files=${manifest.options.fileCount}, languages=${manifest.options.languages.join(',')})`,
    targetRepo,
    queries: benchmarkQueries,
  };
}
