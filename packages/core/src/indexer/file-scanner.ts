import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import { computeFileHash } from './index-state.js';

/**
 * Represents a file discovered during a directory scan, including its
 * content and a precomputed content hash.
 */
export interface ScannedFile {
  filePath: string;
  content: string;
  contentHash: string;
}

/**
 * Error type for file scanning operations.
 */
export class ScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

/**
 * Walks a directory tree to discover indexable source files,
 * respecting an ignore filter (e.g., .gitignore patterns).
 */
export class FileScanner {
  private readonly rootDir: string;
  private readonly ignoreFilter: (path: string) => boolean;

  constructor(rootDir: string, ignoreFilter: (path: string) => boolean) {
    this.rootDir = rootDir;
    this.ignoreFilter = ignoreFilter;
  }

  /**
   * Recursively scan the root directory for files, filtering out ignored paths.
   * Returns a list of ScannedFile objects with content and content hashes.
   */
  async scanFiles(): Promise<Result<ScannedFile[], ScanError>> {
    try {
      const files: ScannedFile[] = [];
      await this.walkDirectory(this.rootDir, files);
      return ok(files);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new ScanError(`Failed to scan directory: ${message}`));
    }
  }

  /**
   * Recursively walk a directory, accumulating non-ignored files.
   */
  private async walkDirectory(dir: string, accumulator: ScannedFile[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(this.rootDir, fullPath);

      if (this.ignoreFilter(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Check if the directory itself is ignored (with trailing separator hint)
        if (this.ignoreFilter(relativePath + '/')) {
          continue;
        }
        await this.walkDirectory(fullPath, accumulator);
      } else if (entry.isFile()) {
        const content = await readFile(fullPath, 'utf-8');
        const contentHash = computeFileHash(content);
        accumulator.push({
          filePath: relativePath,
          content,
          contentHash,
        });
      }
    }
  }
}
