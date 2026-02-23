/**
 * SearchPanelProvider — WebviewViewProvider for the CodeRAG sidebar search panel.
 *
 * Renders a search interface in the VS Code sidebar, handles search queries
 * via the MCP client, and manages search history and saved searches persisted
 * in the extension's globalState.
 */

import type * as vscode from 'vscode';
import type { McpClient } from './mcp-client.js';
import type { SearchResultItem } from './types.js';
import { getSearchPanelHtml } from './search-panel-html.js';

/** Maximum number of search history entries to retain. */
const MAX_HISTORY = 50;

/** globalState key for search history. */
const HISTORY_KEY = 'coderag.searchHistory';

/** globalState key for saved searches. */
const SAVED_KEY = 'coderag.savedSearches';

/** A saved search entry (name + query). */
export interface SavedSearch {
  readonly name: string;
  readonly query: string;
}

/** Filters that can be applied to a search. */
export interface SearchFilters {
  readonly language?: string;
  readonly chunkType?: string;
}

/** Message sent from the webview to the extension host. */
export type WebviewToExtensionMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'search'; readonly query: string; readonly filters: SearchFilters }
  | { readonly type: 'openResult'; readonly filePath: string; readonly startLine: number; readonly endLine: number }
  | { readonly type: 'saveSearch'; readonly name: string; readonly query: string }
  | { readonly type: 'deleteHistory'; readonly query: string }
  | { readonly type: 'deleteSaved'; readonly name: string };

/** Message sent from the extension host to the webview. */
export type ExtensionToWebviewMessage =
  | { readonly type: 'results'; readonly items: readonly SearchResultItem[]; readonly query: string }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'history'; readonly items: readonly string[] }
  | { readonly type: 'savedSearches'; readonly items: readonly SavedSearch[] };

/** Available languages for filter dropdown. */
const DEFAULT_LANGUAGES: readonly string[] = [
  'typescript',
  'javascript',
  'python',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'scala',
  'html',
  'css',
  'json',
  'yaml',
  'markdown',
  'shell',
];

/** Available chunk types for filter dropdown. */
const DEFAULT_CHUNK_TYPES: readonly string[] = [
  'function',
  'method',
  'class',
  'interface',
  'type',
  'enum',
  'module',
  'import',
  'export',
  'variable',
  'comment',
  'block',
];

