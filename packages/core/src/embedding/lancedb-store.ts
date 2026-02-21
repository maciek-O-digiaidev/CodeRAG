import { ok, err, type Result } from 'neverthrow';
import { StoreError, type VectorStore } from '../types/provider.js';
import * as lancedb from '@lancedb/lancedb';

const TABLE_NAME = 'chunks';
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_\-:.]+$/;

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
          content: (meta['content'] as string) ?? '',
          nl_summary: (meta['nl_summary'] as string) ?? '',
          chunk_type: (meta['chunk_type'] as string) ?? '',
          file_path: (meta['file_path'] as string) ?? '',
          language: (meta['language'] as string) ?? '',
          metadata: JSON.stringify(meta),
        };
      });

      const data = rows as unknown as Record<string, unknown>[];

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
  ): Promise<Result<{ id: string; score: number }[], StoreError>> {
    try {
      await this.ensureConnected();

      if (!this.table) {
        return ok([]);
      }

      const results = (await this.table
        .search(embedding)
        .limit(topK)
        .toArray()) as LanceDBQueryResult[];

      const mapped = results.map((row) => ({
        id: row.id,
        score: 1 / (1 + (row._distance ?? 0)),
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
