import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { SimpleGitClient } from './simple-git-client.js';
import { GitError } from './git-client.js';

describe('SimpleGitClient', () => {
  let tempDir: string;
  let client: SimpleGitClient;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'coderag-git-test-'));
    const git = simpleGit(tempDir);
    await git.init();
    await git.addConfig('user.email', 'test@coderag.dev');
    await git.addConfig('user.name', 'Test Author');
    // Disable GPG/SSH signing — avoids 1Password timeouts in CI/test
    await git.addConfig('commit.gpgSign', 'false');

    writeFileSync(join(tempDir, 'initial.txt'), 'initial content');
    await git.add('initial.txt');
    await git.commit('Initial commit');

    client = new SimpleGitClient(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isGitRepo', () => {
    it('should return true for a git repository', async () => {
      const result = await client.isGitRepo(tempDir);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false for a non-git directory', async () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), 'coderag-nogit-'));
      try {
        const result = await client.isGitRepo(nonGitDir);
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value).toBe(false);
        }
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('getCurrentCommit', () => {
    it('should return the current commit hash', async () => {
      const result = await client.getCurrentCommit();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatch(/^[0-9a-f]{40}$/);
      }
    });

    it('should return an error for a directory without commits', async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'coderag-empty-'));
      try {
        const git = simpleGit(emptyDir);
        await git.init();
        const emptyClient = new SimpleGitClient(emptyDir);
        const result = await emptyClient.getCurrentCommit();
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(GitError);
        }
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('getChangedFiles', () => {
    it('should list all tracked files when since is undefined', async () => {
      const result = await client.getChangedFiles();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const filePaths = result.value.map((f) => f.filePath);
        expect(filePaths).toContain('initial.txt');
      }
    });

    it('should detect added files since a commit', async () => {
      const git = simpleGit(tempDir);
      const beforeCommit = (await git.revparse(['HEAD'])).trim();

      writeFileSync(join(tempDir, 'newfile.ts'), 'export const x = 1;');
      await git.add('newfile.ts');
      await git.commit('Add new file');

      const result = await client.getChangedFiles(beforeCommit);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.filePath).toBe('newfile.ts');
        expect(result.value[0]?.status).toBe('added');
      }
    });

    it('should detect modified files since a commit', async () => {
      const git = simpleGit(tempDir);
      const beforeCommit = (await git.revparse(['HEAD'])).trim();

      writeFileSync(join(tempDir, 'initial.txt'), 'modified content');
      await git.add('initial.txt');
      await git.commit('Modify file');

      const result = await client.getChangedFiles(beforeCommit);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.filePath).toBe('initial.txt');
        expect(result.value[0]?.status).toBe('modified');
      }
    });

    it('should detect deleted files since a commit', async () => {
      const git = simpleGit(tempDir);
      const beforeCommit = (await git.revparse(['HEAD'])).trim();

      await git.rm('initial.txt');
      await git.commit('Delete file');

      const result = await client.getChangedFiles(beforeCommit);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.filePath).toBe('initial.txt');
        expect(result.value[0]?.status).toBe('deleted');
      }
    });

    it('should return empty array when no changes since commit', async () => {
      const git = simpleGit(tempDir);
      const currentCommit = (await git.revparse(['HEAD'])).trim();

      const result = await client.getChangedFiles(currentCommit);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return error for invalid since reference', async () => {
      const result = await client.getChangedFiles('invalid-ref-abc123');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(GitError);
        expect(result.error.message).toContain('Failed to get changed files');
      }
    });
  });

  describe('getFileMetadata', () => {
    it('should return metadata for a committed file', async () => {
      const result = await client.getFileMetadata('initial.txt');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.filePath).toBe('initial.txt');
        expect(result.value.author).toBe('Test Author');
        expect(result.value.commitHash).toMatch(/^[0-9a-f]{40}$/);
        expect(result.value.lastModified).toBeInstanceOf(Date);
        expect(result.value.lastModified.getTime()).not.toBeNaN();
      }
    });

    it('should return error for a file with no git history', async () => {
      const result = await client.getFileMetadata('nonexistent-file.ts');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(GitError);
        expect(result.error.message).toContain('No git history found');
      }
    });

    it('should return metadata from the latest commit for a file', async () => {
      const git = simpleGit(tempDir);

      writeFileSync(join(tempDir, 'initial.txt'), 'updated content');
      await git.add('initial.txt');
      await git.commit('Update initial file');

      const currentHash = (await git.revparse(['HEAD'])).trim();

      const result = await client.getFileMetadata('initial.txt');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.commitHash).toBe(currentHash);
      }
    });

    it('should reject path traversal attempts', async () => {
      const result = await client.getFileMetadata('../../etc/passwd');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(GitError);
        expect(result.error.message).toContain('Path escapes working directory');
      }
    });
  });

  describe('getChangedFiles security', () => {
    it('should reject invalid git references', async () => {
      const result = await client.getChangedFiles('--option-injection');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(GitError);
        expect(result.error.message).toContain('Invalid git reference');
      }
    });

    it('should accept valid hex commit hashes', async () => {
      const git = simpleGit(tempDir);
      const hash = (await git.revparse(['HEAD'])).trim();
      const result = await client.getChangedFiles(hash);
      expect(result.isOk()).toBe(true);
    });
  });
});
