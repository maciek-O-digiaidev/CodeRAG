/**
 * CodeRAG: Index command.
 *
 * Triggers re-indexing of the codebase by spawning the CLI
 * `coderag index` command in the workspace root.
 */

import { spawn } from 'node:child_process';
import type * as vscode from 'vscode';
import type { McpClient } from '../mcp-client.js';
import type { StatusBarManager } from '../status-bar.js';

export function registerIndexCommand(
  vscodeApi: typeof vscode,
  context: vscode.ExtensionContext,
  client: McpClient,
  statusBar: StatusBarManager,
  outputChannel: vscode.OutputChannel,
): void {
  const disposable = vscodeApi.commands.registerCommand('coderag.index', async () => {
    const workspaceFolders = vscodeApi.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      vscodeApi.window.showWarningMessage('CodeRAG: No workspace folder open.');
      return;
    }

    const rootPath = workspaceFolders[0]!.uri.fsPath;

    statusBar.update('indexing');
    outputChannel.appendLine('[index] Starting re-indexing...');
    outputChannel.show(true);

    try {
      await vscodeApi.window.withProgress(
        {
          location: vscodeApi.ProgressLocation.Notification,
          title: 'CodeRAG: Indexing codebase...',
          cancellable: false,
        },
        () => runIndex(rootPath, outputChannel),
      );

      outputChannel.appendLine('[index] Indexing complete.');
      vscodeApi.window.showInformationMessage('CodeRAG: Indexing complete.');

      // Refresh status after indexing
      if (client.isConnected()) {
        try {
          const status = await client.getStatus();
          statusBar.update('connected', status.totalChunks);
        } catch {
          statusBar.update('connected');
        }
      } else {
        statusBar.update('disconnected');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[index] Error: ${message}`);
      statusBar.update('error');
      vscodeApi.window.showErrorMessage(`CodeRAG indexing failed: ${message}`);
    }
  });

  context.subscriptions.push(disposable);
}

function runIndex(cwd: string, outputChannel: vscode.OutputChannel): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['coderag', 'index'], {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data: Buffer) => {
      outputChannel.appendLine(data.toString().trimEnd());
    });

    child.stderr.on('data', (data: Buffer) => {
      outputChannel.appendLine(data.toString().trimEnd());
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`coderag index exited with code ${code ?? 'unknown'}`));
      }
    });

    child.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn coderag index: ${err.message}`));
    });
  });
}
