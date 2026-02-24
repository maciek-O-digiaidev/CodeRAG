/**
 * Tests for FirstRunDialog — multi-step configuration wizard.
 *
 * Tests:
 *   - globalState tracking (isFirstRunCompleted, markFirstRunCompleted, resetFirstRunCompleted)
 *   - Workspace detection (detectWorkspace)
 *   - Config file generation (writeCoderagYaml, writeMcpConfigForAgent)
 *   - applyFirstRunConfig orchestration
 *   - FirstRunDialogPanel lifecycle
 *   - showFirstRunDialog gating logic
 *   - registerConfigureCommand registration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('./agent-detector.js', () => ({
  detectAllAgents: vi.fn(async () => []),
  getSupportedAgentIds: vi.fn(() => ['claude', 'codex', 'gemini', 'amp', 'copilot']),
  getAgentName: vi.fn((id: string) => id),
}));

vi.mock('./first-run-dialog-html.js', () => ({
  getFirstRunDialogHtml: vi.fn(() => '<html><body>Mock Dialog</body></html>'),
}));

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  isFirstRunCompleted,
  markFirstRunCompleted,
  resetFirstRunCompleted,
  detectWorkspace,
  writeCoderagYaml,
  writeMcpConfigForAgent,
  applyFirstRunConfig,
  showFirstRunDialog,
  registerConfigureCommand,
  FirstRunDialogPanel,
} from './first-run-dialog.js';
import type { FirstRunConfig, EmbeddingProvider } from './first-run-dialog.js';
import type { AgentDetectionResult, AgentId } from './agent-detector.js';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockGlobalState(): vscode.Memento & { setKeysForSync: (keys: readonly string[]) => void } {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined => {
      return (store.has(key) ? store.get(key) : defaultValue) as T | undefined;
    }),
    update: vi.fn(async (key: string, value: unknown): Promise<void> => {
      store.set(key, value);
    }),
    keys: vi.fn(() => [...store.keys()]),
    setKeysForSync: vi.fn(),
  };
}

function createMockExtensionContext(): vscode.ExtensionContext {
  const subscriptions: Array<{ dispose: () => void }> = [];
  return {
    subscriptions,
    extensionPath: '/mock/extension',
    extensionUri: { fsPath: '/mock/extension' } as vscode.Uri,
    globalState: createMockGlobalState(),
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

function createMockWebviewPanel(): vscode.WebviewPanel {
  return {
    webview: {
      html: '',
      options: {},
      onDidReceiveMessage: vi.fn(),
      postMessage: vi.fn(),
      asWebviewUri: vi.fn(),
      cspSource: '',
    },
    onDidDispose: vi.fn(),
    dispose: vi.fn(),
    viewType: 'coderag.firstRunDialog',
    title: 'CodeRAG Setup',
    visible: true,
    active: true,
    viewColumn: 1,
    onDidChangeViewState: vi.fn(),
    reveal: vi.fn(),
    iconPath: undefined,
    options: {},
  } as unknown as vscode.WebviewPanel;
}

function createMockVscodeApi(): typeof vscode {
  const mockPanel = createMockWebviewPanel();
  return {
    window: {
      createStatusBarItem: vi.fn(),
      createOutputChannel: vi.fn(() => createMockOutputChannel()),
      createWebviewPanel: vi.fn(() => mockPanel),
      showInputBox: vi.fn(),
      showQuickPick: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showTextDocument: vi.fn(),
      withProgress: vi.fn(),
      registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
    workspace: {
      workspaceFolders: [
        { uri: { fsPath: '/mock/workspace' }, name: 'mock-project', index: 0 },
      ],
      openTextDocument: vi.fn(),
      getConfiguration: vi.fn(() => ({
        get: vi.fn(() => false),
      })),
    },
    commands: {
      registerCommand: vi.fn((_cmd: string, _handler: (...args: unknown[]) => void) => ({
        dispose: vi.fn(),
      })),
    },
    extensions: {
      getExtension: vi.fn(),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, SourceControl: 1, Window: 10 },
    ViewColumn: { One: 1, Two: 2, Three: 3 },
    Uri: {
      file: vi.fn((path: string) => ({ fsPath: path, scheme: 'file' })),
    },
    Range: vi.fn(),
  } as unknown as typeof vscode;
}

function createSampleAgent(id: AgentId, installed: boolean, version?: string): AgentDetectionResult {
  return {
    id,
    name: `${id} agent`,
    installed,
    version,
    installUrl: `https://example.com/${id}`,
    mcpConfigPath: installed ? `/mock/home/.${id}/settings.json` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FirstRunDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // globalState tracking
  // -----------------------------------------------------------------------

  describe('globalState tracking', () => {
    it('should return false when first run not completed', () => {
      const context = createMockExtensionContext();
      expect(isFirstRunCompleted(context)).toBe(false);
    });

    it('should return true after marking first run completed', async () => {
      const context = createMockExtensionContext();
      await markFirstRunCompleted(context);
      expect(isFirstRunCompleted(context)).toBe(true);
    });

    it('should return false after resetting first run', async () => {
      const context = createMockExtensionContext();
      await markFirstRunCompleted(context);
      expect(isFirstRunCompleted(context)).toBe(true);

      await resetFirstRunCompleted(context);
      expect(isFirstRunCompleted(context)).toBe(false);
    });

    it('should persist via globalState.update', async () => {
      const context = createMockExtensionContext();
      await markFirstRunCompleted(context);

      expect(context.globalState.update).toHaveBeenCalledWith(
        'coderag.firstRunCompleted',
        true,
      );
    });
  });

  // -----------------------------------------------------------------------
  // detectWorkspace
  // -----------------------------------------------------------------------

  describe('detectWorkspace', () => {
    it('should detect a Node.js workspace', async () => {
      mockedReadFile.mockImplementation(async (path: Parameters<typeof readFile>[0]) => {
        const pathStr = typeof path === 'string' ? path : String(path);
        if (pathStr.endsWith('package.json')) return '{}';
        throw new Error('ENOENT');
      });

      const info = await detectWorkspace('/mock/workspace', 'my-project');

      expect(info.workspaceName).toBe('my-project');
      expect(info.hasPackageJson).toBe(true);
      expect(info.hasCargoToml).toBe(false);
      expect(info.hasGoMod).toBe(false);
      expect(info.hasPyprojectToml).toBe(false);
      expect(info.hasCoderagYaml).toBe(false);
    });

    it('should detect existing .coderag.yaml', async () => {
      mockedReadFile.mockImplementation(async (path: Parameters<typeof readFile>[0]) => {
        const pathStr = typeof path === 'string' ? path : String(path);
        if (pathStr.endsWith('.coderag.yaml')) return 'embedding:\n  provider: ollama';
        throw new Error('ENOENT');
      });

      const info = await detectWorkspace('/mock/workspace', 'project');

      expect(info.hasCoderagYaml).toBe(true);
    });

    it('should detect multiple project types', async () => {
      mockedReadFile.mockImplementation(async (path: Parameters<typeof readFile>[0]) => {
        const pathStr = typeof path === 'string' ? path : String(path);
        if (pathStr.endsWith('package.json')) return '{}';
        if (pathStr.endsWith('pyproject.toml')) return '[tool.poetry]';
        throw new Error('ENOENT');
      });

      const info = await detectWorkspace('/mock/workspace', 'multi-project');

      expect(info.hasPackageJson).toBe(true);
      expect(info.hasPyprojectToml).toBe(true);
      expect(info.hasCargoToml).toBe(false);
      expect(info.hasGoMod).toBe(false);
    });

    it('should handle empty workspace gracefully', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));

      const info = await detectWorkspace('/empty/workspace', 'empty');

      expect(info.hasCoderagYaml).toBe(false);
      expect(info.hasPackageJson).toBe(false);
      expect(info.hasCargoToml).toBe(false);
      expect(info.hasGoMod).toBe(false);
      expect(info.hasPyprojectToml).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // writeCoderagYaml
  // -----------------------------------------------------------------------

  describe('writeCoderagYaml', () => {
    it('should create .coderag.yaml with ollama provider', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedWriteFile.mockResolvedValue();

      await writeCoderagYaml('/workspace', 'ollama');

      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/workspace/.coderag.yaml',
        expect.stringContaining('provider: ollama'),
        'utf-8',
      );
      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/workspace/.coderag.yaml',
        expect.stringContaining('model: nomic-embed-text'),
        'utf-8',
      );
    });

    it('should create .coderag.yaml with voyage provider', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedWriteFile.mockResolvedValue();

      await writeCoderagYaml('/workspace', 'voyage');

      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/workspace/.coderag.yaml',
        expect.stringContaining('provider: voyage'),
        'utf-8',
      );
      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/workspace/.coderag.yaml',
        expect.stringContaining('model: voyage-code-3'),
        'utf-8',
      );
    });

    it('should create .coderag.yaml with openai provider', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedWriteFile.mockResolvedValue();

      await writeCoderagYaml('/workspace', 'openai');

      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/workspace/.coderag.yaml',
        expect.stringContaining('provider: openai'),
        'utf-8',
      );
      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/workspace/.coderag.yaml',
        expect.stringContaining('model: text-embedding-3-small'),
        'utf-8',
      );
    });

    it('should not overwrite existing non-empty .coderag.yaml', async () => {
      const existingContent = 'embedding:\n  provider: existing\n';
      mockedReadFile.mockResolvedValue(existingContent);
      mockedWriteFile.mockResolvedValue();

      await writeCoderagYaml('/workspace', 'ollama');

      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/workspace/.coderag.yaml',
        existingContent,
        'utf-8',
      );
    });
  });

  // -----------------------------------------------------------------------
  // writeMcpConfigForAgent
  // -----------------------------------------------------------------------

  describe('writeMcpConfigForAgent', () => {
    it('should write MCP config for agent with config path', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      const agent = createSampleAgent('claude', true, '1.0.0');
      await writeMcpConfigForAgent('claude', agent, 3100);

      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringContaining('.claude'),
        { recursive: true },
      );
      expect(mockedWriteFile).toHaveBeenCalled();

      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
      expect(parsed).toEqual({
        mcpServers: {
          coderag: {
            command: 'npx',
            args: ['coderag', 'serve', '--port', '3100'],
          },
        },
      });
    });

    it('should merge with existing config', async () => {
      const existing = {
        mcpServers: {
          other: { command: 'node', args: ['other.js'] },
        },
        customKey: 'keep',
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      const agent = createSampleAgent('claude', true, '1.0.0');
      await writeMcpConfigForAgent('claude', agent, 3100);

      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
      expect(parsed).toEqual({
        mcpServers: {
          other: { command: 'node', args: ['other.js'] },
          coderag: {
            command: 'npx',
            args: ['coderag', 'serve', '--port', '3100'],
          },
        },
        customKey: 'keep',
      });
    });

    it('should do nothing for agent without config path', async () => {
      const agent: AgentDetectionResult = {
        id: 'copilot',
        name: 'GitHub Copilot',
        installed: true,
        installUrl: 'https://example.com',
      };

      await writeMcpConfigForAgent('copilot', agent, 3100);

      expect(mockedWriteFile).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // applyFirstRunConfig
  // -----------------------------------------------------------------------

  describe('applyFirstRunConfig', () => {
    it('should write yaml and MCP configs for selected agents', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      const agentConfigs = new Map<AgentId, boolean>([
        ['claude', true],
        ['codex', false],
      ]);

      const config: FirstRunConfig = {
        embeddingProvider: 'ollama',
        agentConfigs,
        startIndexing: false,
      };

      const detectedAgents: AgentDetectionResult[] = [
        createSampleAgent('claude', true, '1.0.0'),
        createSampleAgent('codex', true, '0.1.0'),
      ];

      await applyFirstRunConfig(config, '/workspace', detectedAgents, 3100);

      // Should write .coderag.yaml
      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/workspace/.coderag.yaml',
        expect.stringContaining('provider: ollama'),
        'utf-8',
      );

      // Should write MCP config for claude (enabled) but not codex (disabled)
      const writeFileCalls = mockedWriteFile.mock.calls;
      const claudeConfigWrite = writeFileCalls.find(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('.claude'),
      );
      expect(claudeConfigWrite).toBeDefined();

      const codexConfigWrite = writeFileCalls.find(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('.codex'),
      );
      expect(codexConfigWrite).toBeUndefined();
    });

    it('should skip agents that are not installed', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      const agentConfigs = new Map<AgentId, boolean>([
        ['claude', true],
      ]);

      const config: FirstRunConfig = {
        embeddingProvider: 'ollama',
        agentConfigs,
        startIndexing: false,
      };

      const detectedAgents: AgentDetectionResult[] = [
        createSampleAgent('claude', false),
      ];

      await applyFirstRunConfig(config, '/workspace', detectedAgents, 3100);

      // Should only write .coderag.yaml, not agent config (agent not installed)
      const writeFileCalls = mockedWriteFile.mock.calls;
      const claudeConfigWrite = writeFileCalls.find(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('.claude'),
      );
      expect(claudeConfigWrite).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // showFirstRunDialog
  // -----------------------------------------------------------------------

  describe('showFirstRunDialog', () => {
    it('should return undefined when first run already completed', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      // Mark as completed
      (context.globalState as ReturnType<typeof createMockGlobalState>).get
        .mockImplementation((key: string) => {
          if (key === 'coderag.firstRunCompleted') return true;
          return undefined;
        });

      const result = showFirstRunDialog(mockApi, context, output, '/workspace', 3100);

      expect(result).toBeUndefined();
      expect(mockApi.window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it('should show dialog when first run not completed', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      const result = showFirstRunDialog(mockApi, context, output, '/workspace', 3100);

      expect(result).toBeDefined();
      expect(mockApi.window.createWebviewPanel).toHaveBeenCalledWith(
        'coderag.firstRunDialog',
        'CodeRAG Setup',
        expect.anything(),
        expect.objectContaining({ enableScripts: true }),
      );
    });

    it('should show dialog when forced even if already completed', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      // Mark as completed
      (context.globalState as ReturnType<typeof createMockGlobalState>).get
        .mockImplementation((key: string) => {
          if (key === 'coderag.firstRunCompleted') return true;
          return undefined;
        });

      const result = showFirstRunDialog(mockApi, context, output, '/workspace', 3100, true);

      expect(result).toBeDefined();
      expect(mockApi.window.createWebviewPanel).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // FirstRunDialogPanel
  // -----------------------------------------------------------------------

  describe('FirstRunDialogPanel', () => {
    it('should create a webview panel', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      const panel = new FirstRunDialogPanel(mockApi, context, output, '/workspace', 3100);

      expect(mockApi.window.createWebviewPanel).toHaveBeenCalledWith(
        'coderag.firstRunDialog',
        'CodeRAG Setup',
        expect.anything(),
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      );

      expect(panel.isDisposed()).toBe(false);
    });

    it('should set webview HTML content', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      new FirstRunDialogPanel(mockApi, context, output, '/workspace', 3100);

      const createdPanel = (mockApi.window.createWebviewPanel as ReturnType<typeof vi.fn>)
        .mock.results[0]!.value as vscode.WebviewPanel;
      expect(createdPanel.webview.html).toContain('Mock Dialog');
    });

    it('should register message handler', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      new FirstRunDialogPanel(mockApi, context, output, '/workspace', 3100);

      const createdPanel = (mockApi.window.createWebviewPanel as ReturnType<typeof vi.fn>)
        .mock.results[0]!.value as vscode.WebviewPanel;
      expect(createdPanel.webview.onDidReceiveMessage).toHaveBeenCalled();
    });

    it('should accept an onComplete callback', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      const panel = new FirstRunDialogPanel(mockApi, context, output, '/workspace', 3100);
      const callback = vi.fn();
      panel.onComplete(callback);

      // Callback is stored, no error
      expect(panel.isDisposed()).toBe(false);
    });

    it('should dispose the panel', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      const panel = new FirstRunDialogPanel(mockApi, context, output, '/workspace', 3100);
      panel.dispose();

      expect(panel.isDisposed()).toBe(true);
    });

    it('should not dispose twice', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      const panel = new FirstRunDialogPanel(mockApi, context, output, '/workspace', 3100);
      panel.dispose();
      panel.dispose(); // Should not throw

      const createdPanel = (mockApi.window.createWebviewPanel as ReturnType<typeof vi.fn>)
        .mock.results[0]!.value as vscode.WebviewPanel;
      // dispose should only be called once on the underlying panel
      expect(createdPanel.dispose).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // registerConfigureCommand
  // -----------------------------------------------------------------------

  describe('registerConfigureCommand', () => {
    it('should register the coderag.configure command', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      registerConfigureCommand(mockApi, context, output, '/workspace', 3100);

      expect(mockApi.commands.registerCommand).toHaveBeenCalledWith(
        'coderag.configure',
        expect.any(Function),
      );
    });

    it('should add disposable to subscriptions', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      registerConfigureCommand(mockApi, context, output, '/workspace', 3100);

      expect(context.subscriptions.length).toBe(1);
    });

    it('should show dialog with force=true when command is executed', () => {
      const mockApi = createMockVscodeApi();
      const context = createMockExtensionContext();
      const output = createMockOutputChannel();

      // Mark first run as completed
      (context.globalState as ReturnType<typeof createMockGlobalState>).get
        .mockImplementation((key: string) => {
          if (key === 'coderag.firstRunCompleted') return true;
          return undefined;
        });

      registerConfigureCommand(mockApi, context, output, '/workspace', 3100);

      // Execute the registered command handler
      const registerCall = (mockApi.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0] as [string, () => void];
      const handler = registerCall[1];
      handler();

      // Should create panel even though first run is completed (force=true)
      expect(mockApi.window.createWebviewPanel).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // HTML template
  // -----------------------------------------------------------------------

  describe('getFirstRunDialogHtml', () => {
    it('should return HTML with the nonce', async () => {
      // Reset mock to use the real implementation
      vi.doUnmock('./first-run-dialog-html.js');
      const { getFirstRunDialogHtml } = await import('./first-run-dialog-html.js');

      const html = getFirstRunDialogHtml('test-nonce-abc');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('test-nonce-abc');
      expect(html).toContain('Content-Security-Policy');
    });

    it('should include all 4 wizard steps', async () => {
      vi.doUnmock('./first-run-dialog-html.js');
      const { getFirstRunDialogHtml } = await import('./first-run-dialog-html.js');

      const html = getFirstRunDialogHtml('nonce');

      expect(html).toContain('id="step-0"');
      expect(html).toContain('id="step-1"');
      expect(html).toContain('id="step-2"');
      expect(html).toContain('id="step-3"');
    });

    it('should include embedding provider options', async () => {
      vi.doUnmock('./first-run-dialog-html.js');
      const { getFirstRunDialogHtml } = await import('./first-run-dialog-html.js');

      const html = getFirstRunDialogHtml('nonce');

      expect(html).toContain('Ollama');
      expect(html).toContain('Voyage');
      expect(html).toContain('OpenAI');
    });

    it('should include step navigation buttons', async () => {
      vi.doUnmock('./first-run-dialog-html.js');
      const { getFirstRunDialogHtml } = await import('./first-run-dialog-html.js');

      const html = getFirstRunDialogHtml('nonce');

      expect(html).toContain('nextBtn0');
      expect(html).toContain('backBtn1');
      expect(html).toContain('finishBtn');
      expect(html).toContain('cancelBtn');
    });

    it('should include acquireVsCodeApi for messaging', async () => {
      vi.doUnmock('./first-run-dialog-html.js');
      const { getFirstRunDialogHtml } = await import('./first-run-dialog-html.js');

      const html = getFirstRunDialogHtml('nonce');

      expect(html).toContain('acquireVsCodeApi');
      expect(html).toContain('postMessage');
    });

    it('should use VS Code CSS variables for theming', async () => {
      vi.doUnmock('./first-run-dialog-html.js');
      const { getFirstRunDialogHtml } = await import('./first-run-dialog-html.js');

      const html = getFirstRunDialogHtml('nonce');

      expect(html).toContain('--vscode-editor-background');
      expect(html).toContain('--vscode-button-background');
      expect(html).toContain('--vscode-foreground');
    });

    it('should include start indexing checkbox', async () => {
      vi.doUnmock('./first-run-dialog-html.js');
      const { getFirstRunDialogHtml } = await import('./first-run-dialog-html.js');

      const html = getFirstRunDialogHtml('nonce');

      expect(html).toContain('startIndexing');
      expect(html).toContain('Start indexing');
    });
  });
});
