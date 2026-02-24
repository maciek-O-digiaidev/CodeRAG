/**
 * WatcherManager — manages a file watcher process for the VS Code extension.
 *
 * When the MCP server starts, this manager spawns `coderag watch` in the
 * background to automatically re-index on file changes. It also updates
 * the status bar to show indexing progress.
 *
 * This is a lightweight wrapper that shells out to the CLI watcher process,
 * keeping the extension dependency-free from @code-rag/core.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as vscode from 'vscode';
import type { StatusBarManager } from './status-bar.js';
import type { McpClient } from './mcp-client.js';

export interface WatcherManagerOptions {
  readonly workspaceRoot: string;
  readonly outputChannel: vscode.OutputChannel;
  readonly statusBar: StatusBarManager;
  readonly mcpClient: McpClient;
}

export class WatcherManager {
  private readonly workspaceRoot: string;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly statusBar: StatusBarManager;
  private readonly mcpClient: McpClient;
  private watcherProcess: ChildProcess | null = null;

  constructor(options: WatcherManagerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.outputChannel = options.outputChannel;
    this.statusBar = options.statusBar;
    this.mcpClient = options.mcpClient;
  }

  /**
   * Start the watcher process in the background.
   * The watcher will trigger incremental re-indexing on file changes.
   */
  start(): void {
    if (this.watcherProcess) {
      this.outputChannel.appendLine('[watcher] Already running.');
      return;
    }

    const cliCommand = this.resolveCliCommand();
    if (!cliCommand) {
      this.outputChannel.appendLine('[watcher] Could not locate coderag CLI. File watcher not started.');
      return;
    }

    this.outputChannel.appendLine(`[watcher] Starting file watcher (${cliCommand.command} ${cliCommand.args.join(' ')})...`);

    const child = spawn(
      cliCommand.command,
      cliCommand.args,
      {
        cwd: this.workspaceRoot,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      },
    );

    this.watcherProcess = child;

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trimEnd();
      this.outputChannel.appendLine(`[watcher] ${text}`);

      // Detect indexing start/end to update status bar
      if (text.includes('Running incremental index')) {
        this.statusBar.update('indexing');
      }
      if (text.includes('complete')) {
        void this.refreshStatus();
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      this.outputChannel.appendLine(`[watcher] ${data.toString().trimEnd()}`);
    });

    child.on('error', (err: Error) => {
      this.outputChannel.appendLine(`[watcher] Process error: ${err.message}`);
      this.watcherProcess = null;
    });

    child.on('exit', (code) => {
      this.outputChannel.appendLine(`[watcher] Process exited with code ${code ?? 'unknown'}`);
      this.watcherProcess = null;
    });

    this.outputChannel.appendLine('[watcher] File watcher started.');
  }

  /**
   * Stop the watcher process.
   */
  stop(): void {
    if (this.watcherProcess) {
      this.outputChannel.appendLine('[watcher] Stopping file watcher...');
      this.watcherProcess.kill('SIGTERM');
      this.watcherProcess = null;
    }
  }

  /**
   * Check if the watcher process is running.
   */
  isRunning(): boolean {
    return this.watcherProcess !== null;
  }

  /**
   * Refresh the status bar after an indexing batch completes.
   */
  private async refreshStatus(): Promise<void> {
    try {
      if (this.mcpClient.isConnected()) {
        const status = await this.mcpClient.getStatus();
        this.statusBar.update('connected', status.totalChunks);
      }
    } catch {
      this.statusBar.update('connected');
    }
  }

  /**
   * Resolve the CLI command for the watch process.
   */
  private resolveCliCommand(): { command: string; args: string[] } | null {
    const watchArgs = ['watch', '--debounce', '2000'];

    // 1. Local monorepo
    const monorepoPath = join(this.workspaceRoot, 'packages', 'cli', 'dist', 'index.js');
    if (existsSync(monorepoPath)) {
      return { command: 'node', args: [monorepoPath, ...watchArgs] };
    }

    // 2. node_modules/.bin/coderag
    const nmBin = join(this.workspaceRoot, 'node_modules', '.bin', 'coderag');
    if (existsSync(nmBin)) {
      return { command: nmBin, args: watchArgs };
    }

    // 3. Global PATH — fall back to npx
    return { command: 'npx', args: ['coderag', ...watchArgs] };
  }
}
