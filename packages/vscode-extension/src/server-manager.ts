/**
 * ServerManager — handles auto-starting and managing the CodeRAG MCP server.
 *
 * When the extension activates, it attempts to connect to an existing server.
 * If no server is running, it spawns `npx coderag serve --port <port>` and
 * waits for it to become available.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type * as vscode from 'vscode';

const DEFAULT_PORT = 3100;
const SERVER_STARTUP_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 1_000;

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
   * Returns true if the server is available, false if startup failed.
   */
  async ensureRunning(): Promise<boolean> {
    if (await this.isServerRunning()) {
      this.outputChannel.appendLine('[server] MCP server already running.');
      return true;
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

  private async startServer(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const child = spawn(
        'npx',
        ['coderag', 'serve', '--port', String(this.port)],
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
        this.outputChannel.appendLine(`[server] ${data.toString().trimEnd()}`);
      });

      child.on('error', (err: Error) => {
        this.outputChannel.appendLine(`[server] Failed to start: ${err.message}`);
        this.serverProcess = null;
        resolve(false);
      });

      child.on('exit', (code) => {
        this.outputChannel.appendLine(`[server] Process exited with code ${code ?? 'unknown'}`);
        this.serverProcess = null;
      });

      // Poll for server availability
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (Date.now() - startTime > SERVER_STARTUP_TIMEOUT_MS) {
          clearInterval(checkInterval);
          this.outputChannel.appendLine('[server] Startup timeout — server did not become available.');
          resolve(false);
          return;
        }

        this.isServerRunning().then((running) => {
          if (running) {
            clearInterval(checkInterval);
            this.outputChannel.appendLine('[server] MCP server is ready.');
            resolve(true);
          }
        }).catch(() => {
          // ignore — keep polling
        });
      }, HEALTH_CHECK_INTERVAL_MS);
    });
  }
}
