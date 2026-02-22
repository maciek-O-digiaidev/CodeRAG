/**
 * CodeRAG: Configure Claude Code command.
 *
 * Provides manual setup for Claude Code MCP integration.
 * Shows current config status and allows regeneration or port changes.
 */

import type * as vscode from 'vscode';
import type { ClaudeConfigManager } from '../claude-config.js';

/** Options shown in the configuration quick pick. */
interface ConfigAction {
  readonly label: string;
  readonly description: string;
  readonly action: 'regenerate' | 'change-port' | 'view-status';
}

export function registerConfigureClaudeCommand(
  vscodeApi: typeof vscode,
  context: vscode.ExtensionContext,
  configManager: ClaudeConfigManager,
  outputChannel: vscode.OutputChannel,
): void {
  const disposable = vscodeApi.commands.registerCommand('coderag.configureClaude', async () => {
    const workspaceFolders = vscodeApi.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      vscodeApi.window.showWarningMessage('CodeRAG: No workspace folder open.');
      return;
    }

    const rootPath = workspaceFolders[0]!.uri.fsPath;

    // Detect Claude Code
    const detection = configManager.detectClaudeCode();
    const isConfigured = await configManager.isConfigured(rootPath);
    const currentPort = await configManager.getConfiguredPort(rootPath);

    // Show status info
    const statusLines: string[] = [
      `Claude Code: ${detection.installed ? `installed (v${detection.version ?? 'unknown'})` : 'not found'}`,
      `MCP config: ${isConfigured ? 'configured' : 'not configured'}`,
    ];

    if (currentPort !== undefined) {
      statusLines.push(`Server port: ${currentPort}`);
    }

    outputChannel.appendLine('--- Claude Code Configuration ---');
    for (const line of statusLines) {
      outputChannel.appendLine(`  ${line}`);
    }
    outputChannel.appendLine('---------------------------------');
    outputChannel.show(true);

    // Build action choices
    const actions: ConfigAction[] = [
      {
        label: '$(refresh) Regenerate Config',
        description: 'Write/overwrite .claude/settings.json MCP config',
        action: 'regenerate',
      },
      {
        label: '$(plug) Change Server Port',
        description: `Current: ${currentPort ?? 'default (stdio)'}`,
        action: 'change-port',
      },
      {
        label: '$(info) View Status',
        description: 'Show current configuration details',
        action: 'view-status',
      },
    ];

    const selected = await vscodeApi.window.showQuickPick(actions, {
      placeHolder: 'Configure Claude Code MCP integration',
    });

    if (!selected) {
      return;
    }

    switch (selected.action) {
      case 'regenerate': {
        try {
          await configManager.writeConfig(rootPath, currentPort);
          outputChannel.appendLine('[configure] Claude Code MCP config regenerated.');
          vscodeApi.window.showInformationMessage(
            'CodeRAG: Claude Code MCP config written to .claude/settings.json',
          );
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          outputChannel.appendLine(`[configure] Error: ${message}`);
          vscodeApi.window.showErrorMessage(`CodeRAG: Failed to write config: ${message}`);
        }
        break;
      }

      case 'change-port': {
        const portInput = await vscodeApi.window.showInputBox({
          prompt: 'Enter the CodeRAG server port (leave empty for stdio transport)',
          value: currentPort !== undefined ? String(currentPort) : '',
          placeHolder: 'e.g. 3100',
          validateInput: (value: string) => {
            if (value === '') {
              return null;
            }
            const num = Number(value);
            if (!Number.isInteger(num) || num < 1 || num > 65535) {
              return 'Port must be an integer between 1 and 65535';
            }
            return null;
          },
        });

        // User cancelled
        if (portInput === undefined) {
          return;
        }

        try {
          const newPort = portInput === '' ? undefined : Number(portInput);
          await configManager.writeConfig(rootPath, newPort);
          outputChannel.appendLine(
            `[configure] Updated server port to ${newPort ?? 'stdio (default)'}.`,
          );
          vscodeApi.window.showInformationMessage(
            `CodeRAG: Server port updated to ${newPort ?? 'stdio (default)'}`,
          );
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          outputChannel.appendLine(`[configure] Error: ${message}`);
          vscodeApi.window.showErrorMessage(`CodeRAG: Failed to update port: ${message}`);
        }
        break;
      }

      case 'view-status': {
        // Already shown in output channel above
        if (!detection.installed) {
          vscodeApi.window.showWarningMessage(
            'CodeRAG: Claude Code CLI not found. Install it from https://claude.ai/download',
          );
        } else if (isConfigured) {
          vscodeApi.window.showInformationMessage(
            'CodeRAG: Claude Code MCP integration is configured.',
          );
        } else {
          vscodeApi.window.showInformationMessage(
            'CodeRAG: Claude Code detected but MCP not configured. Select "Regenerate Config" to set up.',
          );
        }
        break;
      }
    }
  });

  context.subscriptions.push(disposable);
}
