/**
 * ServerManager — handles auto-starting and managing the CodeRAG MCP server.
 *
 * When the extension activates, it attempts to connect to an existing server.
 * If no server is running, it resolves the CLI location and spawns
 * `coderag serve --port <port>`, waiting for it to become available.
 *
 * CLI resolution order:
 *   1. Local monorepo: {workspace}/packages/cli/dist/index.js
 *   2. node_modules:   {workspace}/node_modules/.bin/coderag
 *   3. PATH:           coderag (global install)
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as vscode from 'vscode';

const DEFAULT_PORT = 3100;
const SERVER_STARTUP_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 1_000;

/** Substring present in server stderr output when no index exists. */
const NO_INDEX_MARKER = 'No index found for this project';

/** Result of attempting to ensure the server is running. */
export interface EnsureRunningResult {
  /** Whether the server is available. */
  readonly running: boolean;
  /** Whether the server failed because no index exists. */
  readonly noIndex: boolean;
}

export interface ServerManagerOptions {
  readonly port?: number;
  readonly outputChannel: vscode.OutputChannel;
  readonly workspaceRoot: string;
}

export class ServerManager {
  private readonly port: number;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly workspaceRoot: string;
  private serverProcess: ChildProcess | null = null;

  constructor(options: ServerManagerOptions) {
    this.port = options.port ?? DEFAULT_PORT;
    this.outputChannel = options.outputChannel;
    this.workspaceRoot = options.workspaceRoot;
  }

  /** Get the port the server is (expected to be) running on. */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if the MCP server is already running by fetching the SSE endpoint.
   */
  async isServerRunning(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2_000);

      const response = await fetch(`http://localhost:${this.port}/sse`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });

      clearTimeout(timeout);

      // If we get a 200, server is running — immediately abort the SSE stream
      if (response.ok && response.body) {
        response.body.cancel().catch(() => {});
      }

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the server is running. If not already running, spawn it.
   * Returns a result indicating whether the server is available and
   * whether it failed because no index exists.
   */
  async ensureRunning(): Promise<EnsureRunningResult> {
    if (await this.isServerRunning()) {
      this.outputChannel.appendLine('[server] MCP server already running.');
      return { running: true, noIndex: false };
    }

    this.outputChannel.appendLine('[server] Starting MCP server...');
    return this.startServer();
  }

  /** Stop the managed server process (if we spawned it). */
  stop(): void {
    if (this.serverProcess) {
      this.outputChannel.appendLine('[server] Stopping MCP server...');
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
    }
  }

  /**
   * Resolve the CLI command and arguments to start the server.
   * Tries local monorepo path, node_modules bin, then global PATH.
   */
  private resolveCliCommand(): { command: string; args: string[] } {
    const portArgs = ['serve', '--port', String(this.port)];

    // 1. Local monorepo: packages/cli/dist/index.js
    const monorepoPath = join(this.workspaceRoot, 'packages', 'cli', 'dist', 'index.js');
    if (existsSync(monorepoPath)) {
      this.outputChannel.appendLine(`[server] Using local CLI: ${monorepoPath}`);
      return { command: 'node', args: [monorepoPath, ...portArgs] };
    }

    // 2. node_modules/.bin/coderag
    const nmBin = join(this.workspaceRoot, 'node_modules', '.bin', 'coderag');
    if (existsSync(nmBin)) {
      this.outputChannel.appendLine(`[server] Using node_modules CLI: ${nmBin}`);
      return { command: nmBin, args: portArgs };
    }

    // 3. Global PATH — check if `coderag` is available
    try {
      execSync('command -v coderag', { stdio: 'ignore' });
      this.outputChannel.appendLine('[server] Using global coderag from PATH');
      return { command: 'coderag', args: portArgs };
    } catch {
      // Not in PATH
    }

    // 4. Fallback to npx (will fetch from npm if published)
    this.outputChannel.appendLine('[server] Falling back to npx coderag');
    return { command: 'npx', args: ['coderag', ...portArgs] };
  }

  private async startServer(): Promise<EnsureRunningResult> {
    return new Promise<EnsureRunningResult>((resolve) => {
      const { command, args } = this.resolveCliCommand();
      let detectedNoIndex = false;

      const child = spawn(
        command,
        args,
        {
          cwd: this.workspaceRoot,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        },
      );

      this.serverProcess = child;

      child.stdout?.on('data', (data: Buffer) => {
        this.outputChannel.appendLine(`[server] ${data.toString().trimEnd()}`);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trimEnd();
        this.outputChannel.appendLine(`[server] ${text}`);
        if (text.includes(NO_INDEX_MARKER)) {
          detectedNoIndex = true;
        }
      });

      child.on('error', (err: Error) => {
        this.outputChannel.appendLine(`[server] Failed to start: ${err.message}`);
        this.serverProcess = null;
        resolve({ running: false, noIndex: false });
      });

      child.on('exit', (code) => {
        this.outputChannel.appendLine(`[server] Process exited with code ${code ?? 'unknown'}`);
        this.serverProcess = null;
        // If the server exited with code 1 and we detected the no-index marker,
        // resolve immediately so the extension can show the appropriate UI.
        if (code === 1 && detectedNoIndex) {
          resolve({ running: false, noIndex: true });
        }
      });

      // Poll for server availability
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        // If the process already exited with no-index, stop polling
        if (detectedNoIndex && this.serverProcess === null) {
          clearInterval(checkInterval);
          return;
        }

        if (Date.now() - startTime > SERVER_STARTUP_TIMEOUT_MS) {
          clearInterval(checkInterval);
          this.outputChannel.appendLine('[server] Startup timeout — server did not become available.');
          resolve({ running: false, noIndex: false });
          return;
        }

        this.isServerRunning().then((running) => {
          if (running) {
            clearInterval(checkInterval);
            this.outputChannel.appendLine('[server] MCP server is ready.');
            resolve({ running: true, noIndex: false });
          }
        }).catch(() => {
          // ignore — keep polling
        });
      }, HEALTH_CHECK_INTERVAL_MS);
    });
  }
}
