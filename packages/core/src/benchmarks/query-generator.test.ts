import { describe, it, expect } from 'vitest';
import {
  generateFindByNameQueries,
  generateFindByDescriptionQueries,
  generateFindCallersQueries,
  generateFindTestsQueries,
  generateFindImportsQueries,
  generateQueries,
} from './query-generator.js';
import type { ScannedEntity, IndexScanResult } from './index-scanner.js';
import type { GraphEdge } from '../graph/dependency-graph.js';

function makeEntity(
  id: string,
  overrides: Partial<ScannedEntity> = {},
): ScannedEntity {
  return {
    chunkId: id,
    name: overrides.name ?? 'myFunc',
    chunkType: overrides.chunkType ?? 'function',
    filePath: overrides.filePath ?? 'src/utils.ts',
    language: overrides.language ?? 'typescript',
    nlSummary: overrides.nlSummary ?? 'A utility function that does something useful',
    imports: overrides.imports ?? [],
    exports: overrides.exports ?? [],
    declarations: overrides.declarations ?? [],
  };
}

function makeIndexScan(entities: ScannedEntity[]): IndexScanResult {
  const entityMap = new Map<string, ScannedEntity>();
  const nameToChunkIds = new Map<string, string[]>();
  const fileToChunkIds = new Map<string, string[]>();

  for (const e of entities) {
    entityMap.set(e.chunkId, e);

    if (e.name.length > 0) {
      const existing = nameToChunkIds.get(e.name);
      if (existing) {
        existing.push(e.chunkId);
      } else {
        nameToChunkIds.set(e.name, [e.chunkId]);
      }
    }

    if (e.filePath.length > 0) {
      const existing = fileToChunkIds.get(e.filePath);
      if (existing) {
        existing.push(e.chunkId);
      } else {
        fileToChunkIds.set(e.filePath, [e.chunkId]);
      }
    }
  }

  return {
    entities,
    totalChunks: entities.length,
    entityMap,
    nameToChunkIds,
    fileToChunkIds,
  };
}

function fixedRandom(): () => number {
  let i = 0;
  return () => {
    i = (i + 1) % 100;
    return i / 100;
  };
}

describe('generateFindByNameQueries', () => {
  it('should generate queries for named entities', () => {
    const entities = [
      makeEntity('c1', { name: 'parseConfig', chunkType: 'function' }),
      makeEntity('c2', { name: 'MyClass', chunkType: 'class' }),
    ];

    const queries = generateFindByNameQueries(entities, 10, fixedRandom());
    expect(queries.length).toBeLessThanOrEqual(2);
    expect(queries.length).toBeGreaterThan(0);

    for (const q of queries) {
      expect(q.queryType).toBe('find-by-name');
      expect(q.expectedChunkIds).toHaveLength(1);
      expect(q.query).toContain(q.sourceEntityId === 'c1' ? 'parseConfig' : 'MyClass');
    }
  });

  it('should skip entities with empty names', () => {
    const entities = [
      makeEntity('c1', { name: '', chunkType: 'function' }),
    ];

    const queries = generateFindByNameQueries(entities, 10, fixedRandom());
    expect(queries).toHaveLength(0);
  });

  it('should skip import_block and config_block types', () => {
    const entities = [
      makeEntity('c1', { name: 'imports', chunkType: 'import_block' }),
      makeEntity('c2', { name: 'config', chunkType: 'config_block' }),
    ];

    const queries = generateFindByNameQueries(entities, 10, fixedRandom());
    expect(queries).toHaveLength(0);
  });

  it('should limit output to requested count', () => {
    const entities = Array.from({ length: 50 }, (_, i) =>
      makeEntity(`c${i}`, { name: `func${i}` }),
    );

    const queries = generateFindByNameQueries(entities, 5, fixedRandom());
    expect(queries).toHaveLength(5);
  });

  it('should format type_alias as type in query', () => {
    const entities = [
      makeEntity('c1', { name: 'Config', chunkType: 'type_alias' }),
    ];

    const queries = generateFindByNameQueries(entities, 10, fixedRandom());
    expect(queries[0]!.query).toBe('Config type');
  });
});

