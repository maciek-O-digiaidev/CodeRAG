import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as vscode from 'vscode';
import { EventEmitter } from 'node:events';

// Mock child_process.spawn to avoid actually spawning processes
vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child as any).stdout = new EventEmitter();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child as any).stderr = new EventEmitter();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child as any).kill = vi.fn(() => {
        child.emit('exit', null);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child as any).pid = 12345;
      return child;
    }),
    execSync: vi.fn(),
  };
});

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

function createMockVscodeApi() {
  const mockStatusBarItem = createMockStatusBarItem();
  return {
    window: {
      createStatusBarItem: vi.fn(() => mockStatusBarItem),
    },
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
  } as unknown as typeof vscode;
}

describe('WatcherManager', () => {
  let mockOutputChannel: vscode.OutputChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputChannel = createMockOutputChannel();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a WatcherManager instance', async () => {
    const { WatcherManager } = await import('./watcher-manager.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { McpClient } = await import('./mcp-client.js');

    const mockApi = createMockVscodeApi();
    const statusBar = new StatusBarManager(mockApi);
    const client = new McpClient();

    const manager = new WatcherManager({
      workspaceRoot: '/mock/workspace',
      outputChannel: mockOutputChannel,
      statusBar,
      mcpClient: client,
    });

    expect(manager.isRunning()).toBe(false);
    statusBar.dispose();
  });

  it('should report not running initially', async () => {
    const { WatcherManager } = await import('./watcher-manager.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { McpClient } = await import('./mcp-client.js');

    const mockApi = createMockVscodeApi();
    const statusBar = new StatusBarManager(mockApi);
    const client = new McpClient();

    const manager = new WatcherManager({
      workspaceRoot: '/mock/workspace',
      outputChannel: mockOutputChannel,
      statusBar,
      mcpClient: client,
    });

    expect(manager.isRunning()).toBe(false);
    statusBar.dispose();
  });

  it('should stop cleanly when not running', async () => {
    const { WatcherManager } = await import('./watcher-manager.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { McpClient } = await import('./mcp-client.js');

    const mockApi = createMockVscodeApi();
    const statusBar = new StatusBarManager(mockApi);
    const client = new McpClient();

    const manager = new WatcherManager({
      workspaceRoot: '/mock/workspace',
      outputChannel: mockOutputChannel,
      statusBar,
      mcpClient: client,
    });

    // Should not throw
    manager.stop();
    expect(manager.isRunning()).toBe(false);
    statusBar.dispose();
  });

  it('should log when start is called and report running', async () => {
    const { WatcherManager } = await import('./watcher-manager.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { McpClient } = await import('./mcp-client.js');

    const mockApi = createMockVscodeApi();
    const statusBar = new StatusBarManager(mockApi);
    const client = new McpClient();

    const manager = new WatcherManager({
      workspaceRoot: '/mock/workspace',
      outputChannel: mockOutputChannel,
      statusBar,
      mcpClient: client,
    });

    manager.start();

    expect(mockOutputChannel.appendLine).toHaveBeenCalled();
    expect(manager.isRunning()).toBe(true);

    manager.stop();
    expect(manager.isRunning()).toBe(false);
    statusBar.dispose();
  });

  it('should not start a second watcher if already running', async () => {
    const { WatcherManager } = await import('./watcher-manager.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { McpClient } = await import('./mcp-client.js');

    const mockApi = createMockVscodeApi();
    const statusBar = new StatusBarManager(mockApi);
    const client = new McpClient();

    const manager = new WatcherManager({
      workspaceRoot: '/mock/workspace',
      outputChannel: mockOutputChannel,
      statusBar,
      mcpClient: client,
    });

    manager.start();
    manager.start(); // Second call should log "Already running"

    const calls = (mockOutputChannel.appendLine as ReturnType<typeof vi.fn>).mock.calls;
    const alreadyRunning = calls.some(
      (call: [string]) => typeof call[0] === 'string' && call[0].includes('Already running'),
    );
    expect(alreadyRunning).toBe(true);

    manager.stop();
    statusBar.dispose();
  });

  it('should update status bar to indexing when stdout contains indexing text', async () => {
    const { WatcherManager } = await import('./watcher-manager.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { McpClient } = await import('./mcp-client.js');
    const { spawn } = await import('node:child_process');

    const mockApi = createMockVscodeApi();
    const statusBar = new StatusBarManager(mockApi);
    const client = new McpClient();

    const manager = new WatcherManager({
      workspaceRoot: '/mock/workspace',
      outputChannel: mockOutputChannel,
      statusBar,
      mcpClient: client,
    });

    manager.start();

    // Get the mock child process
    const mockSpawn = spawn as ReturnType<typeof vi.fn>;
    const child = mockSpawn.mock.results[0]!.value;

    // Simulate stdout output indicating indexing
    child.stdout.emit('data', Buffer.from('Running incremental index...\n'));
    expect(statusBar.getStatus()).toBe('indexing');

    manager.stop();
    statusBar.dispose();
  });

  it('should kill the process when stop is called', async () => {
    const { WatcherManager } = await import('./watcher-manager.js');
    const { StatusBarManager } = await import('./status-bar.js');
    const { McpClient } = await import('./mcp-client.js');
    const { spawn } = await import('node:child_process');

    const mockApi = createMockVscodeApi();
    const statusBar = new StatusBarManager(mockApi);
    const client = new McpClient();

    const manager = new WatcherManager({
      workspaceRoot: '/mock/workspace',
      outputChannel: mockOutputChannel,
      statusBar,
      mcpClient: client,
    });

    manager.start();

    const mockSpawn = spawn as ReturnType<typeof vi.fn>;
    const child = mockSpawn.mock.results[0]!.value;

    manager.stop();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.isRunning()).toBe(false);
    statusBar.dispose();
  });
});
