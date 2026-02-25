/**
 * Auto-generates benchmark queries with ground-truth from scanned index data.
 *
 * Query types:
 * - find-by-name: "Where is the X function/class/interface?"
 * - find-by-description: Uses NL summary as query text
 * - find-callers: "What calls X?" or "What references X?"
 * - find-tests: "Tests for X" or "Test file for foo.ts"
 * - find-imports: "What does X import?" or "What imports X?"
 *
 * Each query has a ground-truth set of expected chunk IDs.
 */

import type {
  ScannedEntity,
  IndexScanResult,
} from './index-scanner.js';
import type { GraphEdge } from '../graph/dependency-graph.js';

/** The type of benchmark query generated. */
export type BenchmarkQueryType =
  | 'find-by-name'
  | 'find-by-description'
  | 'find-callers'
  | 'find-tests'
  | 'find-imports';

/** A single auto-generated benchmark query with ground truth. */
export interface GeneratedQuery {
  readonly query: string;
  readonly expectedChunkIds: readonly string[];
  readonly queryType: BenchmarkQueryType;
  /** Source entity that inspired this query. */
  readonly sourceEntityId: string;
}

/** Options for query generation. */
export interface QueryGeneratorOptions {
  /** Total number of queries to generate (default: 100). */
  readonly maxQueries: number;
  /** Distribution of query types as fractions (must sum to 1.0). */
  readonly distribution?: Readonly<Record<BenchmarkQueryType, number>>;
}

const DEFAULT_DISTRIBUTION: Readonly<Record<BenchmarkQueryType, number>> = {
  'find-by-name': 0.30,
  'find-by-description': 0.25,
  'find-callers': 0.15,
  'find-tests': 0.15,
  'find-imports': 0.15,
};

/** Types eligible for name-based queries (skip import_block, config_block). */
const NAME_QUERY_TYPES = new Set([
  'function', 'method', 'class', 'interface', 'type_alias', 'module',
]);

/**
 * Deterministic seeded pseudo-random number generator (mulberry32).
 * Allows reproducible benchmark datasets.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed | 0;
  return (): number => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle an array deterministically using Fisher-Yates with seeded RNG.
 */
function shuffleDeterministic<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

/**
 * Generate find-by-name queries.
 * Query: "Where is the <name> <type>?" or "<name> <type>"
 * Ground truth: chunk ID of the entity itself.
 */
export function generateFindByNameQueries(
  entities: readonly ScannedEntity[],
  count: number,
  random: () => number,
): GeneratedQuery[] {
  const eligible = entities.filter(
    (e) => e.name.length > 0 && NAME_QUERY_TYPES.has(e.chunkType),
  );

  if (eligible.length === 0) return [];

  const shuffled = shuffleDeterministic(eligible, random);
  const selected = shuffled.slice(0, count);

  return selected.map((entity) => {
    const typeLabel = entity.chunkType === 'type_alias' ? 'type' : entity.chunkType;
    return {
      query: `${entity.name} ${typeLabel}`,
      expectedChunkIds: [entity.chunkId],
      queryType: 'find-by-name' as const,
      sourceEntityId: entity.chunkId,
    };
  });
}

/**
 * Generate find-by-description queries.
 * Query: The NL summary of the entity.
 * Ground truth: chunk ID of the entity itself.
 */
export function generateFindByDescriptionQueries(
  entities: readonly ScannedEntity[],
  count: number,
  random: () => number,
): GeneratedQuery[] {
  const eligible = entities.filter(
    (e) => e.nlSummary.length > 20 && NAME_QUERY_TYPES.has(e.chunkType),
  );

  if (eligible.length === 0) return [];

  const shuffled = shuffleDeterministic(eligible, random);
  const selected = shuffled.slice(0, count);

  return selected.map((entity) => ({
    query: entity.nlSummary,
    expectedChunkIds: [entity.chunkId],
    queryType: 'find-by-description' as const,
    sourceEntityId: entity.chunkId,
  }));
}

/**
 * Generate find-callers queries.
 * Query: "What calls <name>?" or "callers of <name>"
 * Ground truth: chunk IDs of callers from the dependency graph.
 */
export function generateFindCallersQueries(
  entities: readonly ScannedEntity[],
  callerMap: ReadonlyMap<string, readonly string[]>,
  count: number,
  random: () => number,
): GeneratedQuery[] {
  // Only generate queries for entities that actually have callers
  const eligible = entities.filter(
    (e) => e.name.length > 0 && (callerMap.get(e.chunkId)?.length ?? 0) > 0,
  );

  if (eligible.length === 0) return [];

  const shuffled = shuffleDeterministic(eligible, random);
  const selected = shuffled.slice(0, count);

  return selected.map((entity) => {
    const callers = callerMap.get(entity.chunkId) ?? [];
    return {
      query: `callers of ${entity.name}`,
      expectedChunkIds: [...callers, entity.chunkId],
      queryType: 'find-callers' as const,
      sourceEntityId: entity.chunkId,
    };
  });
}

