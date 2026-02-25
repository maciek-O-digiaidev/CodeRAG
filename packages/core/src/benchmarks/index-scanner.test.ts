import { describe, it, expect } from 'vitest';
import {
  parseIndexRows,
  buildCallerMap,
  buildTestMap,
  type ScannedEntity,
} from './index-scanner.js';
import type { GraphEdge } from '../graph/dependency-graph.js';

function makeRow(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): { id: string; metadata: Record<string, unknown> } {
  return {
    id,
    metadata: {
      name: overrides['name'] ?? 'myFunction',
      chunk_type: overrides['chunk_type'] ?? 'function',
      file_path: overrides['file_path'] ?? 'src/utils.ts',
      language: overrides['language'] ?? 'typescript',
      nl_summary: overrides['nl_summary'] ?? 'A utility function',
      imports: overrides['imports'] ?? ['lodash'],
      exports: overrides['exports'] ?? ['myFunction'],
      declarations: overrides['declarations'] ?? ['myFunction'],
    },
  };
}

describe('parseIndexRows', () => {
  it('should parse empty rows to empty result', () => {
    const result = parseIndexRows([]);
    expect(result.isOk()).toBe(true);
    const scan = result._unsafeUnwrap();
    expect(scan.entities).toHaveLength(0);
    expect(scan.totalChunks).toBe(0);
  });

  it('should parse a single row into a ScannedEntity', () => {
    const rows = [makeRow('chunk-1')];
    const result = parseIndexRows(rows);
    expect(result.isOk()).toBe(true);

    const scan = result._unsafeUnwrap();
    expect(scan.entities).toHaveLength(1);
    expect(scan.totalChunks).toBe(1);

    const entity = scan.entities[0]!;
    expect(entity.chunkId).toBe('chunk-1');
    expect(entity.name).toBe('myFunction');
    expect(entity.chunkType).toBe('function');
    expect(entity.filePath).toBe('src/utils.ts');
    expect(entity.language).toBe('typescript');
    expect(entity.nlSummary).toBe('A utility function');
    expect(entity.imports).toEqual(['lodash']);
    expect(entity.exports).toEqual(['myFunction']);
    expect(entity.declarations).toEqual(['myFunction']);
  });

  it('should build entityMap correctly', () => {
    const rows = [
      makeRow('chunk-1', { name: 'foo' }),
      makeRow('chunk-2', { name: 'bar' }),
    ];

    const scan = parseIndexRows(rows)._unsafeUnwrap();
    expect(scan.entityMap.size).toBe(2);
    expect(scan.entityMap.get('chunk-1')?.name).toBe('foo');
    expect(scan.entityMap.get('chunk-2')?.name).toBe('bar');
  });

  it('should build nameToChunkIds correctly', () => {
    const rows = [
      makeRow('chunk-1', { name: 'foo' }),
      makeRow('chunk-2', { name: 'foo' }),
      makeRow('chunk-3', { name: 'bar' }),
    ];

    const scan = parseIndexRows(rows)._unsafeUnwrap();
    expect(scan.nameToChunkIds.get('foo')).toEqual(['chunk-1', 'chunk-2']);
    expect(scan.nameToChunkIds.get('bar')).toEqual(['chunk-3']);
  });

  it('should skip empty names in nameToChunkIds', () => {
    const rows = [
      makeRow('chunk-1', { name: '' }),
      makeRow('chunk-2', { name: 'bar' }),
    ];

    const scan = parseIndexRows(rows)._unsafeUnwrap();
    expect(scan.nameToChunkIds.has('')).toBe(false);
    expect(scan.nameToChunkIds.get('bar')).toEqual(['chunk-2']);
  });

  it('should build fileToChunkIds correctly', () => {
    const rows = [
      makeRow('chunk-1', { file_path: 'src/a.ts' }),
      makeRow('chunk-2', { file_path: 'src/a.ts' }),
      makeRow('chunk-3', { file_path: 'src/b.ts' }),
    ];

    const scan = parseIndexRows(rows)._unsafeUnwrap();
    expect(scan.fileToChunkIds.get('src/a.ts')).toEqual(['chunk-1', 'chunk-2']);
    expect(scan.fileToChunkIds.get('src/b.ts')).toEqual(['chunk-3']);
  });

  it('should handle missing metadata fields gracefully', () => {
    const row = {
      id: 'chunk-1',
      metadata: {},
    };

    const scan = parseIndexRows([row])._unsafeUnwrap();
    const entity = scan.entities[0]!;
    expect(entity.name).toBe('');
    expect(entity.chunkType).toBe('function');
    expect(entity.filePath).toBe('');
    expect(entity.language).toBe('unknown');
    expect(entity.nlSummary).toBe('');
    expect(entity.imports).toEqual([]);
    expect(entity.exports).toEqual([]);
  });

  it('should handle unknown chunk type as function fallback', () => {
    const rows = [makeRow('chunk-1', { chunk_type: 'banana' })];
    const scan = parseIndexRows(rows)._unsafeUnwrap();
    expect(scan.entities[0]!.chunkType).toBe('function');
  });

  it('should handle all valid chunk types', () => {
    const types = [
      'function', 'method', 'class', 'module', 'interface',
      'type_alias', 'config_block', 'import_block', 'doc',
    ];

    for (const type of types) {
      const rows = [makeRow('chunk-1', { chunk_type: type })];
      const scan = parseIndexRows(rows)._unsafeUnwrap();
      expect(scan.entities[0]!.chunkType).toBe(type);
    }
  });
});

