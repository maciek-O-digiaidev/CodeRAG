import { ok, err, type Result } from 'neverthrow';
import { StoreError, type VectorStore } from '../types/provider.js';
import * as lancedb from '@lancedb/lancedb';
import { safeString, safeRecord } from '../utils/safe-cast.js';

const TABLE_NAME = 'chunks';
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_\-:.]+$/;

function safeParseJSON(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return safeRecord(parsed, {});
  } catch {
    return {};
  }
}

interface LanceDBRow {
  id: string;
  vector: number[];
  content: string;
  nl_summary: string;
  chunk_type: string;
  file_path: string;
  language: string;
  metadata: string;
}

interface LanceDBQueryResult {
  id: string;
  vector: number[];
  content: string;
  nl_summary: string;
  chunk_type: string;
  file_path: string;
  language: string;
  metadata: string;
  _distance: number;
}

function validateId(id: string): boolean {
  return SAFE_ID_PATTERN.test(id) && id.length > 0 && id.length <= 256;
}

/** Convert raw LanceDB toArray() rows into typed LanceDBQueryResult[]. */
function toLanceDBQueryResults(rows: unknown[]): LanceDBQueryResult[] {
  return rows.map((row) => {
    const r = safeRecord(row, {});
    return {
      id: safeString(r['id'], ''),
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Array.isArray guard; LanceDB stores vectors as number[]
      vector: Array.isArray(r['vector']) ? (r['vector'] as number[]) : [],
      content: safeString(r['content'], ''),
      nl_summary: safeString(r['nl_summary'], ''),
      chunk_type: safeString(r['chunk_type'], ''),
      file_path: safeString(r['file_path'], ''),
      language: safeString(r['language'], ''),
      metadata: safeString(r['metadata'], '{}'),
      _distance: typeof r['_distance'] === 'number' ? r['_distance'] : 0,
    };
  });
}

export class LanceDBStore implements VectorStore {
  private readonly storagePath: string;
  private readonly _dimensions: number;
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;

  constructor(storagePath: string, dimensions: number) {
    this.storagePath = storagePath;
    this._dimensions = dimensions;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async connect(): Promise<void> {
    const dbPath = `${this.storagePath}/lancedb`;
    this.db = await lancedb.connect(dbPath);

    try {
      const tableNames = await this.db.tableNames();
      if (tableNames.includes(TABLE_NAME)) {
        this.table = await this.db.openTable(TABLE_NAME);
      }
    } catch {
      // Table does not exist yet, will be created on first upsert
      this.table = null;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.db) {
      await this.connect();
    }
  }

  async upsert(
    ids: string[],
    embeddings: number[][],
    metadata: Record<string, unknown>[],
  ): Promise<Result<void, StoreError>> {
    try {
      for (const id of ids) {
        if (!validateId(id)) {
          return err(new StoreError(`Invalid chunk ID: ${id}`));
        }
      }

      await this.ensureConnected();

      const rows: LanceDBRow[] = ids.map((id, i) => {
        const meta = metadata[i] ?? {};
        return {
          id,
          vector: embeddings[i] ?? [],
          content: safeString(meta['content'], ''),
          nl_summary: safeString(meta['nl_summary'], ''),
          chunk_type: safeString(meta['chunk_type'], ''),
          file_path: safeString(meta['file_path'], ''),
          language: safeString(meta['language'], ''),
          metadata: JSON.stringify(meta),
        };
      });

      // Justified cast: LanceDB API requires Record<string, unknown>[] but rows satisfy this structurally
      const data: Record<string, unknown>[] = rows.map((row) => ({ ...row }));

      if (!this.table) {
        this.table = await this.db!.createTable(TABLE_NAME, data);
      } else {
        // Batch delete existing rows, then add new ones
        if (ids.length > 0) {
          const filterParts = ids.map((id) => `'${id}'`);
          const filter = `id IN (${filterParts.join(', ')})`;
          try {
            await this.table.delete(filter);
          } catch {
            // Rows may not exist, that's fine
          }
        }
        await this.table.add(data);
      }

      return ok(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`LanceDB upsert failed: ${message}`));
    }
  }

