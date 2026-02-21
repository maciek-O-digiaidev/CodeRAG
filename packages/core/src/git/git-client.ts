import type { Result } from 'neverthrow';

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileChange {
  filePath: string;
  status: FileChangeStatus;
  oldPath?: string;
}

export interface FileMetadata {
  filePath: string;
  lastModified: Date;
  author: string;
  commitHash: string;
}

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitClient {
  getChangedFiles(since?: string): Promise<Result<FileChange[], GitError>>;
  getFileMetadata(filePath: string): Promise<Result<FileMetadata, GitError>>;
  getCurrentCommit(): Promise<Result<string, GitError>>;
  isGitRepo(dir: string): Promise<Result<boolean, GitError>>;
}
