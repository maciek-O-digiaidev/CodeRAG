/**
 * CodeRAG VS Code Extension — main entry point.
 *
 * Activates when a workspace contains `.coderag.yaml`.
 * Connects to the CodeRAG MCP server (auto-starts if needed),
 * registers commands, and shows a status bar item.
 */

import * as vscode from 'vscode';
import { McpClient } from './mcp-client.js';
import { StatusBarManager } from './status-bar.js';
import { ServerManager } from './server-manager.js';
import { registerSearchCommand } from './commands/search.js';
import { registerIndexCommand } from './commands/index-cmd.js';
import { registerStatusCommand } from './commands/status.js';

const DEFAULT_PORT = 3100;

let statusBar: StatusBarManager | undefined;
let mcpClient: McpClient | undefined;
let serverManager: ServerManager | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('CodeRAG');
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('CodeRAG extension activating...');

  // Create status bar
  statusBar = new StatusBarManager(vscode);
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  // Determine workspace root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    outputChannel.appendLine('No workspace folder open — CodeRAG commands available but server not started.');
    mcpClient = new McpClient({ port: DEFAULT_PORT });
    registerAllCommands(context);
    return;
  }

  const rootPath = workspaceFolders[0]!.uri.fsPath;

  // Create server manager and MCP client
  serverManager = new ServerManager({
    port: DEFAULT_PORT,
    outputChannel,
    workspaceRoot: rootPath,
  });
  context.subscriptions.push({ dispose: () => serverManager?.stop() });

  mcpClient = new McpClient({ port: DEFAULT_PORT });

  // Register commands (available even before server connects)
  registerAllCommands(context);

  // Auto-start server and connect
  await connectToServer();

  outputChannel.appendLine('CodeRAG extension activated.');
}

export function deactivate(): void {
  mcpClient?.disconnect();
  serverManager?.stop();
  statusBar?.dispose();

  mcpClient = undefined;
  serverManager = undefined;
  statusBar = undefined;
  outputChannel = undefined;
}

function registerAllCommands(context: vscode.ExtensionContext): void {
  if (!mcpClient || !statusBar || !outputChannel) {
    return;
  }

  registerSearchCommand(vscode, context, mcpClient, outputChannel);
  registerIndexCommand(vscode, context, mcpClient, statusBar, outputChannel);
  registerStatusCommand(vscode, context, mcpClient, statusBar, outputChannel);
}

async function connectToServer(): Promise<void> {
  if (!serverManager || !mcpClient || !statusBar || !outputChannel) {
    return;
  }

  try {
    // Ensure server is running (auto-start if needed)
    const serverReady = await serverManager.ensureRunning();
    if (!serverReady) {
      outputChannel.appendLine('MCP server could not be started. Commands will work once server is available.');
      statusBar.update('disconnected');
      return;
    }

    // Connect MCP client
    await mcpClient.connect();
    outputChannel.appendLine('Connected to CodeRAG MCP server.');

    // Fetch initial status
    try {
      const status = await mcpClient.getStatus();
      statusBar.update('connected', status.totalChunks);
      outputChannel.appendLine(`Index status: ${status.health}, ${status.totalChunks} chunks`);
    } catch {
      statusBar.update('connected', 0);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`Connection failed: ${message}`);
    statusBar.update('error');
  }
}
