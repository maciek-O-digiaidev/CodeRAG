import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ok, type Result } from 'neverthrow';
import type { GitClient, FileChange, FileMetadata } from '../git/git-client.js';
import { GitError } from '../git/git-client.js';
import { IndexState, computeFileHash } from './index-state.js';
import { IncrementalIndexer } from './incremental-indexer.js';
import type { IndexerConfig, ChangeSet } from './incremental-indexer.js';

/**
 * Minimal mock of GitClient that satisfies the interface.
 * The IncrementalIndexer currently relies on FileScanner rather than
 * GitClient for change detection, but the interface requires it.
 */
function createMockGitClient(): GitClient {
  return {
    async getChangedFiles(_since?: string): Promise<Result<FileChange[], GitError>> {
      return ok([]);
    },
    async getFileMetadata(filePath: string): Promise<Result<FileMetadata, GitError>> {
      return ok({
        filePath,
        lastModified: new Date(),
        author: 'test',
        commitHash: 'abc123',
      });
    },
    async getCurrentCommit(): Promise<Result<string, GitError>> {
      return ok('abc123def456');
    },
    async isGitRepo(_dir: string): Promise<Result<boolean, GitError>> {
      return ok(true);
    },
  };
}

describe('IncrementalIndexer', () => {
  let tempDir: string;
  let config: IndexerConfig;
  let gitClient: GitClient;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'coderag-indexer-test-'));
    config = {
      rootDir: tempDir,
      maxTokensPerChunk: 500,
      concurrency: 2,
    };
    gitClient = createMockGitClient();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectChanges', () => {
    it('should detect new files when state is empty', async () => {
      writeFileSync(join(tempDir, 'main.ts'), 'export const x = 1;');
      writeFileSync(join(tempDir, 'util.ts'), 'export function add() {}');

      const state = new IndexState();
      const indexer = new IncrementalIndexer(config, gitClient, state);

      const result = await indexer.detectChanges();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.added.sort()).toEqual(['main.ts', 'util.ts']);
        expect(result.value.modified).toEqual([]);
        expect(result.value.deleted).toEqual([]);
      }
    });

    it('should detect modified files when content hash changes', async () => {
      const originalContent = 'export const x = 1;';
      const newContent = 'export const x = 2;';

      writeFileSync(join(tempDir, 'main.ts'), newContent);

      const state = new IndexState();
      state.setFileState('main.ts', {
        filePath: 'main.ts',
        contentHash: computeFileHash(originalContent),
        lastIndexedAt: new Date(),
        chunkIds: ['old-chunk'],
      });

      const indexer = new IncrementalIndexer(config, gitClient, state);
      const result = await indexer.detectChanges();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.added).toEqual([]);
        expect(result.value.modified).toEqual(['main.ts']);
        expect(result.value.deleted).toEqual([]);
      }
    });

    it('should detect deleted files', async () => {
      // State has a file that no longer exists on disk
      const state = new IndexState();
      state.setFileState('deleted.ts', {
        filePath: 'deleted.ts',
        contentHash: 'some-hash',
        lastIndexedAt: new Date(),
        chunkIds: ['chunk-1'],
      });

      const indexer = new IncrementalIndexer(config, gitClient, state);
      const result = await indexer.detectChanges();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.added).toEqual([]);
        expect(result.value.modified).toEqual([]);
        expect(result.value.deleted).toEqual(['deleted.ts']);
      }
    });

    it('should report no changes when state matches filesystem', async () => {
      const content = 'export const x = 1;';
      writeFileSync(join(tempDir, 'main.ts'), content);

      const state = new IndexState();
      state.setFileState('main.ts', {
        filePath: 'main.ts',
        contentHash: computeFileHash(content),
        lastIndexedAt: new Date(),
        chunkIds: ['chunk-1'],
      });

      const indexer = new IncrementalIndexer(config, gitClient, state);
      const result = await indexer.detectChanges();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.added).toEqual([]);
        expect(result.value.modified).toEqual([]);
        expect(result.value.deleted).toEqual([]);
      }
    });

    it('should detect a mix of added, modified, and deleted files', async () => {
      const existingContent = 'export const y = 2;';
      const modifiedContent = 'export const y = 999;';

      writeFileSync(join(tempDir, 'existing.ts'), modifiedContent);
      writeFileSync(join(tempDir, 'brand-new.ts'), 'new file');

      const state = new IndexState();
      state.setFileState('existing.ts', {
        filePath: 'existing.ts',
        contentHash: computeFileHash(existingContent),
        lastIndexedAt: new Date(),
        chunkIds: ['c1'],
      });
      state.setFileState('gone.ts', {
        filePath: 'gone.ts',
        contentHash: 'old',
        lastIndexedAt: new Date(),
        chunkIds: ['c2'],
      });

      const indexer = new IncrementalIndexer(config, gitClient, state);
      const result = await indexer.detectChanges();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.added).toEqual(['brand-new.ts']);
        expect(result.value.modified).toEqual(['existing.ts']);
        expect(result.value.deleted).toEqual(['gone.ts']);
      }
    });
  });

  describe('reindex', () => {
    it('should process added files and update state', async () => {
      writeFileSync(join(tempDir, 'new-file.ts'), 'export const z = 42;');

      const state = new IndexState();
      const indexer = new IncrementalIndexer(config, gitClient, state);

      const changes: ChangeSet = {
        added: ['new-file.ts'],
        modified: [],
        deleted: [],
      };

      const result = await indexer.reindex(changes);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.added).toEqual(['new-file.ts']);
        expect(result.value.modified).toEqual([]);
        expect(result.value.deleted).toEqual([]);
        expect(result.value.totalChunks).toBeGreaterThan(0);
        expect(result.value.duration).toBeGreaterThanOrEqual(0);
      }

      // Verify state was updated
      const fileState = state.getFileState('new-file.ts');
      expect(fileState).toBeDefined();
      expect(fileState?.chunkIds.length).toBeGreaterThan(0);
    });

    it('should process modified files and update state', async () => {
      const newContent = 'export const z = 99;';
      writeFileSync(join(tempDir, 'modified.ts'), newContent);

      const state = new IndexState();
      state.setFileState('modified.ts', {
        filePath: 'modified.ts',
        contentHash: 'old-hash',
        lastIndexedAt: new Date('2025-01-01'),
        chunkIds: ['old-chunk'],
      });

      const indexer = new IncrementalIndexer(config, gitClient, state);

      const changes: ChangeSet = {
        added: [],
        modified: ['modified.ts'],
        deleted: [],
      };

      const result = await indexer.reindex(changes);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.modified).toEqual(['modified.ts']);
      }

      // Verify state was updated with new hash
      const fileState = state.getFileState('modified.ts');
      expect(fileState).toBeDefined();
      expect(fileState?.contentHash).toBe(computeFileHash(newContent));
    });

    it('should remove deleted files from state', async () => {
      const state = new IndexState();
      state.setFileState('deleted.ts', {
        filePath: 'deleted.ts',
        contentHash: 'hash',
        lastIndexedAt: new Date(),
        chunkIds: ['c1'],
      });

      const indexer = new IncrementalIndexer(config, gitClient, state);

      const changes: ChangeSet = {
        added: [],
        modified: [],
        deleted: ['deleted.ts'],
      };

      const result = await indexer.reindex(changes);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.deleted).toEqual(['deleted.ts']);
      }

      // Verify file was removed from state
      expect(state.getFileState('deleted.ts')).toBeUndefined();
    });

    it('should track unchanged files', async () => {
      const content = 'export const stable = true;';
      writeFileSync(join(tempDir, 'stable.ts'), content);
      writeFileSync(join(tempDir, 'new.ts'), 'new');

      const state = new IndexState();
      state.setFileState('stable.ts', {
        filePath: 'stable.ts',
        contentHash: computeFileHash(content),
        lastIndexedAt: new Date(),
        chunkIds: ['existing-chunk'],
      });

      const indexer = new IncrementalIndexer(config, gitClient, state);

      const changes: ChangeSet = {
        added: ['new.ts'],
        modified: [],
        deleted: [],
      };

      const result = await indexer.reindex(changes);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.unchanged).toContain('stable.ts');
        // 1 existing chunk from stable.ts + 1 new chunk from new.ts
        expect(result.value.totalChunks).toBe(2);
      }
    });

    it('should handle empty change set', async () => {
      const state = new IndexState();
      const indexer = new IncrementalIndexer(config, gitClient, state);

      const changes: ChangeSet = {
        added: [],
        modified: [],
        deleted: [],
      };

      const result = await indexer.reindex(changes);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.added).toEqual([]);
        expect(result.value.modified).toEqual([]);
        expect(result.value.deleted).toEqual([]);
        expect(result.value.unchanged).toEqual([]);
        expect(result.value.totalChunks).toBe(0);
      }
    });
  });
});
