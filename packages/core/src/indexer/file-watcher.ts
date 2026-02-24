import { watch, type FSWatcher } from 'chokidar';
import { relative } from 'node:path';
import { EventEmitter } from 'node:events';
import type { IgnoreFilter } from '../git/ignore-filter.js';

/**
 * Debounce window in milliseconds.
 * Rapid changes within this window are batched into a single event.
 */
const DEFAULT_DEBOUNCE_MS = 2_000;

/**
 * Events emitted by the FileWatcher.
 */
export interface FileWatcherEvents {
  /** Emitted when a debounced batch of changed file paths is ready. */
  change: (changedPaths: readonly string[]) => void;
  /** Emitted when the watcher encounters an error. */
  error: (error: Error) => void;
  /** Emitted when the initial scan is complete and the watcher is ready. */
  ready: () => void;
}

/**
 * Configuration for the FileWatcher.
 */
export interface FileWatcherConfig {
  /** Root directory to watch. */
  readonly rootDir: string;
  /** Ignore filter function (from createIgnoreFilter). */
  readonly ignoreFilter: IgnoreFilter;
  /** Debounce window in milliseconds (default: 2000). */
  readonly debounceMs?: number;
}

/**
 * Watches a project directory for file changes and emits debounced
 * batches of changed file paths, respecting .gitignore and .coderag.yaml
 * ignore patterns.
 *
 * Uses chokidar for cross-platform file watching with robust event handling.
 */
export class FileWatcher {
  private readonly config: FileWatcherConfig;
  private readonly debounceMs: number;
  private readonly emitter: EventEmitter;
  private watcher: FSWatcher | null = null;
  private pendingChanges: Set<string> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;

  constructor(config: FileWatcherConfig) {
    this.config = config;
    this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.emitter = new EventEmitter();
  }

  /**
   * Register an event listener.
   */
  on<K extends keyof FileWatcherEvents>(event: K, listener: FileWatcherEvents[K]): this {
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Remove an event listener.
   */
  off<K extends keyof FileWatcherEvents>(event: K, listener: FileWatcherEvents[K]): this {
    this.emitter.off(event, listener);
    return this;
  }

  /**
   * Start watching the root directory for file changes.
   * Resolves when the initial scan is complete and the watcher is ready.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    const watcher = watch(this.config.rootDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
      ignored: (filePath: string) => this.shouldIgnore(filePath),
    });

    this.watcher = watcher;

    watcher.on('add', (filePath: string) => this.handleChange(filePath));
    watcher.on('change', (filePath: string) => this.handleChange(filePath));
    watcher.on('unlink', (filePath: string) => this.handleChange(filePath));
    watcher.on('error', (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emitter.emit('error', err);
    });

    return new Promise<void>((resolve) => {
      watcher.on('ready', () => {
        this.emitter.emit('ready');
        resolve();
      });
    });
  }

  /**
   * Stop watching and clean up resources.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Flush any pending changes before stopping
    if (this.pendingChanges.size > 0) {
      this.flushChanges();
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Check whether the watcher is currently running.
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the number of pending (not yet flushed) changes.
   */
  getPendingCount(): number {
    return this.pendingChanges.size;
  }

  /**
   * Determine whether a file path should be ignored.
   * Converts absolute paths to relative paths for the ignore filter.
   */
  private shouldIgnore(filePath: string): boolean {
    const relativePath = relative(this.config.rootDir, filePath);

    // Always ignore .git directory
    if (relativePath.startsWith('.git/') || relativePath === '.git') {
      return true;
    }

    return this.config.ignoreFilter(relativePath);
  }

  /**
   * Handle a file change event by adding it to the pending set
   * and resetting the debounce timer.
   */
  private handleChange(filePath: string): void {
    const relativePath = relative(this.config.rootDir, filePath);
    this.pendingChanges.add(relativePath);

    // Reset debounce timer
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushChanges();
    }, this.debounceMs);
  }

  /**
   * Emit all pending changes as a single batch and clear the pending set.
   */
  private flushChanges(): void {
    if (this.pendingChanges.size === 0) {
      return;
    }

    const changedPaths = [...this.pendingChanges];
    this.pendingChanges = new Set();
    this.debounceTimer = null;

    this.emitter.emit('change', changedPaths);
  }
}
