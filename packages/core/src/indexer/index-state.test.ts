import { describe, it, expect } from 'vitest';
import { IndexState, computeFileHash } from './index-state.js';
import type { IndexedFileState } from './index-state.js';

describe('computeFileHash', () => {
  it('should produce a deterministic SHA-256 hex hash', () => {
    const hash1 = computeFileHash('hello world');
    const hash2 = computeFileHash('hello world');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce different hashes for different content', () => {
    const hash1 = computeFileHash('content A');
    const hash2 = computeFileHash('content B');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', () => {
    const hash = computeFileHash('');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('IndexState', () => {
  function makeFileState(filePath: string, contentHash: string): IndexedFileState {
    return {
      filePath,
      contentHash,
      lastIndexedAt: new Date('2025-01-15T10:00:00Z'),
      chunkIds: ['chunk-1', 'chunk-2'],
    };
  }

  describe('setFileState / getFileState', () => {
    it('should store and retrieve file state', () => {
      const state = new IndexState();
      const fileState = makeFileState('src/main.ts', 'abc123');

      state.setFileState('src/main.ts', fileState);
      const retrieved = state.getFileState('src/main.ts');

      expect(retrieved).toEqual(fileState);
    });

    it('should return undefined for unknown files', () => {
      const state = new IndexState();
      expect(state.getFileState('nonexistent.ts')).toBeUndefined();
    });

    it('should overwrite existing state', () => {
      const state = new IndexState();
      const original = makeFileState('src/main.ts', 'hash-1');
      const updated = makeFileState('src/main.ts', 'hash-2');

      state.setFileState('src/main.ts', original);
      state.setFileState('src/main.ts', updated);

      const retrieved = state.getFileState('src/main.ts');
      expect(retrieved?.contentHash).toBe('hash-2');
    });
  });

  describe('removeFile', () => {
    it('should remove a tracked file', () => {
      const state = new IndexState();
      state.setFileState('src/main.ts', makeFileState('src/main.ts', 'hash'));

      state.removeFile('src/main.ts');

      expect(state.getFileState('src/main.ts')).toBeUndefined();
    });

    it('should be a no-op for untracked files', () => {
      const state = new IndexState();
      // Should not throw
      state.removeFile('nonexistent.ts');
      expect(state.getAllFiles()).toHaveLength(0);
    });
  });

  describe('getAllFiles', () => {
    it('should return all tracked file paths', () => {
      const state = new IndexState();
      state.setFileState('src/a.ts', makeFileState('src/a.ts', 'h1'));
      state.setFileState('src/b.ts', makeFileState('src/b.ts', 'h2'));
      state.setFileState('src/c.ts', makeFileState('src/c.ts', 'h3'));

      const files = state.getAllFiles();
      expect(files).toHaveLength(3);
      expect(files).toContain('src/a.ts');
      expect(files).toContain('src/b.ts');
      expect(files).toContain('src/c.ts');
    });

    it('should return empty array when no files tracked', () => {
      const state = new IndexState();
      expect(state.getAllFiles()).toEqual([]);
    });
  });

  describe('isDirty', () => {
    it('should return true for a file not in the index', () => {
      const state = new IndexState();
      expect(state.isDirty('new-file.ts', 'some-hash')).toBe(true);
    });

    it('should return false when hash matches', () => {
      const state = new IndexState();
      state.setFileState('src/main.ts', makeFileState('src/main.ts', 'matching-hash'));

      expect(state.isDirty('src/main.ts', 'matching-hash')).toBe(false);
    });

    it('should return true when hash differs', () => {
      const state = new IndexState();
      state.setFileState('src/main.ts', makeFileState('src/main.ts', 'old-hash'));

      expect(state.isDirty('src/main.ts', 'new-hash')).toBe(true);
    });
  });

  describe('toJSON / fromJSON roundtrip', () => {
    it('should serialize and deserialize correctly', () => {
      const state = new IndexState();
      const fileState1 = makeFileState('src/a.ts', 'hash-a');
      const fileState2: IndexedFileState = {
        filePath: 'src/b.ts',
        contentHash: 'hash-b',
        lastIndexedAt: new Date('2025-06-01T12:30:00Z'),
        chunkIds: ['c1', 'c2', 'c3'],
      };

      state.setFileState('src/a.ts', fileState1);
      state.setFileState('src/b.ts', fileState2);

      const json = state.toJSON();
      const restored = IndexState.fromJSON(json);

      expect(restored.getAllFiles()).toHaveLength(2);
      expect(restored.getFileState('src/a.ts')?.contentHash).toBe('hash-a');
      expect(restored.getFileState('src/b.ts')?.contentHash).toBe('hash-b');
      expect(restored.getFileState('src/b.ts')?.chunkIds).toEqual(['c1', 'c2', 'c3']);
    });

    it('should preserve Date objects through serialization', () => {
      const state = new IndexState();
      const date = new Date('2025-03-20T08:15:00Z');
      state.setFileState('file.ts', {
        filePath: 'file.ts',
        contentHash: 'h',
        lastIndexedAt: date,
        chunkIds: [],
      });

      const json = state.toJSON();
      const restored = IndexState.fromJSON(json);
      const restoredState = restored.getFileState('file.ts');

      expect(restoredState?.lastIndexedAt).toBeInstanceOf(Date);
      expect(restoredState?.lastIndexedAt.toISOString()).toBe(date.toISOString());
    });

    it('should handle empty state', () => {
      const state = new IndexState();
      const json = state.toJSON();
      const restored = IndexState.fromJSON(json);

      expect(restored.getAllFiles()).toEqual([]);
    });
  });
});
