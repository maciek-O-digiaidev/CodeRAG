import { resolve, relative } from 'node:path';
import { Result, ok, err } from 'neverthrow';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { FileChange, FileMetadata, GitClient } from './git-client.js';
import { GitError } from './git-client.js';

const STATUS_MAP: Record<string, FileChange['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
};

const SAFE_REF_PATTERN = /^[0-9a-f]{4,40}$/i;
const SAFE_BRANCH_PATTERN = /^[a-zA-Z0-9_/.#@-]+$/;

function isValidGitRef(ref: string): boolean {
  if (ref.startsWith('-')) return false;
  return SAFE_REF_PATTERN.test(ref) || SAFE_BRANCH_PATTERN.test(ref);
}

function parseStatusCode(code: string): FileChange['status'] {
  const prefix = code.charAt(0);
  return STATUS_MAP[prefix] ?? 'modified';
}

export class SimpleGitClient implements GitClient {
  private readonly git: SimpleGit;
  private readonly workDir: string;

  constructor(workDir: string) {
    this.workDir = resolve(workDir);
    this.git = simpleGit(this.workDir);
  }

  async getChangedFiles(since?: string): Promise<Result<FileChange[], GitError>> {
    try {
      if (since === undefined) {
        const raw = await this.git.raw(['ls-files']);
        const files = raw
          .trim()
          .split('\n')
          .filter((line: string) => line.length > 0)
          .map((filePath: string): FileChange => ({
            filePath,
            status: 'added',
          }));
        return ok(files);
      }

      if (!isValidGitRef(since)) {
        return err(new GitError(`Invalid git reference: ${since}`));
      }

      const raw = await this.git.raw(['diff', '--name-status', `${since}..HEAD`]);
      if (raw.trim().length === 0) {
        return ok([]);
      }

      const lines = raw.trim().split('\n');
      const changes: FileChange[] = [];

      for (const line of lines) {
        const parts = line.split('\t');
        const statusCode = parts[0];
        if (statusCode === undefined || parts[1] === undefined) {
          continue;
        }

        const status = parseStatusCode(statusCode);

        if (status === 'renamed') {
          const change: FileChange = {
            filePath: parts[2] ?? parts[1],
            status,
            oldPath: parts[1],
          };
          changes.push(change);
        } else {
          changes.push({
            filePath: parts[1],
            status,
          });
        }
      }

      return ok(changes);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new GitError(`Failed to get changed files: ${message}`));
    }
  }

  async getFileMetadata(filePath: string): Promise<Result<FileMetadata, GitError>> {
    try {
      const resolved = resolve(this.workDir, filePath);
      const rel = relative(this.workDir, resolved);
      if (rel.startsWith('..') || rel.startsWith('/')) {
        return err(new GitError(`Path escapes working directory: ${filePath}`));
      }

      const raw = await this.git.raw([
        'log',
        '-1',
        '--format=%H%x00%ai%x00%an',
        '--',
        filePath,
      ]);

      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return err(new GitError(`No git history found for file: ${filePath}`));
      }

      const parts = trimmed.split('\0');
      const commitHash = parts[0];
      const dateStr = parts[1];
      const author = parts[2];

      if (commitHash === undefined || dateStr === undefined || author === undefined) {
        return err(new GitError(`Unexpected git log format for file: ${filePath}`));
      }

      return ok({
        filePath,
        lastModified: new Date(dateStr),
        author,
        commitHash,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new GitError(`Failed to get file metadata: ${message}`));
    }
  }

  async getCurrentCommit(): Promise<Result<string, GitError>> {
    try {
      const hash = await this.git.revparse(['HEAD']);
      return ok(hash.trim());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new GitError(`Failed to get current commit: ${message}`));
    }
  }

  async isGitRepo(dir: string): Promise<Result<boolean, GitError>> {
    try {
      const git = simpleGit(dir);
      const result = await git.raw(['rev-parse', '--is-inside-work-tree']);
      return ok(result.trim() === 'true');
    } catch {
      return ok(false);
    }
  }
}