export class SearchPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'coderag.searchPanel';

  private view: vscode.WebviewView | undefined;
  private readonly extensionContext: vscode.ExtensionContext;
  private readonly client: McpClient;
  private readonly vscodeApi: typeof vscode;
  private readonly outputChannel: vscode.OutputChannel;

  constructor(
    vscodeApi: typeof vscode,
    extensionContext: vscode.ExtensionContext,
    client: McpClient,
    outputChannel: vscode.OutputChannel,
  ) {
    this.vscodeApi = vscodeApi;
    this.extensionContext = extensionContext;
    this.client = client;
    this.outputChannel = outputChannel;
  }

  /**
   * Called by VS Code when the webview view becomes visible.
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    const nonce = generateNonce();
    webviewView.webview.html = getSearchPanelHtml(nonce, DEFAULT_LANGUAGES, DEFAULT_CHUNK_TYPES);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => {
        this.handleWebviewMessage(message);
      },
      undefined,
      this.extensionContext.subscriptions,
    );
  }

  /**
   * Execute a search with optional filters.
   * Called internally when the webview sends a search message.
   */
  async search(query: string, filters: SearchFilters = {}): Promise<readonly SearchResultItem[]> {
    if (!this.client.isConnected()) {
      throw new Error('CodeRAG is not connected');
    }

    // Add to history
    this.addToHistory(query);

    // Perform the search via MCP client
    const results = await this.client.search(query);

    // Apply client-side filters
    let filtered: readonly SearchResultItem[] = results;
    if (filters.language) {
      const lang = filters.language;
      filtered = filtered.filter((r) => r.language === lang);
    }
    if (filters.chunkType) {
      const ct = filters.chunkType;
      filtered = filtered.filter((r) => r.chunkType === ct);
    }

    return filtered;
  }

  /**
   * Open a file at a specific line in the editor.
   * Paths from search results are relative to the workspace root.
   * Backlog items (backlog/AB#NNN) open in the browser as ADO work items.
   */
  async openResult(filePath: string, startLine: number, endLine: number): Promise<void> {
    // Backlog items → open ADO work item in browser
    const backlogMatch = filePath.match(/^backlog\/AB#(\d+)/);
    if (backlogMatch) {
      const adoUrl = this.vscodeApi.Uri.parse(
        `https://dev.azure.com/momc-pl/CodeRAG/_workitems/edit/${backlogMatch[1]}`,
      );
      await this.vscodeApi.env.openExternal(adoUrl);
      return;
    }

    let uri: vscode.Uri;
    if (filePath.startsWith('/')) {
      uri = this.vscodeApi.Uri.file(filePath);
    } else {
      const wsFolder = this.vscodeApi.workspace.workspaceFolders?.[0];
      if (wsFolder) {
        uri = this.vscodeApi.Uri.joinPath(wsFolder.uri, filePath);
      } else {
        uri = this.vscodeApi.Uri.file(filePath);
      }
    }
    const doc = await this.vscodeApi.workspace.openTextDocument(uri);
    const line = Math.max(0, startLine - 1);
    await this.vscodeApi.window.showTextDocument(doc, {
      selection: new this.vscodeApi.Range(line, 0, endLine, 0),
    });
  }

  /**
   * Add a query to the search history. Deduplicates and caps at MAX_HISTORY.
   */
  addToHistory(query: string): void {
    const history = this.getHistory().filter((h) => h !== query);
    history.unshift(query);
    if (history.length > MAX_HISTORY) {
      history.length = MAX_HISTORY;
    }
    void this.extensionContext.globalState.update(HISTORY_KEY, history);
  }

  /**
   * Retrieve the search history (most recent first).
   */
  getHistory(): string[] {
    return [...(this.extensionContext.globalState.get<readonly string[]>(HISTORY_KEY) ?? [])];
  }

  /**
   * Remove a specific query from the search history.
   */
  deleteFromHistory(query: string): void {
    const history = this.getHistory().filter((h) => h !== query);
    void this.extensionContext.globalState.update(HISTORY_KEY, history);
  }

  /**
   * Save a named search.
   */
  saveSearch(name: string, query: string): void {
    const saved = this.getSavedSearches().filter((s) => s.name !== name);
    saved.unshift({ name, query });
    void this.extensionContext.globalState.update(SAVED_KEY, saved);
  }

  /**
   * Retrieve all saved searches.
   */
  getSavedSearches(): SavedSearch[] {
    return [...(this.extensionContext.globalState.get<readonly SavedSearch[]>(SAVED_KEY) ?? [])];
  }

  /**
   * Delete a saved search by name.
   */
  deleteSavedSearch(name: string): void {
    const saved = this.getSavedSearches().filter((s) => s.name !== name);
    void this.extensionContext.globalState.update(SAVED_KEY, saved);
  }

  /**
   * Handle a message from the webview.
   */
  private handleWebviewMessage(message: WebviewToExtensionMessage): void {
    switch (message.type) {
      case 'ready':
        this.sendHistory();
        this.sendSavedSearches();
        break;

      case 'search':
        void this.handleSearch(message.query, message.filters);
        break;

      case 'openResult':
        void this.openResult(message.filePath, message.startLine, message.endLine).catch((error: unknown) => {
          const msg = error instanceof Error ? error.message : String(error);
          this.outputChannel.appendLine(`[search-panel] Failed to open file: ${msg}`);
        });
        break;

      case 'saveSearch':
        this.saveSearch(message.name, message.query);
        this.sendSavedSearches();
        break;

      case 'deleteHistory':
        this.deleteFromHistory(message.query);
        this.sendHistory();
        break;

      case 'deleteSaved':
        this.deleteSavedSearch(message.name);
        this.sendSavedSearches();
        break;
    }
  }

  /**
   * Handle a search request from the webview.
   */
  private async handleSearch(query: string, filters: SearchFilters): Promise<void> {
    try {
      const results = await this.search(query, filters);
      this.postMessage({ type: 'results', items: results, query });
      this.sendHistory();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[search-panel] Search error: ${msg}`);
      this.postMessage({ type: 'error', message: msg });
    }
  }

  /**
   * Send the current search history to the webview.
   */
  private sendHistory(): void {
    this.postMessage({ type: 'history', items: this.getHistory() });
  }

  /**
   * Send the current saved searches to the webview.
   */
  private sendSavedSearches(): void {
    this.postMessage({ type: 'savedSearches', items: this.getSavedSearches() });
  }

  /**
   * Post a message to the webview.
   */
  private postMessage(message: ExtensionToWebviewMessage): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }
}

/**
 * Generate a random nonce string for Content Security Policy.
 */
function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Register the SearchPanelProvider and return it.
 */
export function registerSearchPanel(
  vscodeApi: typeof vscode,
  context: vscode.ExtensionContext,
  client: McpClient,
  outputChannel: vscode.OutputChannel,
): SearchPanelProvider {
  const provider = new SearchPanelProvider(vscodeApi, context, client, outputChannel);

  const disposable = vscodeApi.window.registerWebviewViewProvider(
    SearchPanelProvider.viewType,
    provider,
  );

  context.subscriptions.push(disposable);

  return provider;
}
