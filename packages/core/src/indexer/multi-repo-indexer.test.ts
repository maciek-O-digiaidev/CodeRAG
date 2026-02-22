import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ok, err } from 'neverthrow';
import type { RepoConfig } from '../types/config.js';
import { MultiRepoIndexer } from './multi-repo-indexer.js';
import type { RepoProcessor } from './multi-repo-indexer.js';
import { IndexState } from './index-state.js';

describe('MultiRepoIndexer', () => {
  let tempDir: string;
  let storagePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'coderag-multi-repo-test-'));
    storagePath = join(tempDir, '.coderag');
    mkdirSync(storagePath, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createRepoDir(name: string, files: Record<string, string>): string {
    const repoDir = join(tempDir, name);
    mkdirSync(repoDir, { recursive: true });
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = join(repoDir, filePath);
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (dir !== repoDir) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(fullPath, content);
    }
    return repoDir;
  }

  describe('indexAll', () => {
    it('should handle single repo (backwards compatible)', async () => {
      const repoDir = createRepoDir('my-repo', {
        'main.ts': 'export const x = 1;',
      });

      const repos: RepoConfig[] = [{ path: repoDir, name: 'my-repo' }];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      const result = await indexer.indexAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.repoResults).toHaveLength(1);
        expect(result.value.repoResults[0]?.repoName).toBe('my-repo');
        expect(result.value.repoResults[0]?.filesProcessed).toBe(1);
        expect(result.value.repoResults[0]?.errors).toEqual([]);
      }
    });

    it('should iterate multiple repos', async () => {
      const repo1Dir = createRepoDir('repo-a', {
        'a.ts': 'export const a = 1;',
        'b.ts': 'export const b = 2;',
      });
      const repo2Dir = createRepoDir('repo-b', {
        'c.ts': 'export const c = 3;',
      });

      const repos: RepoConfig[] = [
        { path: repo1Dir, name: 'repo-a' },
        { path: repo2Dir, name: 'repo-b' },
      ];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      const result = await indexer.indexAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.repoResults).toHaveLength(2);

        const repoA = result.value.repoResults.find((r) => r.repoName === 'repo-a');
        const repoB = result.value.repoResults.find((r) => r.repoName === 'repo-b');

        expect(repoA).toBeDefined();
        expect(repoA?.filesProcessed).toBe(2);
        expect(repoA?.errors).toEqual([]);

        expect(repoB).toBeDefined();
        expect(repoB?.filesProcessed).toBe(1);
        expect(repoB?.errors).toEqual([]);
      }
    });

    it('should store per-repo independent index state', async () => {
      const repo1Dir = createRepoDir('repo-one', {
        'file1.ts': 'const one = 1;',
      });
      const repo2Dir = createRepoDir('repo-two', {
        'file2.ts': 'const two = 2;',
      });

      const repos: RepoConfig[] = [
        { path: repo1Dir, name: 'repo-one' },
        { path: repo2Dir, name: 'repo-two' },
      ];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      const result = await indexer.indexAll();
      expect(result.isOk()).toBe(true);

      // Verify separate index-state.json files exist
      const state1Path = join(storagePath, 'repo-one', 'index-state.json');
      const state2Path = join(storagePath, 'repo-two', 'index-state.json');

      expect(existsSync(state1Path)).toBe(true);
      expect(existsSync(state2Path)).toBe(true);

      // Verify they contain the correct files
      const state1 = IndexState.fromJSON(
        JSON.parse(readFileSync(state1Path, 'utf-8')) as Parameters<typeof IndexState.fromJSON>[0],
      );
      const state2 = IndexState.fromJSON(
        JSON.parse(readFileSync(state2Path, 'utf-8')) as Parameters<typeof IndexState.fromJSON>[0],
      );

      expect(state1.getAllFiles()).toContain('file1.ts');
      expect(state1.getFileState('file2.ts')).toBeUndefined();

      expect(state2.getAllFiles()).toContain('file2.ts');
      expect(state2.getFileState('file1.ts')).toBeUndefined();
    });

    it('should pass repoName to processor for setting in chunk metadata', async () => {
      const repoDir = createRepoDir('test-repo', {
        'app.ts': 'export function main() {}',
      });

      const repos: RepoConfig[] = [{ path: repoDir, name: 'test-repo' }];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      const receivedRepoNames: string[] = [];
      const processor: RepoProcessor = async (repoName, _repoPath, _files, _state, _storage) => {
        receivedRepoNames.push(repoName);
        return ok(5); // 5 chunks created
      };

      const result = await indexer.indexAll({}, processor);

      expect(result.isOk()).toBe(true);
      expect(receivedRepoNames).toEqual(['test-repo']);
      if (result.isOk()) {
        expect(result.value.repoResults[0]?.chunksCreated).toBe(5);
      }
    });

    it('should not stop on error in one repo', async () => {
      const repo1Dir = createRepoDir('good-repo', {
        'ok.ts': 'export const ok = true;',
      });
      // Use a non-existent path to cause an error
      const badRepoPath = join(tempDir, 'non-existent-repo');

      const repos: RepoConfig[] = [
        { path: badRepoPath, name: 'bad-repo' },
        { path: repo1Dir, name: 'good-repo' },
      ];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      const result = await indexer.indexAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.repoResults).toHaveLength(2);

        const badRepo = result.value.repoResults.find((r) => r.repoName === 'bad-repo');
        const goodRepo = result.value.repoResults.find((r) => r.repoName === 'good-repo');

        expect(badRepo).toBeDefined();
        expect(badRepo?.errors.length).toBeGreaterThan(0);

        expect(goodRepo).toBeDefined();
        expect(goodRepo?.filesProcessed).toBe(1);
        expect(goodRepo?.errors).toEqual([]);
      }
    });

    it('should handle empty repos array', async () => {
      const repos: RepoConfig[] = [];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      const result = await indexer.indexAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.repoResults).toEqual([]);
      }
    });

    it('should derive repo name from path when name is not set', async () => {
      const repoDir = createRepoDir('derived-name', {
        'x.ts': 'const x = 1;',
      });

      const repos: RepoConfig[] = [{ path: repoDir }];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      const result = await indexer.indexAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.repoResults[0]?.repoName).toBe('derived-name');
      }
    });

    it('should support incremental indexing per repo independently', async () => {
      const repo1Dir = createRepoDir('incr-repo', {
        'stable.ts': 'const stable = true;',
      });

      const repos: RepoConfig[] = [{ path: repo1Dir, name: 'incr-repo' }];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      // First indexing run
      const firstResult = await indexer.indexAll();
      expect(firstResult.isOk()).toBe(true);
      if (firstResult.isOk()) {
        expect(firstResult.value.repoResults[0]?.filesProcessed).toBe(1);
      }

      // Second indexing run without changes - should process 0 files (incremental)
      const secondResult = await indexer.indexAll();
      expect(secondResult.isOk()).toBe(true);
      if (secondResult.isOk()) {
        expect(secondResult.value.repoResults[0]?.filesProcessed).toBe(0);
      }

      // Modify a file and re-index - should detect change
      writeFileSync(join(repo1Dir, 'stable.ts'), 'const stable = false;');
      const thirdResult = await indexer.indexAll();
      expect(thirdResult.isOk()).toBe(true);
      if (thirdResult.isOk()) {
        expect(thirdResult.value.repoResults[0]?.filesProcessed).toBe(1);
      }
    });

    it('should report per-repo progress via callback', async () => {
      const repoDir = createRepoDir('progress-repo', {
        'p.ts': 'const p = 1;',
      });

      const repos: RepoConfig[] = [{ path: repoDir, name: 'progress-repo' }];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      const progressUpdates: Array<{ repoName: string; status: string }> = [];
      const onProgress = (repoName: string, status: string): void => {
        progressUpdates.push({ repoName, status });
      };

      await indexer.indexAll({ onProgress });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0]?.repoName).toBe('progress-repo');
      expect(progressUpdates.some((p) => p.status === 'Done')).toBe(true);
    });

    it('should support full reindex ignoring prior state', async () => {
      const repoDir = createRepoDir('full-repo', {
        'f.ts': 'const f = 1;',
      });

      const repos: RepoConfig[] = [{ path: repoDir, name: 'full-repo' }];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      // First run
      await indexer.indexAll();

      // Full re-index should process all files again
      const fullResult = await indexer.indexAll({ full: true });
      expect(fullResult.isOk()).toBe(true);
      if (fullResult.isOk()) {
        expect(fullResult.value.repoResults[0]?.filesProcessed).toBe(1);
      }
    });

    it('should handle processor returning error', async () => {
      const repoDir = createRepoDir('err-repo', {
        'e.ts': 'const e = 1;',
      });

      const repos: RepoConfig[] = [{ path: repoDir, name: 'err-repo' }];
      const indexer = new MultiRepoIndexer(repos, storagePath);

      const processor: RepoProcessor = async () => {
        return err(new Error('Processing failed'));
      };

      const result = await indexer.indexAll({}, processor);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.repoResults[0]?.errors).toContain('Processing failed');
      }
    });
  });
});
