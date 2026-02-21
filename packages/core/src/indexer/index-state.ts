import { createHash } from 'node:crypto';

/**
 * Represents the indexed state of a single file, including its content hash
 * and the chunk IDs that were produced from it.
 */
export interface IndexedFileState {
  filePath: string;
  contentHash: string;
  lastIndexedAt: Date;
  chunkIds: string[];
}

/**
 * Serialized form of IndexedFileState where dates are ISO strings.
 */
interface SerializedFileState {
  filePath: string;
  contentHash: string;
  lastIndexedAt: string;
  chunkIds: string[];
}

/**
 * Compute a deterministic SHA-256 hash of file content.
 */
export function computeFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Tracks which files have been indexed and their content hashes,
 * enabling incremental re-indexing by detecting what has changed.
 */
export class IndexState {
  private readonly store: Map<string, IndexedFileState>;

  constructor() {
    this.store = new Map();
  }

  /**
   * Retrieve the indexed state for a file, or undefined if not tracked.
   */
  getFileState(filePath: string): IndexedFileState | undefined {
    return this.store.get(filePath);
  }

  /**
   * Set or update the indexed state for a file.
   */
  setFileState(filePath: string, state: IndexedFileState): void {
    this.store.set(filePath, state);
  }

  /**
   * Remove a file from the index state (e.g., when it has been deleted).
   */
  removeFile(filePath: string): void {
    this.store.delete(filePath);
  }

  /**
   * Return all file paths currently tracked in the index state.
   */
  getAllFiles(): string[] {
    return [...this.store.keys()];
  }

  /**
   * Determine whether a file needs re-indexing.
   * Returns true if the file is not in the index or its content hash differs.
   */
  isDirty(filePath: string, currentHash: string): boolean {
    const existing = this.store.get(filePath);
    if (existing === undefined) {
      return true;
    }
    return existing.contentHash !== currentHash;
  }

  /**
   * Serialize the index state to a plain JSON-compatible object.
   */
  toJSON(): Record<string, SerializedFileState> {
    const result: Record<string, SerializedFileState> = {};
    for (const [key, value] of this.store) {
      result[key] = {
        filePath: value.filePath,
        contentHash: value.contentHash,
        lastIndexedAt: value.lastIndexedAt.toISOString(),
        chunkIds: [...value.chunkIds],
      };
    }
    return result;
  }

  /**
   * Deserialize an index state from a plain JSON object.
   */
  static fromJSON(data: Record<string, SerializedFileState>): IndexState {
    const state = new IndexState();
    for (const [key, value] of Object.entries(data)) {
      state.setFileState(key, {
        filePath: value.filePath,
        contentHash: value.contentHash,
        lastIndexedAt: new Date(value.lastIndexedAt),
        chunkIds: [...value.chunkIds],
      });
    }
    return state;
  }
}
