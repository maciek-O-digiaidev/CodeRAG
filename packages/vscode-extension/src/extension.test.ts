/**
 * Tests for the CodeRAG VS Code extension.
 *
 * Since the `vscode` module is only available inside the VS Code runtime,
 * we mock it entirely for unit testing with vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as vscode from 'vscode';
import type { IndexStatus, SearchResultItem, StatusInfo, JsonRpcResponse } from './types.js';

// ---------------------------------------------------------------------------
// Mock vscode module
// ---------------------------------------------------------------------------

function createMockStatusBarItem(): vscode.StatusBarItem {
  return {
    id: 'coderag.status',
    alignment: 2,
    priority: 100,
    text: '',
    tooltip: '',
    color: undefined,
    backgroundColor: undefined,
    accessibilityInformation: undefined,
    command: undefined,
    name: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.StatusBarItem;
}

function createMockOutputChannel(): vscode.OutputChannel {
  return {
    name: 'CodeRAG',
    append: vi.fn(),
    appendLine: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    replace: vi.fn(),
  } as unknown as vscode.OutputChannel;
}

function createMockExtensionContext(): vscode.ExtensionContext {
  const subscriptions: Array<{ dispose: () => void }> = [];
  return {
    subscriptions,
    extensionPath: '/mock/extension',
    extensionUri: { fsPath: '/mock/extension' } as vscode.Uri,
    globalState: {
      get: vi.fn(),
      update: vi.fn(),
      keys: vi.fn(() => []),
      setKeysForSync: vi.fn(),
    },
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
      keys: vi.fn(() => []),
    },
    globalStoragePath: '/mock/global',
    globalStorageUri: { fsPath: '/mock/global' } as vscode.Uri,
    logPath: '/mock/log',
    logUri: { fsPath: '/mock/log' } as vscode.Uri,
    storagePath: '/mock/storage',
    storageUri: { fsPath: '/mock/storage' } as vscode.Uri,
    extensionMode: 3,
    secrets: {
      get: vi.fn(),
      store: vi.fn(),
      delete: vi.fn(),
      onDidChange: vi.fn(),
    },
    environmentVariableCollection: {} as vscode.GlobalEnvironmentVariableCollection,
    extension: {} as vscode.Extension<unknown>,
    languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
  } as unknown as vscode.ExtensionContext;
}

function createMockVscodeApi(): typeof vscode {
  const mockStatusBarItem = createMockStatusBarItem();

  return {
    window: {
      createStatusBarItem: vi.fn(() => mockStatusBarItem),
      createOutputChannel: vi.fn(() => createMockOutputChannel()),
      showInputBox: vi.fn(),
      showQuickPick: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showTextDocument: vi.fn(),
      withProgress: vi.fn((_opts: unknown, task: () => Promise<unknown>) => task()),
    },
    workspace: {
      workspaceFolders: [
        { uri: { fsPath: '/mock/workspace' }, name: 'mock', index: 0 },
      ],
      openTextDocument: vi.fn(),
    },
    commands: {
      registerCommand: vi.fn((_cmd: string, _handler: (...args: unknown[]) => void) => ({
        dispose: vi.fn(),
      })),
    },
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
    ProgressLocation: {
      Notification: 15,
      SourceControl: 1,
      Window: 10,
    },
    Uri: {
      file: vi.fn((path: string) => ({ fsPath: path, scheme: 'file' })),
    },
    Range: vi.fn(function (
      this: { start: { line: number; character: number }; end: { line: number; character: number } },
      startLine: number,
      startChar: number,
      endLine: number,
      endChar: number,
    ) {
      this.start = { line: startLine, character: startChar };
      this.end = { line: endLine, character: endChar };
    }),
  } as unknown as typeof vscode;
}

// ---------------------------------------------------------------------------
// StatusBarManager tests
// ---------------------------------------------------------------------------

describe('StatusBarManager', () => {
  let mockApi: ReturnType<typeof createMockVscodeApi>;

  beforeEach(() => {
    mockApi = createMockVscodeApi();
  });

  it('should create a status bar item on construction', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);

    expect(mockApi.window.createStatusBarItem).toHaveBeenCalledWith(
      'coderag.status',
      mockApi.StatusBarAlignment.Right,
      100,
    );

    expect(manager.getStatus()).toBe('disconnected');
    manager.dispose();
  });

  it('should show the status bar item on construction', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    expect(item.show).toHaveBeenCalled();
    manager.dispose();
  });

  it('should set command to coderag.status', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    expect(item.command).toBe('coderag.status');
    manager.dispose();
  });

  it('should update text for connected status', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    manager.update('connected', 42);

    expect(item.text).toContain('42 chunks');
    expect(item.text).toContain('$(database)');
    expect(manager.getStatus()).toBe('connected');
    expect(manager.getChunkCount()).toBe(42);
    manager.dispose();
  });

  it('should update text for indexing status', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    manager.update('indexing');

    expect(item.text).toContain('Indexing');
    expect(item.text).toContain('$(sync~spin)');
    manager.dispose();
  });

  it('should update text for error status', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    manager.update('error');

    expect(item.text).toContain('Error');
    expect(item.text).toContain('$(error)');
    manager.dispose();
  });

  it('should update text for disconnected status', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    manager.update('disconnected');

    expect(item.text).toContain('Disconnected');
    expect(item.text).toContain('$(debug-disconnect)');
    manager.dispose();
  });

  it('should update text for noIndex status', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    manager.update('noIndex');

    expect(item.text).toContain('No Index');
    expect(item.text).toContain('$(warning)');
    expect(manager.getStatus()).toBe('noIndex');
    manager.dispose();
  });

  it('should set tooltip for noIndex status', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    manager.update('noIndex');

    expect(item.tooltip).toContain('No CodeRAG index found');
    expect(item.tooltip).toContain('CodeRAG: Index');
    manager.dispose();
  });

  it('should set tooltip for connected status', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    manager.update('connected', 100);

    expect(item.tooltip).toContain('100 chunks indexed');
    manager.dispose();
  });

  it('should preserve chunk count when updating status without count', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);

    manager.update('connected', 50);
    expect(manager.getChunkCount()).toBe(50);

    manager.update('indexing');
    expect(manager.getChunkCount()).toBe(50);
    manager.dispose();
  });

  it('should dispose the status bar item', async () => {
    const { StatusBarManager } = await import('./status-bar.js');
    const manager = new StatusBarManager(mockApi);
    const item = (mockApi.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]!.value as vscode.StatusBarItem;

    manager.dispose();

    expect(item.dispose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// McpClient tests
// ---------------------------------------------------------------------------

describe('McpClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should default to port 3100', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const client = new McpClient();
    expect(client.isConnected()).toBe(false);
  });

  it('should accept custom port', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const client = new McpClient({ port: 4000 });
    expect(client.isConnected()).toBe(false);
  });

  it('should accept custom baseUrl', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const client = new McpClient({ baseUrl: 'http://example.com:5000' });
    expect(client.isConnected()).toBe(false);
  });

  it('should report not connected initially', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const client = new McpClient();
    expect(client.isConnected()).toBe(false);
  });

  it('should throw on search when not connected', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const client = new McpClient();
    await expect(client.search('test')).rejects.toThrow('not connected');
  });

  it('should throw on getStatus when not connected', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const client = new McpClient();
    await expect(client.getStatus()).rejects.toThrow('not connected');
  });

  it('should throw on triggerIndex when not connected', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const client = new McpClient();
    await expect(client.triggerIndex()).rejects.toThrow('not connected');
  });

  it('should disconnect cleanly even when not connected', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const client = new McpClient();
    // Should not throw
    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it('should throw on connect failure', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const client = new McpClient({ port: 19999 });

    // Expect connection to fail (no server running)
    await expect(client.connect()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Command registration tests
// ---------------------------------------------------------------------------

describe('Command registration', () => {
  let mockApi: ReturnType<typeof createMockVscodeApi>;
  let mockContext: vscode.ExtensionContext;
  let mockOutputChannel: vscode.OutputChannel;

  beforeEach(() => {
    mockApi = createMockVscodeApi();
    mockContext = createMockExtensionContext();
    mockOutputChannel = createMockOutputChannel();
  });

  it('should register the search command', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const { registerSearchCommand } = await import('./commands/search.js');
    const client = new McpClient();

    registerSearchCommand(mockApi, mockContext, client, mockOutputChannel);

    expect(mockApi.commands.registerCommand).toHaveBeenCalledWith(
      'coderag.search',
      expect.any(Function),
    );
  });

  it('should add search command disposable to subscriptions', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const { registerSearchCommand } = await import('./commands/search.js');
    const client = new McpClient();

    registerSearchCommand(mockApi, mockContext, client, mockOutputChannel);

    expect(mockContext.subscriptions.length).toBe(1);
  });

  it('should register the index command', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { registerIndexCommand } = await import('./commands/index-cmd.js');
    const client = new McpClient();
    const statusBar = new StatusBarManager(mockApi);

    registerIndexCommand(mockApi, mockContext, client, statusBar, mockOutputChannel);

    expect(mockApi.commands.registerCommand).toHaveBeenCalledWith(
      'coderag.index',
      expect.any(Function),
    );
    statusBar.dispose();
  });

  it('should register the status command', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { registerStatusCommand } = await import('./commands/status.js');
    const client = new McpClient();
    const statusBar = new StatusBarManager(mockApi);

    registerStatusCommand(mockApi, mockContext, client, statusBar, mockOutputChannel);

    expect(mockApi.commands.registerCommand).toHaveBeenCalledWith(
      'coderag.status',
      expect.any(Function),
    );
    statusBar.dispose();
  });
});

// ---------------------------------------------------------------------------
// Search command behavior tests
// ---------------------------------------------------------------------------

describe('Search command behavior', () => {
  let mockApi: ReturnType<typeof createMockVscodeApi>;
  let mockContext: vscode.ExtensionContext;
  let mockOutputChannel: vscode.OutputChannel;

  beforeEach(() => {
    mockApi = createMockVscodeApi();
    mockContext = createMockExtensionContext();
    mockOutputChannel = createMockOutputChannel();
  });

  it('should show warning when not connected', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const { registerSearchCommand } = await import('./commands/search.js');
    const client = new McpClient();

    // Mock input box to return a query
    (mockApi.window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue('test query');

    registerSearchCommand(mockApi, mockContext, client, mockOutputChannel);

    // Get the registered handler
    const registerCall = (mockApi.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0] as [string, () => Promise<void>];
    const handler = registerCall[1];

    await handler();

    expect(mockApi.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not connected'),
    );
  });

  it('should do nothing when input is cancelled', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const { registerSearchCommand } = await import('./commands/search.js');
    const client = new McpClient();

    // Mock input box to return undefined (cancelled)
    (mockApi.window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    registerSearchCommand(mockApi, mockContext, client, mockOutputChannel);

    const registerCall = (mockApi.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0] as [string, () => Promise<void>];
    const handler = registerCall[1];

    await handler();

    // Should not show any message
    expect(mockApi.window.showWarningMessage).not.toHaveBeenCalled();
    expect(mockApi.window.showErrorMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Status command behavior tests
// ---------------------------------------------------------------------------

describe('Status command behavior', () => {
  let mockApi: ReturnType<typeof createMockVscodeApi>;
  let mockContext: vscode.ExtensionContext;
  let mockOutputChannel: vscode.OutputChannel;

  beforeEach(() => {
    mockApi = createMockVscodeApi();
    mockContext = createMockExtensionContext();
    mockOutputChannel = createMockOutputChannel();
  });

  it('should show disconnected message when not connected', async () => {
    const { McpClient } = await import('./mcp-client.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { registerStatusCommand } = await import('./commands/status.js');
    const client = new McpClient();
    const statusBar = new StatusBarManager(mockApi);

    registerStatusCommand(mockApi, mockContext, client, statusBar, mockOutputChannel);

    const registerCall = (mockApi.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0] as [string, () => Promise<void>];
    const handler = registerCall[1];

    await handler();

    expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('not connected'),
    );
    expect(statusBar.getStatus()).toBe('disconnected');
    statusBar.dispose();
  });
});

// ---------------------------------------------------------------------------
// ServerManager tests
// ---------------------------------------------------------------------------

describe('ServerManager', () => {
  it('should default to port 3100', async () => {
    const { ServerManager } = await import('./server-manager.js');
    const manager = new ServerManager({
      outputChannel: createMockOutputChannel(),
      workspaceRoot: '/mock/workspace',
    });
    expect(manager.getPort()).toBe(3100);
  });

  it('should accept custom port', async () => {
    const { ServerManager } = await import('./server-manager.js');
    const manager = new ServerManager({
      port: 4200,
      outputChannel: createMockOutputChannel(),
      workspaceRoot: '/mock/workspace',
    });
    expect(manager.getPort()).toBe(4200);
  });

  it('should detect server not running on unused port', async () => {
    const { ServerManager } = await import('./server-manager.js');
    const manager = new ServerManager({
      port: 19998,
      outputChannel: createMockOutputChannel(),
      workspaceRoot: '/mock/workspace',
    });
    const running = await manager.isServerRunning();
    expect(running).toBe(false);
  });

  it('should stop cleanly when no process was spawned', async () => {
    const { ServerManager } = await import('./server-manager.js');
    const manager = new ServerManager({
      outputChannel: createMockOutputChannel(),
      workspaceRoot: '/mock/workspace',
    });
    // Should not throw
    manager.stop();
  });
});

// ---------------------------------------------------------------------------
// Types tests
// ---------------------------------------------------------------------------

describe('Types', () => {
  it('IndexStatus should support all valid values', () => {
    const statuses: IndexStatus[] = ['connected', 'indexing', 'error', 'disconnected', 'noIndex'];
    expect(statuses).toHaveLength(5);
  });

  it('SearchResultItem should be constructable', () => {
    const item: SearchResultItem = {
      chunkId: 'c1',
      content: 'function foo() {}',
      nlSummary: 'A function named foo',
      score: 0.95,
      filePath: 'src/foo.ts',
      startLine: 1,
      endLine: 3,
      language: 'typescript',
      chunkType: 'function',
      name: 'foo',
    };
    expect(item.chunkId).toBe('c1');
    expect(item.score).toBe(0.95);
  });

  it('StatusInfo should be constructable', () => {
    const status: StatusInfo = {
      totalChunks: 100,
      model: 'nomic-embed-text',
      dimensions: 768,
      languages: ['typescript', 'python'],
      storagePath: '.coderag',
      health: 'ok',
    };
    expect(status.totalChunks).toBe(100);
    expect(status.languages).toEqual(['typescript', 'python']);
  });

  it('StatusInfo should support auto languages', () => {
    const status: StatusInfo = {
      totalChunks: 0,
      model: 'unknown',
      dimensions: 0,
      languages: 'auto',
      storagePath: '',
      health: 'not_initialized',
    };
    expect(status.languages).toBe('auto');
  });

  it('JsonRpcResponse should handle error case', () => {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32600,
        message: 'Invalid request',
      },
    };
    expect(response.error?.code).toBe(-32600);
  });

  it('JsonRpcResponse should handle success case', () => {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: '{}' }] },
    };
    expect(response.result).toBeDefined();
    expect(response.error).toBeUndefined();
  });
});
