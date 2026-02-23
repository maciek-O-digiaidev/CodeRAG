import { ok, err, type Result } from 'neverthrow';
import { StoreError, type VectorStore } from '../types/provider.js';
import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantConfig {
  url?: string;
  collectionName?: string;
  apiKey?: string;
}

const DEFAULT_URL = 'http://localhost:6333';
const DEFAULT_COLLECTION = 'coderag';
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_\-:.]+$/;

function validateId(id: string): boolean {
  return SAFE_ID_PATTERN.test(id) && id.length > 0 && id.length <= 256;
}

/**
 * Deterministic numeric hash for a string ID.
 * Qdrant requires point IDs to be either unsigned integers or UUIDs.
 * We use a string-based UUID-like ID by leveraging Qdrant's named ID support,
 * but the simplest compatible approach is to store our string ID in the payload
 * and use a numeric hash as the point ID.
 *
 * We use a simple FNV-1a-like hash mapped to a positive integer.
 */
function stringToPointId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  // Ensure positive non-zero integer
  return (hash >>> 0) || 1;
}

export class QdrantVectorStore implements VectorStore {
  private readonly url: string;
  private readonly collectionName: string;
  private readonly _dimensions: number;
  private readonly apiKey?: string;
  private client: QdrantClient | null = null;
  private collectionReady = false;

  constructor(dimensions: number, config?: QdrantConfig) {
    this._dimensions = dimensions;
    this.url = config?.url ?? DEFAULT_URL;
    this.collectionName = config?.collectionName ?? DEFAULT_COLLECTION;
    this.apiKey = config?.apiKey;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async connect(): Promise<void> {
    this.client = new QdrantClient({
      url: this.url,
      apiKey: this.apiKey,
      checkCompatibility: false,
    });

    // Create collection if it doesn't exist
    try {
      const exists = await this.client.collectionExists(this.collectionName);
      if (!exists.exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this._dimensions,
            distance: 'Cosine',
          },
        });
      }
      this.collectionReady = true;
    } catch {
      // Collection may already exist from a prior run
      this.collectionReady = true;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client) {
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

      if (ids.length === 0) {
        return ok(undefined);
      }

      const points = ids.map((id, i) => ({
        id: stringToPointId(id),
        vector: embeddings[i] ?? [],
        payload: {
          _coderag_id: id,
          ...(metadata[i] ?? {}),
        },
      }));

      await this.client!.upsert(this.collectionName, {
        wait: true,
        points,
      });

      return ok(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`Qdrant upsert failed: ${message}`));
    }
  }

  async query(
    embedding: number[],
    topK: number,
  ): Promise<Result<{ id: string; score: number; metadata?: Record<string, unknown> }[], StoreError>> {
    try {
      await this.ensureConnected();

      if (!this.collectionReady) {
        return ok([]);
      }

      const results = await this.client!.search(this.collectionName, {
        vector: embedding,
        limit: topK,
        with_payload: true,
      });

      const mapped = results.map((point) => {
        const payload = point.payload ?? {};
        const id = (payload['_coderag_id'] as string) ?? String(point.id);
        const { _coderag_id: _, ...metadata } = payload as Record<string, unknown>;
        return {
          id,
          score: point.score,
          metadata,
        };
      });

      return ok(mapped);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`Qdrant query failed: ${message}`));
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

      if (ids.length === 0) {
        return ok(undefined);
      }

      const pointIds = ids.map((id) => stringToPointId(id));

      await this.client!.delete(this.collectionName, {
        wait: true,
        points: pointIds,
      });

      return ok(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`Qdrant delete failed: ${message}`));
    }
  }

  async count(): Promise<Result<number, StoreError>> {
    try {
      await this.ensureConnected();

      if (!this.collectionReady) {
        return ok(0);
      }

      const result = await this.client!.count(this.collectionName, {
        exact: true,
      });

      return ok(result.count);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`Qdrant count failed: ${message}`));
    }
  }

  close(): void {
    this.client = null;
    this.collectionReady = false;
  }
}
