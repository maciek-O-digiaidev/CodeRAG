/**
 * Tests for SearchPanelProvider — CodeRAG sidebar search panel.
 *
 * Mocks the vscode API, McpClient, and globalState to test:
 *   - Provider construction and registration
 *   - Search delegation to McpClient
 *   - Client-side filter application
 *   - Search history management (add, get, dedup, max limit, delete)
 *   - Saved searches (save, get, delete, dedup by name)
 *   - Result formatting and openResult
 *   - Webview message handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as vscode from 'vscode';
import type { SearchResultItem } from './types.js';

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

interface MockMcpClient {
  isConnected: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  triggerIndex: ReturnType<typeof vi.fn>;
}

function createMockMcpClient(): MockMcpClient {
  return {
    isConnected: vi.fn(() => true),
    search: vi.fn(async () => []),
    getStatus: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    triggerIndex: vi.fn(),
  };
}

function createMockVscodeApi(): typeof vscode {
  return {
    window: {
      createStatusBarItem: vi.fn(),
      createOutputChannel: vi.fn(),
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
        { uri: { fsPath: '/mock/workspace' }, name: 'mock', index: 0 },
      ],
      openTextDocument: vi.fn(async () => ({ uri: { fsPath: '/mock/file' } })),
    },
    commands: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, SourceControl: 1, Window: 10 },
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

function createSampleResults(): SearchResultItem[] {
  return [
    {
      chunkId: 'c1',
      content: 'function parseConfig() { ... }',
      nlSummary: 'Parses the configuration file',
      score: 0.95,
      filePath: '/src/config/parser.ts',
      startLine: 10,
      endLine: 25,
      language: 'typescript',
      chunkType: 'function',
      name: 'parseConfig',
    },
    {
      chunkId: 'c2',
      content: 'class TreeSitterParser { ... }',
      nlSummary: 'Tree-sitter based code parser',
      score: 0.82,
      filePath: '/src/ingestion/tree-sitter-parser.ts',
      startLine: 1,
      endLine: 50,
      language: 'typescript',
      chunkType: 'class',
      name: 'TreeSitterParser',
    },
    {
      chunkId: 'c3',
      content: 'def embed(text): ...',
      nlSummary: 'Python embedding function',
      score: 0.71,
      filePath: '/scripts/embed.py',
      startLine: 5,
      endLine: 20,
      language: 'python',
      chunkType: 'function',
      name: 'embed',
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchPanelProvider', () => {
  let mockApi: ReturnType<typeof createMockVscodeApi>;
  let mockContext: vscode.ExtensionContext;
  let mockClient: MockMcpClient;
  let mockOutput: vscode.OutputChannel;

  beforeEach(() => {
    mockApi = createMockVscodeApi();
    mockContext = createMockExtensionContext();
    mockClient = createMockMcpClient();
    mockOutput = createMockOutputChannel();
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should construct without errors', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );
      expect(provider).toBeDefined();
    });

    it('should expose the correct viewType', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      expect(SearchPanelProvider.viewType).toBe('coderag.searchPanel');
    });
  });

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  describe('registerSearchPanel', () => {
    it('should register a webview view provider', async () => {
      const { registerSearchPanel } = await import('./search-panel.js');
      registerSearchPanel(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      expect(mockApi.window.registerWebviewViewProvider).toHaveBeenCalledWith(
        'coderag.searchPanel',
        expect.any(Object),
      );
    });

    it('should add disposable to subscriptions', async () => {
      const { registerSearchPanel } = await import('./search-panel.js');
      registerSearchPanel(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      expect(mockContext.subscriptions.length).toBe(1);
    });

    it('should return the provider instance', async () => {
      const { registerSearchPanel, SearchPanelProvider } = await import('./search-panel.js');
      const provider = registerSearchPanel(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      expect(provider).toBeInstanceOf(SearchPanelProvider);
    });
  });

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  describe('search', () => {
    it('should delegate to McpClient.search', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      const sampleResults = createSampleResults();
      mockClient.search.mockResolvedValue(sampleResults);

      const results = await provider.search('parse config');

      expect(mockClient.search).toHaveBeenCalledWith('parse config');
      expect(results).toEqual(sampleResults);
    });

    it('should throw when client is not connected', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      mockClient.isConnected.mockReturnValue(false);

      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      await expect(provider.search('test')).rejects.toThrow('not connected');
    });

    it('should add query to history when searching', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      mockClient.search.mockResolvedValue([]);

      await provider.search('my query');

      const history = provider.getHistory();
      expect(history).toContain('my query');
    });

    it('should filter results by language', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      mockClient.search.mockResolvedValue(createSampleResults());

      const results = await provider.search('test', { language: 'python' });

      expect(results).toHaveLength(1);
      expect(results[0]!.language).toBe('python');
    });

    it('should filter results by chunk type', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      mockClient.search.mockResolvedValue(createSampleResults());

      const results = await provider.search('test', { chunkType: 'class' });

      expect(results).toHaveLength(1);
      expect(results[0]!.chunkType).toBe('class');
    });

    it('should apply both language and chunk type filters', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      mockClient.search.mockResolvedValue(createSampleResults());

      const results = await provider.search('test', {
        language: 'typescript',
        chunkType: 'function',
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.language).toBe('typescript');
      expect(results[0]!.chunkType).toBe('function');
    });

    it('should return empty array when filters match nothing', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      mockClient.search.mockResolvedValue(createSampleResults());

      const results = await provider.search('test', { language: 'rust' });

      expect(results).toHaveLength(0);
    });

    it('should return all results when no filters specified', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      const sampleResults = createSampleResults();
      mockClient.search.mockResolvedValue(sampleResults);

      const results = await provider.search('test', {});

      expect(results).toHaveLength(sampleResults.length);
    });
  });

  // -----------------------------------------------------------------------
  // Search History
  // -----------------------------------------------------------------------

  describe('search history', () => {
    it('should return empty history initially', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      expect(provider.getHistory()).toEqual([]);
    });

    it('should add to history', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.addToHistory('query one');
      provider.addToHistory('query two');

      const history = provider.getHistory();
      expect(history).toEqual(['query two', 'query one']);
    });

    it('should deduplicate history entries', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.addToHistory('query');
      provider.addToHistory('other');
      provider.addToHistory('query');

      const history = provider.getHistory();
      expect(history).toEqual(['query', 'other']);
    });

    it('should cap history at max limit', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      // Add 55 unique entries (MAX_HISTORY is 50)
      for (let i = 0; i < 55; i++) {
        provider.addToHistory(`query-${i}`);
      }

      const history = provider.getHistory();
      expect(history.length).toBeLessThanOrEqual(50);
      // Most recent should be first
      expect(history[0]).toBe('query-54');
    });

    it('should delete from history', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.addToHistory('keep');
      provider.addToHistory('remove');
      provider.addToHistory('keep too');

      provider.deleteFromHistory('remove');

      const history = provider.getHistory();
      expect(history).toEqual(['keep too', 'keep']);
    });

    it('should persist history via globalState', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.addToHistory('persisted query');

      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        'coderag.searchHistory',
        expect.arrayContaining(['persisted query']),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Saved Searches
  // -----------------------------------------------------------------------

  describe('saved searches', () => {
    it('should return empty saved searches initially', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      expect(provider.getSavedSearches()).toEqual([]);
    });

    it('should save a search', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.saveSearch('My Search', 'some query');

      const saved = provider.getSavedSearches();
      expect(saved).toEqual([{ name: 'My Search', query: 'some query' }]);
    });

    it('should overwrite saved search with same name', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.saveSearch('Favorite', 'old query');
      provider.saveSearch('Favorite', 'new query');

      const saved = provider.getSavedSearches();
      expect(saved).toEqual([{ name: 'Favorite', query: 'new query' }]);
    });

    it('should save multiple searches', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.saveSearch('First', 'query 1');
      provider.saveSearch('Second', 'query 2');

      const saved = provider.getSavedSearches();
      expect(saved).toHaveLength(2);
      expect(saved[0]!.name).toBe('Second');
      expect(saved[1]!.name).toBe('First');
    });

    it('should delete a saved search by name', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.saveSearch('Keep', 'q1');
      provider.saveSearch('Remove', 'q2');

      provider.deleteSavedSearch('Remove');

      const saved = provider.getSavedSearches();
      expect(saved).toEqual([{ name: 'Keep', query: 'q1' }]);
    });

    it('should be a no-op when deleting non-existent saved search', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.saveSearch('Exists', 'q');
      provider.deleteSavedSearch('DoesNotExist');

      const saved = provider.getSavedSearches();
      expect(saved).toHaveLength(1);
    });

    it('should persist saved searches via globalState', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      provider.saveSearch('Test', 'q');

      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        'coderag.savedSearches',
        expect.arrayContaining([{ name: 'Test', query: 'q' }]),
      );
    });
  });

  // -----------------------------------------------------------------------
  // openResult
  // -----------------------------------------------------------------------

  describe('openResult', () => {
    it('should open the file at the correct line', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      await provider.openResult('/src/foo.ts', 10, 20);

      expect(mockApi.Uri.file).toHaveBeenCalledWith('/src/foo.ts');
      expect(mockApi.workspace.openTextDocument).toHaveBeenCalled();
      expect(mockApi.window.showTextDocument).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          selection: expect.any(Object),
        }),
      );
    });

    it('should clamp startLine to 0 for line 0 input', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      await provider.openResult('/src/bar.ts', 0, 5);

      // startLine - 1 = -1, clamped to 0
      expect(mockApi.Range).toHaveBeenCalledWith(0, 0, 5, 0);
    });

    it('should convert 1-based startLine to 0-based', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      await provider.openResult('/src/baz.ts', 15, 30);

      // startLine - 1 = 14
      expect(mockApi.Range).toHaveBeenCalledWith(14, 0, 30, 0);
    });
  });

  // -----------------------------------------------------------------------
  // resolveWebviewView
  // -----------------------------------------------------------------------

  describe('resolveWebviewView', () => {
    it('should set webview HTML and enable scripts', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      const mockWebview = {
        options: {},
        html: '',
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
      };
      const mockWebviewView = {
        webview: mockWebview,
      } as unknown as vscode.WebviewView;

      provider.resolveWebviewView(
        mockWebviewView,
        {} as vscode.WebviewViewResolveContext,
        { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as vscode.CancellationToken,
      );

      expect(mockWebview.options.enableScripts).toBe(true);
      expect(mockWebview.html).toContain('CodeRAG Search');
      expect(mockWebview.html).toContain('searchInput');
      expect(mockWebview.onDidReceiveMessage).toHaveBeenCalled();
    });

    it('should include filter dropdowns in webview HTML', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      const mockWebview = {
        options: {},
        html: '',
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
      };
      const mockWebviewView = {
        webview: mockWebview,
      } as unknown as vscode.WebviewView;

      provider.resolveWebviewView(
        mockWebviewView,
        {} as vscode.WebviewViewResolveContext,
        { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as vscode.CancellationToken,
      );

      expect(mockWebview.html).toContain('languageFilter');
      expect(mockWebview.html).toContain('chunkTypeFilter');
      expect(mockWebview.html).toContain('typescript');
      expect(mockWebview.html).toContain('function');
    });

    it('should include history and saved searches sections', async () => {
      const { SearchPanelProvider } = await import('./search-panel.js');
      const provider = new SearchPanelProvider(
        mockApi,
        mockContext,
        mockClient as unknown as import('./mcp-client.js').McpClient,
        mockOutput,
      );

      const mockWebview = {
        options: {},
        html: '',
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
      };
      const mockWebviewView = {
        webview: mockWebview,
      } as unknown as vscode.WebviewView;

      provider.resolveWebviewView(
        mockWebviewView,
        {} as vscode.WebviewViewResolveContext,
        { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as vscode.CancellationToken,
      );

      expect(mockWebview.html).toContain('Search History');
      expect(mockWebview.html).toContain('Saved Searches');
    });
  });
});

// ---------------------------------------------------------------------------
// HTML template tests
// ---------------------------------------------------------------------------

describe('getSearchPanelHtml', () => {
  it('should return valid HTML with nonce', async () => {
    const { getSearchPanelHtml } = await import('./search-panel-html.js');

    const html = getSearchPanelHtml('test-nonce-123', ['typescript', 'python'], ['function', 'class']);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('test-nonce-123');
    expect(html).toContain('Content-Security-Policy');
  });

  it('should include language filter options', async () => {
    const { getSearchPanelHtml } = await import('./search-panel-html.js');

    const html = getSearchPanelHtml('nonce', ['typescript', 'python', 'go'], []);

    expect(html).toContain('<option value="typescript">typescript</option>');
    expect(html).toContain('<option value="python">python</option>');
    expect(html).toContain('<option value="go">go</option>');
  });

  it('should include chunk type filter options', async () => {
    const { getSearchPanelHtml } = await import('./search-panel-html.js');

    const html = getSearchPanelHtml('nonce', [], ['function', 'class', 'interface']);

    expect(html).toContain('<option value="function">function</option>');
    expect(html).toContain('<option value="class">class</option>');
    expect(html).toContain('<option value="interface">interface</option>');
  });

  it('should include "All" default option for filters', async () => {
    const { getSearchPanelHtml } = await import('./search-panel-html.js');

    const html = getSearchPanelHtml('nonce', [], []);

    expect(html).toContain('All languages');
    expect(html).toContain('All types');
  });

  it('should escape HTML in language names', async () => {
    const { getSearchPanelHtml } = await import('./search-panel-html.js');

    const html = getSearchPanelHtml('nonce', ['c++<script>'], []);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should include search input and button', async () => {
    const { getSearchPanelHtml } = await import('./search-panel-html.js');

    const html = getSearchPanelHtml('nonce', [], []);

    expect(html).toContain('id="searchInput"');
    expect(html).toContain('id="searchBtn"');
  });

  it('should include webview message passing script', async () => {
    const { getSearchPanelHtml } = await import('./search-panel-html.js');

    const html = getSearchPanelHtml('nonce', [], []);

    expect(html).toContain('acquireVsCodeApi');
    expect(html).toContain('postMessage');
  });

  it('should use VS Code CSS variables for theming', async () => {
    const { getSearchPanelHtml } = await import('./search-panel-html.js');

    const html = getSearchPanelHtml('nonce', [], []);

    expect(html).toContain('--vscode-input-background');
    expect(html).toContain('--vscode-button-background');
    expect(html).toContain('--vscode-foreground');
    expect(html).toContain('--vscode-sideBar-background');
  });
});