describe('generateFindByDescriptionQueries', () => {
  it('should use NL summary as query', () => {
    const entities = [
      makeEntity('c1', {
        nlSummary: 'Parses configuration from YAML file and validates schema',
      }),
    ];

    const queries = generateFindByDescriptionQueries(entities, 10, fixedRandom());
    expect(queries).toHaveLength(1);
    expect(queries[0]!.query).toBe('Parses configuration from YAML file and validates schema');
    expect(queries[0]!.expectedChunkIds).toEqual(['c1']);
    expect(queries[0]!.queryType).toBe('find-by-description');
  });

  it('should skip entities with short summaries', () => {
    const entities = [
      makeEntity('c1', { nlSummary: 'Short' }),
    ];

    const queries = generateFindByDescriptionQueries(entities, 10, fixedRandom());
    expect(queries).toHaveLength(0);
  });
});

describe('generateFindCallersQueries', () => {
  it('should generate caller queries for entities with callers', () => {
    const entities = [
      makeEntity('c1', { name: 'parseConfig' }),
    ];

    const callerMap = new Map<string, readonly string[]>();
    callerMap.set('c1', ['c2', 'c3']);

    const queries = generateFindCallersQueries(entities, callerMap, 10, fixedRandom());
    expect(queries).toHaveLength(1);
    expect(queries[0]!.query).toBe('callers of parseConfig');
    expect(queries[0]!.expectedChunkIds).toEqual(['c2', 'c3', 'c1']);
    expect(queries[0]!.queryType).toBe('find-callers');
  });

  it('should skip entities without callers', () => {
    const entities = [
      makeEntity('c1', { name: 'isolated' }),
    ];

    const callerMap = new Map<string, readonly string[]>();

    const queries = generateFindCallersQueries(entities, callerMap, 10, fixedRandom());
    expect(queries).toHaveLength(0);
  });
});

describe('generateFindTestsQueries', () => {
  it('should generate test queries for entities with test files', () => {
    const entities = [
      makeEntity('c1', { name: 'parseConfig', filePath: 'src/config.ts' }),
    ];

    const testMap = new Map<string, readonly string[]>();
    testMap.set('src/config.ts', ['t1', 't2']);

    const queries = generateFindTestsQueries(entities, testMap, 10, fixedRandom());
    expect(queries).toHaveLength(1);
    expect(queries[0]!.query).toBe('tests for parseConfig');
    expect(queries[0]!.expectedChunkIds).toEqual(['t1', 't2', 'c1']);
    expect(queries[0]!.queryType).toBe('find-tests');
  });

  it('should skip entities without test files', () => {
    const entities = [
      makeEntity('c1', { name: 'noTests', filePath: 'src/no-tests.ts' }),
    ];

    const testMap = new Map<string, readonly string[]>();

    const queries = generateFindTestsQueries(entities, testMap, 10, fixedRandom());
    expect(queries).toHaveLength(0);
  });
});

describe('generateFindImportsQueries', () => {
  it('should generate import queries for entities with import edges', () => {
    const entities = [
      makeEntity('c1', { name: 'MyModule' }),
    ];

    const edges: GraphEdge[] = [
      { source: 'c1', target: 'c2', type: 'imports' },
    ];

    const queries = generateFindImportsQueries(entities, edges, 10, fixedRandom());
    expect(queries).toHaveLength(1);
    expect(queries[0]!.query).toBe('imports of MyModule');
    expect(queries[0]!.expectedChunkIds).toEqual(['c2', 'c1']);
    expect(queries[0]!.queryType).toBe('find-imports');
  });

  it('should skip entities without import edges', () => {
    const entities = [
      makeEntity('c1', { name: 'Isolated' }),
    ];

    const edges: GraphEdge[] = [];

    const queries = generateFindImportsQueries(entities, edges, 10, fixedRandom());
    expect(queries).toHaveLength(0);
  });
});