  async query(
    embedding: number[],
    topK: number,
  ): Promise<Result<{ id: string; score: number; metadata?: Record<string, unknown> }[], StoreError>> {
    try {
      await this.ensureConnected();

      if (!this.table) {
        return ok([]);
      }

      const rawResults: unknown[] = await this.table
        .search(embedding)
        .limit(topK)
        .toArray();
      const results = toLanceDBQueryResults(rawResults);

      const mapped = results.map((row) => ({
        id: row.id,
        score: 1 / (1 + (row._distance ?? 0)),
        metadata: {
          content: row.content,
          nl_summary: row.nl_summary,
          chunk_type: row.chunk_type,
          file_path: row.file_path,
          language: row.language,
          ...(row.metadata ? safeParseJSON(row.metadata) : {}),
        },
      }));

      return ok(mapped);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`LanceDB query failed: ${message}`));
    }
  }

  async delete(ids: string[]): Promise<Result<void, StoreError>> {
    try {
      for (const id of ids) {
        if (!validateId(id)) {
          return err(new StoreError(`Invalid chunk ID: ${id}`));
        }
      }

      await this.ensureConnected();

      if (!this.table || ids.length === 0) {
        return ok(undefined);
      }

      const filterParts = ids.map((id) => `'${id}'`);
      const filter = `id IN (${filterParts.join(', ')})`;
      await this.table.delete(filter);

      return ok(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`LanceDB delete failed: ${message}`));
    }
  }

  async count(): Promise<Result<number, StoreError>> {
    try {
      await this.ensureConnected();

      if (!this.table) {
        return ok(0);
      }

      const rows = await this.table.countRows();
      return ok(rows);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`LanceDB count failed: ${message}`));
    }
  }

  async getById(id: string): Promise<Result<{ id: string; metadata: Record<string, unknown> } | undefined, StoreError>> {
    try {
      if (!validateId(id)) {
        return err(new StoreError(`Invalid chunk ID: ${id}`));
      }

      await this.ensureConnected();

      if (!this.table) {
        return ok(undefined);
      }

      const filter = `id = '${id}'`;
      const rows = (await this.table.query().where(filter).limit(1).toArray()) as LanceDBRow[];

      if (rows.length === 0) {
        return ok(undefined);
      }

      const row = rows[0]!;
      return ok({
        id: row.id,
        metadata: {
          content: row.content,
          nl_summary: row.nl_summary,
          chunk_type: row.chunk_type,
          file_path: row.file_path,
          language: row.language,
          ...(row.metadata ? safeParseJSON(row.metadata) : {}),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`LanceDB getById failed: ${message}`));
    }
  }

  /**
   * Scan all rows from the table.
   * Returns an array of { id, metadata } objects (no vectors).
   * Useful for index analysis and benchmark generation.
   */
  async getAll(limit?: number): Promise<Result<{ id: string; metadata: Record<string, unknown> }[], StoreError>> {
    try {
      await this.ensureConnected();

      if (!this.table) {
        return ok([]);
      }

      let query = this.table.query();
      if (limit !== undefined && limit > 0) {
        query = query.limit(limit);
      }
      const rawRows: unknown[] = await query.toArray();

      const results = rawRows.map((row) => {
        const r = safeRecord(row, {});
        const id = safeString(r['id'], '');
        const content = safeString(r['content'], '');
        const nlSummary = safeString(r['nl_summary'], '');
        const chunkType = safeString(r['chunk_type'], '');
        const filePath = safeString(r['file_path'], '');
        const language = safeString(r['language'], '');
        const metaStr = safeString(r['metadata'], '{}');

        return {
          id,
          metadata: {
            content,
            nl_summary: nlSummary,
            chunk_type: chunkType,
            file_path: filePath,
            language,
            ...safeParseJSON(metaStr),
          },
        };
      });

      return ok(results);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`LanceDB getAll failed: ${message}`));
    }
  }

  close(): void {
    if (this.table) {
      this.table.close();
      this.table = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
