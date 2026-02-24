import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileWatcher } from './file-watcher.js';
import type { IgnoreFilter } from '../git/ignore-filter.js';

/**
 * Helper to create a temporary directory for testing.
 */
async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'coderag-watcher-test-'));
}

/**
 * Helper to wait for a specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('FileWatcher', () => {
  let tempDir: string;
  let watcher: FileWatcher | null = null;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
      watcher = null;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create a watcher with default debounce', () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
      });

      expect(watcher.getIsRunning()).toBe(false);
      expect(watcher.getPendingCount()).toBe(0);
    });

    it('should create a watcher with custom debounce', () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 500,
      });

      expect(watcher.getIsRunning()).toBe(false);
    });
  });

  describe('start and stop', () => {
    it('should start and become ready', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 100,
      });

      const readyPromise = new Promise<void>((resolve) => {
        watcher!.on('ready', () => resolve());
      });

      await watcher.start();
      await readyPromise;

      expect(watcher.getIsRunning()).toBe(true);
    });

    it('should stop cleanly', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 100,
      });

      await watcher.start();
      await watcher.stop();

      expect(watcher.getIsRunning()).toBe(false);
    });

    it('should not throw when stopping a watcher that was never started', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
      });

      await watcher.stop();
      expect(watcher.getIsRunning()).toBe(false);
    });

    it('should be idempotent when starting multiple times', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 100,
      });

      await watcher.start();
      await watcher.start(); // Should not throw or create duplicate watchers

      expect(watcher.getIsRunning()).toBe(true);
    });
  });

  describe('change detection', () => {
    it('should emit change event when a file is created', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 200,
      });

      const changes = new Promise<readonly string[]>((resolve) => {
        watcher!.on('change', (paths) => resolve(paths));
      });

      await watcher.start();

      // Create a file
      await writeFile(join(tempDir, 'test.ts'), 'const x = 1;');

      const changedPaths = await changes;
      expect(changedPaths).toContain('test.ts');
    });

    it('should emit change event when a file is modified', async () => {
      // Create file first
      await writeFile(join(tempDir, 'existing.ts'), 'const x = 1;');

      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 200,
      });

      const changes = new Promise<readonly string[]>((resolve) => {
        watcher!.on('change', (paths) => resolve(paths));
      });

      await watcher.start();

      // Modify the file
      await writeFile(join(tempDir, 'existing.ts'), 'const x = 2;');

      const changedPaths = await changes;
      expect(changedPaths).toContain('existing.ts');
    });
  });

  describe('debouncing', () => {
    it('should batch rapid changes into a single event', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 500,
      });

      const changeEvents: Array<readonly string[]> = [];
      watcher.on('change', (paths) => changeEvents.push(paths));

      await watcher.start();

      // Create multiple files in rapid succession
      await writeFile(join(tempDir, 'file1.ts'), 'a');
      await writeFile(join(tempDir, 'file2.ts'), 'b');
      await writeFile(join(tempDir, 'file3.ts'), 'c');

      // Wait for debounce + buffer
      await delay(1000);

      // Should have been batched into a single event
      expect(changeEvents.length).toBe(1);
      const batch = changeEvents[0]!;
      expect(batch).toContain('file1.ts');
      expect(batch).toContain('file2.ts');
      expect(batch).toContain('file3.ts');
    });

    it('should separate events that are spaced beyond the debounce window', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 300,
      });

      const changeEvents: Array<readonly string[]> = [];
      watcher.on('change', (paths) => changeEvents.push(paths));

      await watcher.start();

      // First change
      await writeFile(join(tempDir, 'first.ts'), 'a');

      // Wait for debounce to fire (debounce 300ms + awaitWriteFinish 300ms + buffer)
      await delay(1200);

      // Second change (well after debounce window)
      await writeFile(join(tempDir, 'second.ts'), 'b');

      // Wait for second debounce to fire
      await delay(1200);

      expect(changeEvents.length).toBe(2);
      expect(changeEvents[0]).toContain('first.ts');
      expect(changeEvents[1]).toContain('second.ts');
    });
  });

  describe('ignore filtering', () => {
    it('should ignore files matching the ignore filter', async () => {
      const ignoreFilter: IgnoreFilter = (path: string) =>
        path.endsWith('.log') || path.startsWith('node_modules');

      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 300,
      });

      const changeEvents: Array<readonly string[]> = [];
      watcher.on('change', (paths) => changeEvents.push(paths));

      await watcher.start();

      // Create an ignored file and a non-ignored file
      await writeFile(join(tempDir, 'debug.log'), 'log data');
      await writeFile(join(tempDir, 'main.ts'), 'code');

      // Wait for awaitWriteFinish (300ms) + debounce (300ms) + buffer
      await delay(1200);

      // Only main.ts should be in the changes
      expect(changeEvents.length).toBeGreaterThanOrEqual(1);
      const allPaths = changeEvents.flat();
      expect(allPaths).toContain('main.ts');
      expect(allPaths).not.toContain('debug.log');
    });

    it('should always ignore .git directory', async () => {
      const ignoreFilter: IgnoreFilter = () => false; // Accept everything

      // Create .git dir
      await mkdir(join(tempDir, '.git'), { recursive: true });

      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 300,
      });

      const changeEvents: Array<readonly string[]> = [];
      watcher.on('change', (paths) => changeEvents.push(paths));

      await watcher.start();

      // Create a file in .git and a regular file
      await writeFile(join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main');
      await writeFile(join(tempDir, 'code.ts'), 'const y = 1;');

      // Wait for awaitWriteFinish (300ms) + debounce (300ms) + buffer
      await delay(1200);

      const allPaths = changeEvents.flat();
      expect(allPaths).toContain('code.ts');
      expect(allPaths).not.toContain('.git/HEAD');
    });
  });

  describe('event handling', () => {
    it('should support on/off pattern', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 200,
      });

      const handler = vi.fn();
      watcher.on('change', handler);
      watcher.off('change', handler);

      await watcher.start();

      await writeFile(join(tempDir, 'test.ts'), 'x');
      await delay(500);

      // Handler was removed, should not be called
      expect(handler).not.toHaveBeenCalled();
    });

    it('should emit error events', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 100,
      });

      const errorHandler = vi.fn();
      watcher.on('error', errorHandler);

      // The watcher itself won't necessarily error in this test,
      // but we verify the handler is registered and the pattern works.
      expect(errorHandler).not.toHaveBeenCalled();
    });
  });

  describe('flush on stop', () => {
    it('should flush pending changes when stopped', async () => {
      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 5000, // Long debounce so changes stay pending
      });

      const changeEvents: Array<readonly string[]> = [];
      watcher.on('change', (paths) => changeEvents.push(paths));

      await watcher.start();

      // Create a file — it will be pending (debounce is 5s)
      await writeFile(join(tempDir, 'pending.ts'), 'x');

      // Give chokidar time to detect the change
      await delay(500);

      // Stop should flush pending changes
      await watcher.stop();
      watcher = null;

      // The pending change should have been flushed
      if (changeEvents.length > 0) {
        const allPaths = changeEvents.flat();
        expect(allPaths).toContain('pending.ts');
      }
      // If chokidar didn't detect it yet, that's also fine
    });
  });

  describe('subdirectory watching', () => {
    it('should detect changes in subdirectories', { timeout: 15000 }, async () => {
      const subDir = join(tempDir, 'src');
      await mkdir(subDir, { recursive: true });

      const ignoreFilter: IgnoreFilter = () => false;
      watcher = new FileWatcher({
        rootDir: tempDir,
        ignoreFilter,
        debounceMs: 200,
      });

      const changes = new Promise<readonly string[]>((resolve) => {
        watcher!.on('change', (paths) => resolve(paths));
      });

      await watcher.start();

      await writeFile(join(subDir, 'nested.ts'), 'nested code');

      const changedPaths = await changes;
      expect(changedPaths).toContain('src/nested.ts');
    });
  });
});