describe('generateQueries', () => {
  it('should generate combined queries respecting maxQueries', () => {
    const entities = Array.from({ length: 20 }, (_, i) =>
      makeEntity(`c${i}`, {
        name: `func${i}`,
        nlSummary: `This is a detailed description of function ${i} that is long enough`,
        filePath: `src/file${i}.ts`,
      }),
    );

    const scan = makeIndexScan(entities);
    const edges: GraphEdge[] = [];
    const callerMap = new Map<string, readonly string[]>();
    const testMap = new Map<string, readonly string[]>();

    const queries = generateQueries(scan, edges, callerMap, testMap, { maxQueries: 10 });
    expect(queries.length).toBeLessThanOrEqual(10);
    expect(queries.length).toBeGreaterThan(0);
  });

  it('should produce deterministic results with same seed', () => {
    const entities = Array.from({ length: 20 }, (_, i) =>
      makeEntity(`c${i}`, {
        name: `func${i}`,
        nlSummary: `This is a detailed description of function ${i} that is long enough`,
        filePath: `src/file${i}.ts`,
      }),
    );

    const scan = makeIndexScan(entities);
    const edges: GraphEdge[] = [];
    const callerMap = new Map<string, readonly string[]>();
    const testMap = new Map<string, readonly string[]>();

    const queries1 = generateQueries(scan, edges, callerMap, testMap, { maxQueries: 10 }, 42);
    const queries2 = generateQueries(scan, edges, callerMap, testMap, { maxQueries: 10 }, 42);

    expect(queries1.map((q) => q.query)).toEqual(queries2.map((q) => q.query));
  });

  it('should produce different results with different seeds', () => {
    const entities = Array.from({ length: 50 }, (_, i) =>
      makeEntity(`c${i}`, {
        name: `func${i}`,
        nlSummary: `This is a detailed description of function ${i} that is long enough`,
        filePath: `src/file${i}.ts`,
      }),
    );

    const scan = makeIndexScan(entities);
    const edges: GraphEdge[] = [];
    const callerMap = new Map<string, readonly string[]>();
    const testMap = new Map<string, readonly string[]>();

    const queries1 = generateQueries(scan, edges, callerMap, testMap, { maxQueries: 20 }, 42);
    const queries2 = generateQueries(scan, edges, callerMap, testMap, { maxQueries: 20 }, 99);

    // Very unlikely to be identical with different seeds and 50 entities
    const q1Strings = queries1.map((q) => q.query);
    const q2Strings = queries2.map((q) => q.query);
    expect(q1Strings).not.toEqual(q2Strings);
  });

  it('should handle empty index gracefully', () => {
    const scan = makeIndexScan([]);
    const queries = generateQueries(
      scan,
      [],
      new Map(),
      new Map(),
      { maxQueries: 10 },
    );
    expect(queries).toHaveLength(0);
  });

  it('should include multiple query types when data is available', () => {
    const entities = Array.from({ length: 30 }, (_, i) =>
      makeEntity(`c${i}`, {
        name: `func${i}`,
        nlSummary: `This is a detailed description of function ${i} that is long enough`,
        filePath: `src/file${i % 5}.ts`,
      }),
    );

    const scan = makeIndexScan(entities);

    const edges: GraphEdge[] = [
      { source: 'c0', target: 'c1', type: 'calls' },
      { source: 'c2', target: 'c1', type: 'imports' },
    ];

    const callerMap = new Map<string, readonly string[]>();
    callerMap.set('c1', ['c0', 'c2']);

    const testMap = new Map<string, readonly string[]>();
    testMap.set('src/file0.ts', ['t1']);

    const queries = generateQueries(scan, edges, callerMap, testMap, { maxQueries: 50 }, 42);
    const types = new Set(queries.map((q) => q.queryType));

    // Should have at minimum find-by-name and find-by-description
    expect(types.has('find-by-name')).toBe(true);
    expect(types.has('find-by-description')).toBe(true);
  });
});
