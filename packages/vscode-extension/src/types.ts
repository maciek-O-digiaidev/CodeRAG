/**
 * Types shared across the VS Code extension modules.
 */

/** Status of the CodeRAG index. */
export type IndexStatus = 'connected' | 'indexing' | 'error' | 'disconnected' | 'noIndex';

/** Result from a CodeRAG search via MCP. */
export interface SearchResultItem {
  readonly chunkId: string;
  readonly content: string;
  readonly nlSummary: string;
  readonly score: number;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly language: string;
  readonly chunkType: string;
  readonly name: string;
}

/** Status information returned by the coderag_status MCP tool. */
export interface StatusInfo {
  readonly totalChunks: number;
  readonly model: string;
  readonly dimensions: number;
  readonly languages: readonly string[] | 'auto';
  readonly storagePath: string;
  readonly health: string;
}

/** JSON-RPC request message. */
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/** JSON-RPC response message. */
export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

/** SSE endpoint event. */
export interface SseEndpointEvent {
  readonly type: 'endpoint';
  readonly url: string;
}
