/**
 * CodeRAG: Status command.
 *
 * Shows the current index status in the output channel,
 * refreshing from the MCP server if connected.
 */

import type * as vscode from 'vscode';
import type { McpClient } from '../mcp-client.js';
import type { StatusBarManager } from '../status-bar.js';

export function registerStatusCommand(
  vscodeApi: typeof vscode,
  context: vscode.ExtensionContext,
  client: McpClient,
  statusBar: StatusBarManager,
  outputChannel: vscode.OutputChannel,
): void {
  const disposable = vscodeApi.commands.registerCommand('coderag.status', async () => {
    outputChannel.show(true);

    if (!client.isConnected()) {
      outputChannel.appendLine('[status] CodeRAG is not connected to the MCP server.');
      outputChannel.appendLine('[status] The server will be started automatically when a .coderag.yaml workspace is opened.');
      statusBar.update('disconnected');
      return;
    }

    try {
      const status = await client.getStatus();

      outputChannel.appendLine('--- CodeRAG Status ---');
      outputChannel.appendLine(`  Health:     ${status.health}`);
      outputChannel.appendLine(`  Chunks:     ${status.totalChunks}`);
      outputChannel.appendLine(`  Model:      ${status.model}`);
      outputChannel.appendLine(`  Dimensions: ${status.dimensions}`);

      const langDisplay = Array.isArray(status.languages)
        ? status.languages.join(', ')
        : status.languages;
      outputChannel.appendLine(`  Languages:  ${langDisplay}`);
      outputChannel.appendLine(`  Storage:    ${status.storagePath}`);
      outputChannel.appendLine('---------------------');

      statusBar.update('connected', status.totalChunks);

      vscodeApi.window.showInformationMessage(
        `CodeRAG: ${status.health} — ${status.totalChunks} chunks indexed`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[status] Error: ${message}`);
      statusBar.update('error');
      vscodeApi.window.showErrorMessage(`CodeRAG status check failed: ${message}`);
    }
  });

  context.subscriptions.push(disposable);
}