describe('buildCallerMap', () => {
  it('should return empty map for no edges', () => {
    const map = buildCallerMap([]);
    expect(map.size).toBe(0);
  });

  it('should map callers correctly', () => {
    const edges: GraphEdge[] = [
      { source: 'a', target: 'b', type: 'calls' },
      { source: 'c', target: 'b', type: 'references' },
    ];

    const map = buildCallerMap(edges);
    expect(map.get('b')).toEqual(['a', 'c']);
  });

  it('should include import edges as callers', () => {
    const edges: GraphEdge[] = [
      { source: 'a', target: 'b', type: 'imports' },
    ];

    const map = buildCallerMap(edges);
    expect(map.get('b')).toEqual(['a']);
  });

  it('should ignore extends and implements edges', () => {
    const edges: GraphEdge[] = [
      { source: 'a', target: 'b', type: 'extends' },
      { source: 'c', target: 'b', type: 'implements' },
    ];

    const map = buildCallerMap(edges);
    expect(map.size).toBe(0);
  });
});

describe('buildTestMap', () => {
  it('should return empty map when no test files', () => {
    const fileMap = new Map<string, readonly string[]>();
    fileMap.set('src/utils.ts', ['chunk-1']);

    const map = buildTestMap(fileMap);
    expect(map.size).toBe(0);
  });

  it('should map test files to source files', () => {
    const fileMap = new Map<string, readonly string[]>();
    fileMap.set('src/utils.ts', ['chunk-1']);
    fileMap.set('src/utils.test.ts', ['chunk-2', 'chunk-3']);

    const map = buildTestMap(fileMap);
    expect(map.get('src/utils.ts')).toEqual(['chunk-2', 'chunk-3']);
  });

  it('should handle .spec. files', () => {
    const fileMap = new Map<string, readonly string[]>();
    fileMap.set('src/parser.ts', ['chunk-1']);
    fileMap.set('src/parser.spec.ts', ['chunk-4']);

    const map = buildTestMap(fileMap);
    expect(map.get('src/parser.ts')).toEqual(['chunk-4']);
  });

  it('should handle multiple test files for same source', () => {
    const fileMap = new Map<string, readonly string[]>();
    fileMap.set('src/app.ts', ['chunk-1']);
    fileMap.set('src/app.test.ts', ['chunk-2']);
    fileMap.set('src/app.spec.ts', ['chunk-3']);

    const map = buildTestMap(fileMap);
    expect(map.get('src/app.ts')).toEqual(['chunk-2', 'chunk-3']);
  });

  it('should handle test files with different extensions', () => {
    const fileMap = new Map<string, readonly string[]>();
    fileMap.set('src/helper.js', ['chunk-1']);
    fileMap.set('src/helper.test.js', ['chunk-5']);

    const map = buildTestMap(fileMap);
    expect(map.get('src/helper.js')).toEqual(['chunk-5']);
  });
});
