/**
 * StatusBarManager — manages the CodeRAG status bar item in VS Code.
 *
 * Shows the current state of the CodeRAG index:
 *   - $(database) CodeRAG: Connected (42 chunks)
 *   - $(sync~spin) CodeRAG: Indexing...
 *   - $(error) CodeRAG: Error
 *   - $(debug-disconnect) CodeRAG: Disconnected
 */

import type * as vscode from 'vscode';
import type { IndexStatus } from './types.js';

const STATUS_BAR_PRIORITY = 100;
const STATUS_BAR_ID = 'coderag.status';

interface StatusBarIcons {
  readonly connected: string;
  readonly indexing: string;
  readonly error: string;
  readonly disconnected: string;
}

const ICONS: StatusBarIcons = {
  connected: '$(database)',
  indexing: '$(sync~spin)',
  error: '$(error)',
  disconnected: '$(debug-disconnect)',
};

export class StatusBarManager {
  private readonly statusBarItem: vscode.StatusBarItem;
  private currentStatus: IndexStatus = 'disconnected';
  private chunkCount = 0;

  constructor(
    private readonly vscodeApi: typeof vscode,
  ) {
    this.statusBarItem = this.vscodeApi.window.createStatusBarItem(
      STATUS_BAR_ID,
      this.vscodeApi.StatusBarAlignment.Right,
      STATUS_BAR_PRIORITY,
    );
    this.statusBarItem.command = 'coderag.status';
    this.update('disconnected', 0);
    this.statusBarItem.show();
  }

  /** Update the status bar with a new status and optional chunk count. */
  update(status: IndexStatus, chunkCount?: number): void {
    this.currentStatus = status;
    if (chunkCount !== undefined) {
      this.chunkCount = chunkCount;
    }

    const icon = ICONS[status];
    const label = this.getLabel(status);
    this.statusBarItem.text = `${icon} ${label}`;
    this.statusBarItem.tooltip = this.getTooltip(status);
  }

  /** Get the current status. */
  getStatus(): IndexStatus {
    return this.currentStatus;
  }

  /** Get the current chunk count. */
  getChunkCount(): number {
    return this.chunkCount;
  }

  /** Dispose the status bar item. */
  dispose(): void {
    this.statusBarItem.dispose();
  }

  private getLabel(status: IndexStatus): string {
    switch (status) {
      case 'connected':
        return `CodeRAG: ${this.chunkCount} chunks`;
      case 'indexing':
        return 'CodeRAG: Indexing...';
      case 'error':
        return 'CodeRAG: Error';
      case 'disconnected':
        return 'CodeRAG: Disconnected';
    }
  }

  private getTooltip(status: IndexStatus): string {
    switch (status) {
      case 'connected':
        return `CodeRAG connected — ${this.chunkCount} chunks indexed`;
      case 'indexing':
        return 'CodeRAG is indexing the codebase...';
      case 'error':
        return 'CodeRAG encountered an error. Click for details.';
      case 'disconnected':
        return 'CodeRAG is not connected. Click to check status.';
    }
  }
}
