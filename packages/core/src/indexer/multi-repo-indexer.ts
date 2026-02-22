import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { ok, type Result } from 'neverthrow';
import type { RepoConfig } from '../types/config.js';
import type { ScannedFile } from './file-scanner.js';
import { FileScanner } from './file-scanner.js';
import { IndexState } from './index-state.js';
import { createIgnoreFilter } from '../git/ignore-filter.js';

/**
 * Result for a single repo's indexing run.
 */
export interface RepoIndexResult {
  repoName: string;
  filesProcessed: number;
  chunksCreated: number;
  errors: string[];
}

/**
 * Aggregated result for multi-repo indexing.
 */
export interface MultiRepoIndexResult {
  repoResults: RepoIndexResult[];
}

/**
 * Progress callback for per-repo progress reporting.
 */
export type MultiRepoProgressCallback = (repoName: string, status: string) => void;

/**
 * Error type for multi-repo indexer operations.
 */
export class MultiRepoIndexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultiRepoIndexerError';
  }
}

/**
 * Options for a multi-repo indexing run.
 */
export interface MultiRepoIndexOptions {
  full?: boolean;
  onProgress?: MultiRepoProgressCallback;
}

/**
 * Callback that processes a single repo's files and returns chunk count.
 * This allows the CLI or other consumers to plug in their own
 * parse/chunk/embed/store pipeline for each repo.
 */
export type RepoProcessor = (
  repoName: string,
  repoPath: string,
  files: ScannedFile[],
  indexState: IndexState,
  storagePath: string,
) => Promise<Result<number, Error>>;

/**
 * Orchestrates indexing across multiple configured repos.
 *
 * Each repo gets its own IndexState stored under `{storagePath}/{repoName}/index-state.json`,
 * enabling independent incremental indexing per repo. Chunk metadata is stamped
 * with the repo name for cross-repo identification during search.
 */
export class MultiRepoIndexer {
  private readonly repos: RepoConfig[];
  private readonly storagePath: string;

  constructor(repos: RepoConfig[], storagePath: string) {
    this.repos = repos;
    this.storagePath = storagePath;
  }

  /**
   * Index all configured repos. Errors in one repo do not stop others.
   */
  async indexAll(
    options: MultiRepoIndexOptions = {},
    processor?: RepoProcessor,
  ): Promise<Result<MultiRepoIndexResult, MultiRepoIndexerError>> {
    const { full = false, onProgress } = options;
    const repoResults: RepoIndexResult[] = [];

    for (const repo of this.repos) {
      const repoName = this.resolveRepoName(repo);

      try {
        onProgress?.(repoName, 'Starting...');

        // Ensure per-repo storage directory exists
        const repoStoragePath = join(this.storagePath, repoName);
        await mkdir(repoStoragePath, { recursive: true });

        // Load or create per-repo index state
        let indexState = new IndexState();
        const indexStatePath = join(repoStoragePath, 'index-state.json');
        if (!full) {
          try {
            const stateData = await readFile(indexStatePath, 'utf-8');
            indexState = IndexState.fromJSON(
              JSON.parse(stateData) as Parameters<typeof IndexState.fromJSON>[0],
            );
          } catch {
            // No saved state, start fresh
          }
        }

        // Scan files
        onProgress?.(repoName, 'Scanning files...');
        const ignoreFilter = createIgnoreFilter(repo.path);
        const scanner = new FileScanner(repo.path, ignoreFilter);
        const scanResult = await scanner.scanFiles();

        if (scanResult.isErr()) {
          repoResults.push({
            repoName,
            filesProcessed: 0,
            chunksCreated: 0,
            errors: [`Scan failed: ${scanResult.error.message}`],
          });
          onProgress?.(repoName, `Failed: ${scanResult.error.message}`);
          continue;
        }

        const scannedFiles = scanResult.value;

        // Filter to changed files (incremental)
        let filesToProcess = scannedFiles;
        if (!full) {
          filesToProcess = scannedFiles.filter(
            (f) => indexState.isDirty(f.filePath, f.contentHash),
          );
        }

        onProgress?.(repoName, `Processing ${filesToProcess.length} file(s)...`);

        let chunksCreated = 0;

        if (processor && filesToProcess.length > 0) {
          // Delegate to consumer-provided processor
          const processResult = await processor(
            repoName,
            repo.path,
            filesToProcess,
            indexState,
            repoStoragePath,
          );

          if (processResult.isErr()) {
            repoResults.push({
              repoName,
              filesProcessed: filesToProcess.length,
              chunksCreated: 0,
              errors: [processResult.error.message],
            });
            onProgress?.(repoName, `Failed: ${processResult.error.message}`);
            continue;
          }

          chunksCreated = processResult.value;
        } else {
          // Default: update index state with file tracking (no chunking)
          for (const file of filesToProcess) {
            indexState.setFileState(file.filePath, {
              filePath: file.filePath,
              contentHash: file.contentHash,
              lastIndexedAt: new Date(),
              chunkIds: [],
            });
          }
        }

        // Detect and remove deleted files
        const currentFilePaths = new Set(scannedFiles.map((f) => f.filePath));
        for (const trackedPath of indexState.getAllFiles()) {
          if (!currentFilePaths.has(trackedPath)) {
            indexState.removeFile(trackedPath);
          }
        }

        // Persist index state
        await writeFile(
          indexStatePath,
          JSON.stringify(indexState.toJSON(), null, 2),
          'utf-8',
        );

        repoResults.push({
          repoName,
          filesProcessed: filesToProcess.length,
          chunksCreated,
          errors: [],
        });

        onProgress?.(repoName, 'Done');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        repoResults.push({
          repoName,
          filesProcessed: 0,
          chunksCreated: 0,
          errors: [message],
        });
        onProgress?.(repoName, `Failed: ${message}`);
      }
    }

    return ok({ repoResults });
  }

  /**
   * Resolve a display/storage name for a repo.
   * Uses the explicit `name` field if set, otherwise derives from the path.
   */
  private resolveRepoName(repo: RepoConfig): string {
    if (repo.name) {
      return repo.name;
    }
    return basename(repo.path);
  }
}
