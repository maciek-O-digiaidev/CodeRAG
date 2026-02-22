/**
 * CodeRAG: Search command.
 *
 * Opens a QuickPick input for the user to type a query,
 * calls the MCP server, and displays results.
 */

import type * as vscode from 'vscode';
import type { McpClient } from '../mcp-client.js';
import type { SearchResultItem } from '../types.js';

export function registerSearchCommand(
  vscodeApi: typeof vscode,
  context: vscode.ExtensionContext,
  client: McpClient,
  outputChannel: vscode.OutputChannel,
): void {
  const disposable = vscodeApi.commands.registerCommand('coderag.search', async () => {
    const query = await vscodeApi.window.showInputBox({
      prompt: 'Enter search query',
      placeHolder: 'e.g. "how does the parser handle imports?"',
    });

    if (!query) {
      return;
    }

    if (!client.isConnected()) {
      vscodeApi.window.showWarningMessage('CodeRAG is not connected. Run "CodeRAG: Status" to check.');
      return;
    }

    try {
      const results = await vscodeApi.window.withProgress(
        {
          location: vscodeApi.ProgressLocation.Notification,
          title: 'CodeRAG: Searching...',
          cancellable: false,
        },
        async () => client.search(query),
      );

      if (results.length === 0) {
        vscodeApi.window.showInformationMessage('CodeRAG: No results found.');
        return;
      }

      const items = results.map((r: SearchResultItem) => ({
        label: `$(file-code) ${r.filePath}`,
        description: `L${r.startLine}-${r.endLine} | ${r.chunkType} | score: ${r.score.toFixed(4)}`,
        detail: r.nlSummary || r.content.slice(0, 200),
        result: r,
      }));

      const selected = await vscodeApi.window.showQuickPick(items, {
        placeHolder: `${results.length} result(s) for "${query}"`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        const { result } = selected;
        const uri = vscodeApi.Uri.file(result.filePath);
        const doc = await vscodeApi.workspace.openTextDocument(uri);
        const line = Math.max(0, result.startLine - 1);
        await vscodeApi.window.showTextDocument(doc, {
          selection: new vscodeApi.Range(line, 0, result.endLine, 0),
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[search] Error: ${message}`);
      vscodeApi.window.showErrorMessage(`CodeRAG search failed: ${message}`);
    }
  });

  context.subscriptions.push(disposable);
}
