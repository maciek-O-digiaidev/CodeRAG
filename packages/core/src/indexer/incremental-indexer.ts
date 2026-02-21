import { ok, err, type Result } from 'neverthrow';
import type { GitClient } from '../git/git-client.js';
import { IndexState, computeFileHash } from './index-state.js';
import { FileScanner } from './file-scanner.js';

/**
 * Configuration for the IncrementalIndexer.
 */
export interface IndexerConfig {
  /** Root directory of the project to index. */
  rootDir: string;
  /** Maximum tokens per chunk (passed through to chunker). */
  maxTokensPerChunk: number;
  /** Maximum number of files to process concurrently. */
  concurrency: number;
}

/**
 * The set of file changes detected between the current filesystem state
 * and the previously indexed state.
 */
export interface ChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
}

/**
 * Summary of an indexing run.
 */
export interface IndexerResult {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
  totalChunks: number;
  duration: number;
}

/**
 * Error type for indexer operations.
 */
export class IndexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexerError';
  }
}

/**
 * Orchestrates incremental re-indexing by detecting which files have changed
 * since the last indexing run and processing only those files.
 *
 * Current scope: detect changes, scan files, compute hashes, and update state.
 * Embedding and storage integration is planned for Sprint 2.
 */
export class IncrementalIndexer {
  private readonly config: IndexerConfig;
  private readonly gitClient: GitClient;
  private readonly state: IndexState;

  constructor(config: IndexerConfig, gitClient: GitClient, state: IndexState) {
    this.config = config;
    this.gitClient = gitClient;
    this.state = state;
  }

  /**
   * Detect which files have been added, modified, or deleted since the last
   * indexing run by comparing the current filesystem state against IndexState.
   */
  async detectChanges(): Promise<Result<ChangeSet, IndexerError>> {
    try {
      // Validate that root directory is a git repo
      const repoCheck = await this.gitClient.isGitRepo(this.config.rootDir);
      if (repoCheck.isErr()) {
        return err(new IndexerError(`Git check failed: ${repoCheck.error.message}`));
      }

      const scanner = new FileScanner(this.config.rootDir, () => false);
      const scanResult = await scanner.scanFiles();

      if (scanResult.isErr()) {
        return err(new IndexerError(`Scan failed: ${scanResult.error.message}`));
      }

      const scannedFiles = scanResult.value;
      const currentFilePaths = new Set(scannedFiles.map((f) => f.filePath));
      const previousFilePaths = new Set(this.state.getAllFiles());

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];

      // Check scanned files against index state
      for (const file of scannedFiles) {
        if (!previousFilePaths.has(file.filePath)) {
          added.push(file.filePath);
        } else if (this.state.isDirty(file.filePath, file.contentHash)) {
          modified.push(file.filePath);
        }
      }

      // Check for deleted files
      for (const filePath of previousFilePaths) {
        if (!currentFilePaths.has(filePath)) {
          deleted.push(filePath);
        }
      }

      return ok({ added, modified, deleted });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new IndexerError(`Failed to detect changes: ${message}`));
    }
  }

  /**
   * Process a set of changes: read file contents, compute hashes,
   * generate placeholder chunk IDs, and update the index state.
   *
   * Note: actual parsing and chunking via TreeSitterParser + ASTChunker
   * will be integrated in Sprint 2. For now, this tracks state and
   * produces a simple per-file chunk placeholder.
   */
  async reindex(changes: ChangeSet): Promise<Result<IndexerResult, IndexerError>> {
    const startTime = Date.now();

    try {
      const unchanged = this.state
        .getAllFiles()
        .filter(
          (f) =>
            !changes.added.includes(f) &&
            !changes.modified.includes(f) &&
            !changes.deleted.includes(f),
        );

      // Process added and modified files
      const filesToProcess = [...changes.added, ...changes.modified];
      let totalChunks = 0;

      // Count existing chunks from unchanged files
      for (const filePath of unchanged) {
        const fileState = this.state.getFileState(filePath);
        if (fileState) {
          totalChunks += fileState.chunkIds.length;
        }
      }

      // Read and index changed files
      const scanner = new FileScanner(this.config.rootDir, () => false);
      const scanResult = await scanner.scanFiles();

      if (scanResult.isErr()) {
        return err(new IndexerError(`Scan failed during reindex: ${scanResult.error.message}`));
      }

      const scannedByPath = new Map(scanResult.value.map((f) => [f.filePath, f]));

      for (const filePath of filesToProcess) {
        const scanned = scannedByPath.get(filePath);
        if (scanned === undefined) {
          continue;
        }

        // Generate a placeholder chunk ID for this file.
        // Full parsing + chunking integration will replace this in Sprint 2.
        const chunkId = computeFileHash(`${filePath}:${scanned.contentHash}`);
        const chunkIds = [chunkId];

        this.state.setFileState(filePath, {
          filePath,
          contentHash: scanned.contentHash,
          lastIndexedAt: new Date(),
          chunkIds,
        });

        totalChunks += chunkIds.length;
      }

      // Remove deleted files from state
      for (const filePath of changes.deleted) {
        this.state.removeFile(filePath);
      }

      const duration = Date.now() - startTime;

      return ok({
        added: changes.added,
        modified: changes.modified,
        deleted: changes.deleted,
        unchanged,
        totalChunks,
        duration,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new IndexerError(`Failed to reindex: ${message}`));
    }
  }
}