/**
 * Generate find-tests queries.
 * Query: "tests for <name>" or "test file for <filePath>"
 * Ground truth: chunk IDs in the corresponding test file.
 */
export function generateFindTestsQueries(
  entities: readonly ScannedEntity[],
  testMap: ReadonlyMap<string, readonly string[]>,
  count: number,
  random: () => number,
): GeneratedQuery[] {
  // Only generate for entities whose file has a test file
  const eligible = entities.filter(
    (e) =>
      e.name.length > 0 &&
      NAME_QUERY_TYPES.has(e.chunkType) &&
      (testMap.get(e.filePath)?.length ?? 0) > 0,
  );

  if (eligible.length === 0) return [];

  const shuffled = shuffleDeterministic(eligible, random);
  const selected = shuffled.slice(0, count);

  return selected.map((entity) => {
    const testChunkIds = testMap.get(entity.filePath) ?? [];
    return {
      query: `tests for ${entity.name}`,
      expectedChunkIds: [...testChunkIds, entity.chunkId],
      queryType: 'find-tests' as const,
      sourceEntityId: entity.chunkId,
    };
  });
}

/**
 * Generate find-imports queries.
 * Query: "imports of <name>" or "what does <name> import"
 * Ground truth: chunk IDs of imported modules (resolved via name map).
 */
export function generateFindImportsQueries(
  entities: readonly ScannedEntity[],
  edges: readonly GraphEdge[],
  count: number,
  random: () => number,
): GeneratedQuery[] {
  // Build import targets from graph edges
  const importTargets = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === 'imports') {
      const existing = importTargets.get(edge.source);
      if (existing) {
        existing.push(edge.target);
      } else {
        importTargets.set(edge.source, [edge.target]);
      }
    }
  }

  const eligible = entities.filter(
    (e) =>
      e.name.length > 0 &&
      NAME_QUERY_TYPES.has(e.chunkType) &&
      (importTargets.get(e.chunkId)?.length ?? 0) > 0,
  );

  if (eligible.length === 0) return [];

  const shuffled = shuffleDeterministic(eligible, random);
  const selected = shuffled.slice(0, count);

  return selected.map((entity) => {
    const targets = importTargets.get(entity.chunkId) ?? [];
    return {
      query: `imports of ${entity.name}`,
      expectedChunkIds: [...targets, entity.chunkId],
      queryType: 'find-imports' as const,
      sourceEntityId: entity.chunkId,
    };
  });
}

/**
 * Generate a complete benchmark dataset from scanned index data.
 *
 * Distributes queries across types according to the configured distribution,
 * using a deterministic seeded RNG for reproducibility.
 */
export function generateQueries(
  scanResult: IndexScanResult,
  edges: readonly GraphEdge[],
  callerMap: ReadonlyMap<string, readonly string[]>,
  testMap: ReadonlyMap<string, readonly string[]>,
  options: QueryGeneratorOptions,
  seed: number = 42,
): readonly GeneratedQuery[] {
  const random = createSeededRandom(seed);
  const distribution = options.distribution ?? DEFAULT_DISTRIBUTION;
  const maxQueries = options.maxQueries;

  // Calculate target counts per type
  const targetCounts: Record<BenchmarkQueryType, number> = {
    'find-by-name': Math.round(maxQueries * distribution['find-by-name']),
    'find-by-description': Math.round(maxQueries * distribution['find-by-description']),
    'find-callers': Math.round(maxQueries * distribution['find-callers']),
    'find-tests': Math.round(maxQueries * distribution['find-tests']),
    'find-imports': Math.round(maxQueries * distribution['find-imports']),
  };

  const { entities } = scanResult;

  const nameQueries = generateFindByNameQueries(entities, targetCounts['find-by-name'], random);
  const descQueries = generateFindByDescriptionQueries(entities, targetCounts['find-by-description'], random);
  const callerQueries = generateFindCallersQueries(entities, callerMap, targetCounts['find-callers'], random);
  const testQueries = generateFindTestsQueries(entities, testMap, targetCounts['find-tests'], random);
  const importQueries = generateFindImportsQueries(entities, edges, targetCounts['find-imports'], random);

  // Combine and trim to maxQueries
  const allQueries = [
    ...nameQueries,
    ...descQueries,
    ...callerQueries,
    ...testQueries,
    ...importQueries,
  ];

  // Shuffle the combined set for fair evaluation
  return shuffleDeterministic(allQueries, random).slice(0, maxQueries);
}
