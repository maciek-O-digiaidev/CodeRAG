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
import { ClaudeConfigManager } from './claude-config.js';
import { registerSearchCommand } from './commands/search.js';
import { registerIndexCommand } from './commands/index-cmd.js';
import { registerStatusCommand } from './commands/status.js';
import { registerConfigureClaudeCommand } from './commands/configure-claude.js';
import { registerSearchPanel } from './search-panel.js';

const DEFAULT_PORT = 3100;

let statusBar: StatusBarManager | undefined;
let mcpClient: McpClient | undefined;
let serverManager: ServerManager | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let claudeConfigManager: ClaudeConfigManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('CodeRAG');
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('CodeRAG extension activating...');

  // Create status bar
  statusBar = new StatusBarManager(vscode);
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  // Create Claude Config Manager
  claudeConfigManager = new ClaudeConfigManager();

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

  // Auto-configure Claude Code MCP settings (opt-in via setting)
  const autoConfigEnabled = vscode.workspace.getConfiguration('coderag').get<boolean>('autoConfigureClaude', false);
  if (autoConfigEnabled) {
    await autoConfigureClaude(rootPath);
  }

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
  claudeConfigManager = undefined;
}

function registerAllCommands(context: vscode.ExtensionContext): void {
  if (!mcpClient || !statusBar || !outputChannel || !claudeConfigManager) {
    return;
  }

  registerSearchCommand(vscode, context, mcpClient, outputChannel);
  registerIndexCommand(vscode, context, mcpClient, statusBar, outputChannel);
  registerStatusCommand(vscode, context, mcpClient, statusBar, outputChannel);
  registerConfigureClaudeCommand(vscode, context, claudeConfigManager, outputChannel);
  registerSearchPanel(vscode, context, mcpClient, outputChannel);
}

/**
 * Auto-configure Claude Code MCP settings if Claude Code is detected
 * and the workspace is not yet configured.
 */
async function autoConfigureClaude(workspaceRoot: string): Promise<void> {
  if (!claudeConfigManager || !outputChannel) {
    return;
  }

  try {
    const detection = claudeConfigManager.detectClaudeCode();
    if (!detection.installed) {
      outputChannel.appendLine('[claude] Claude Code not detected — skipping auto-configuration.');
      return;
    }

    outputChannel.appendLine(`[claude] Claude Code detected (v${detection.version ?? 'unknown'}).`);

    const alreadyConfigured = await claudeConfigManager.isConfigured(workspaceRoot);
    if (alreadyConfigured) {
      outputChannel.appendLine('[claude] MCP config already present in .claude/settings.json.');
      return;
    }

    await claudeConfigManager.writeConfig(workspaceRoot, DEFAULT_PORT);
    outputChannel.appendLine('[claude] Auto-configured Claude Code MCP settings in .claude/settings.json.');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[claude] Auto-configuration failed: ${message}`);
  }
}

async function connectToServer(): Promise<void> {
  if (!serverManager || !mcpClient || !statusBar || !outputChannel) {
    return;
  }

  try {
    // Ensure server is running (auto-start if needed)
    const result = await serverManager.ensureRunning();

    if (result.noIndex) {
      outputChannel.appendLine('No CodeRAG index found for this project.');
      statusBar.update('noIndex');

      // Show notification with "Run Index" button
      const action = await vscode.window.showInformationMessage(
        'No CodeRAG index found. Build the index to enable code search.',
        'Run Index',
      );

      if (action === 'Run Index') {
        await vscode.commands.executeCommand('coderag.index');
        // After indexing, try to connect again
        await connectToServer();
      }

      return;
    }

    if (!result.running) {
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
