/**
 * Scans an existing CodeRAG index (LanceDB) to extract entity information
 * used for auto-generating benchmark queries with ground truth.
 *
 * All functions are pure where possible, taking data as input rather than
 * connecting to stores directly.
 */

import { ok, err, type Result } from 'neverthrow';
import { safeString, safeArray } from '../utils/safe-cast.js';
import type { ChunkType } from '../types/chunk.js';
import type { GraphEdge } from '../graph/dependency-graph.js';

/** A scanned entity extracted from the index. */
export interface ScannedEntity {
  readonly chunkId: string;
  readonly name: string;
  readonly chunkType: ChunkType;
  readonly filePath: string;
  readonly language: string;
  readonly nlSummary: string;
  readonly imports: readonly string[];
  readonly exports: readonly string[];
  readonly declarations: readonly string[];
}

/** Result of scanning the full index. */
export interface IndexScanResult {
  readonly entities: readonly ScannedEntity[];
  readonly totalChunks: number;
  /** Map from chunkId to ScannedEntity for quick lookup. */
  readonly entityMap: ReadonlyMap<string, ScannedEntity>;
  /** Map from entity name to chunk IDs that declare it. */
  readonly nameToChunkIds: ReadonlyMap<string, readonly string[]>;
  /** Map from file path to chunk IDs in that file. */
  readonly fileToChunkIds: ReadonlyMap<string, readonly string[]>;
}

export class IndexScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexScanError';
  }
}

const CHUNK_TYPES: readonly ChunkType[] = [
  'function', 'method', 'class', 'module', 'interface',
  'type_alias', 'config_block', 'import_block', 'doc',
] as const;

function toChunkType(value: string): ChunkType {
  const found = CHUNK_TYPES.find((t) => t === value);
  return found ?? 'function';
}

function toStringArray(value: unknown): string[] {
  const arr = safeArray(value, []);
  return arr.filter((item): item is string => typeof item === 'string');
}

/**
 * Convert raw index rows (from LanceDBStore.getAll()) into ScannedEntity objects.
 * This is a pure function that operates on already-fetched data.
 */
export function parseIndexRows(
  rows: readonly { id: string; metadata: Record<string, unknown> }[],
): Result<IndexScanResult, IndexScanError> {
  try {
    const entities: ScannedEntity[] = [];
    const entityMap = new Map<string, ScannedEntity>();
    const nameToChunkIds = new Map<string, string[]>();
    const fileToChunkIds = new Map<string, string[]>();

    for (const row of rows) {
      const meta = row.metadata;
      const name = safeString(meta['name'], '');
      const chunkType = toChunkType(safeString(meta['chunk_type'], 'function'));
      const filePath = safeString(meta['file_path'], '');
      const language = safeString(meta['language'], 'unknown');
      const nlSummary = safeString(meta['nl_summary'], '');
      const imports = toStringArray(meta['imports']);
      const exports = toStringArray(meta['exports']);
      const declarations = toStringArray(meta['declarations']);

      const entity: ScannedEntity = {
        chunkId: row.id,
        name,
        chunkType,
        filePath,
        language,
        nlSummary,
        imports,
        exports,
        declarations,
      };

      entities.push(entity);
      entityMap.set(row.id, entity);

      // Index by name (skip empty names)
      if (name.length > 0) {
        const existing = nameToChunkIds.get(name);
        if (existing) {
          existing.push(row.id);
        } else {
          nameToChunkIds.set(name, [row.id]);
        }
      }

      // Index by file path
      if (filePath.length > 0) {
        const existing = fileToChunkIds.get(filePath);
        if (existing) {
          existing.push(row.id);
        } else {
          fileToChunkIds.set(filePath, [row.id]);
        }
      }
    }

    return ok({
      entities,
      totalChunks: entities.length,
      entityMap,
      nameToChunkIds,
      fileToChunkIds,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return err(new IndexScanError(`Failed to parse index rows: ${message}`));
  }
}

/**
 * Build a caller map from graph edges.
 * Maps target chunkId to source chunkIds that reference it.
 */
export function buildCallerMap(
  edges: readonly GraphEdge[],
): ReadonlyMap<string, readonly string[]> {
  const callerMap = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.type === 'calls' || edge.type === 'references' || edge.type === 'imports') {
      const existing = callerMap.get(edge.target);
      if (existing) {
        existing.push(edge.source);
      } else {
        callerMap.set(edge.target, [edge.source]);
      }
    }
  }

  return callerMap;
}

/**
 * Build a test file map: maps source file paths to test file chunk IDs.
 * Heuristic: a file at `foo.test.ts` or `foo.spec.ts` is the test for `foo.ts`.
 */
export function buildTestMap(
  fileToChunkIds: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  const testMap = new Map<string, string[]>();

  for (const [filePath, chunkIds] of fileToChunkIds) {
    const isTestFile = /\.(test|spec)\.[^.]+$/.test(filePath);
    if (isTestFile) {
      // Derive the source file path
      const sourceFilePath = filePath.replace(/\.(test|spec)\./, '.');
      const existing = testMap.get(sourceFilePath);
      if (existing) {
        existing.push(...chunkIds);
      } else {
        testMap.set(sourceFilePath, [...chunkIds]);
      }
    }
  }

  return testMap;
}
