/**
 * MCP client wrapper for communicating with the CodeRAG SSE server.
 *
 * Connects to the SSE endpoint (`GET /sse`), extracts the session-scoped
 * message endpoint, and sends JSON-RPC requests via `POST /messages`.
 */

import type {
  SearchResultItem,
  StatusInfo,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.js';

const DEFAULT_PORT = 3100;
const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface McpClientOptions {
  readonly port?: number;
  readonly baseUrl?: string;
}

export class McpClient {
  private readonly baseUrl: string;
  private messageEndpoint: string | null = null;
  private nextId = 1;
  private connected = false;
  private abortController: AbortController | null = null;
  private readonly pendingRequests = new Map<number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (reason: Error) => void;
  }>();

  constructor(options: McpClientOptions = {}) {
    const port = options.port ?? DEFAULT_PORT;
    this.baseUrl = options.baseUrl ?? `http://localhost:${port}`;
  }

  /** Whether the client has an active SSE connection. */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Establish the SSE connection and extract the session message endpoint.
   *
   * The MCP server sends an `endpoint` event on the SSE stream with the
   * URL to use for posting JSON-RPC messages (includes sessionId).
   */
  async connect(): Promise<void> {
    this.abortController = new AbortController();

    const sseUrl = `${this.baseUrl}/sse`;

    // Use the instance abort controller for the SSE stream lifetime —
    // NOT a timeout signal, which would kill the long-lived SSE connection.
    const response = await fetch(sseUrl, {
      headers: { Accept: 'text/event-stream' },
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('SSE connection returned no body');
    }

    // Read the first SSE event to get the message endpoint
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const endpointPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for SSE endpoint event'));
      }, CONNECT_TIMEOUT_MS);

      const readChunk = (): void => {
        reader.read().then(({ value, done }) => {
          if (done) {
            clearTimeout(timeout);
            reject(new Error('SSE stream closed before receiving endpoint'));
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i]!.trim();
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              // The endpoint event sends the URL as plain text data
              if (data.startsWith('/messages') || data.startsWith('http')) {
                clearTimeout(timeout);
                resolve(data);
                return;
              }
            }
          }

          buffer = lines[lines.length - 1] ?? '';
          readChunk();
        }).catch((err: unknown) => {
          clearTimeout(timeout);
          reject(err);
        });
      };

      readChunk();
    });

    const endpoint = await endpointPromise;

    // Normalize the endpoint URL
    if (endpoint.startsWith('http')) {
      this.messageEndpoint = endpoint;
    } else {
      this.messageEndpoint = `${this.baseUrl}${endpoint}`;
    }

    this.connected = true;

    // Keep reading SSE events in the background (but don't block)
    this.consumeSseStream(reader, decoder, buffer);
  }

  /** Disconnect from the SSE server. */
  disconnect(): void {
    this.connected = false;
    this.messageEndpoint = null;
    this.rejectAllPending('Client disconnected');
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Call the `coderag_search` MCP tool.
   *
   * The server returns snake_case fields wrapped in `{ results: [...] }`.
   * We translate to the extension's camelCase SearchResultItem interface.
   */
  async search(query: string, topK = 10): Promise<readonly SearchResultItem[]> {
    const response = await this.callTool('coderag_search', { query, top_k: topK });
    const raw = this.parseToolTextResult<{ results: Array<Record<string, unknown>> }>(response);
    return (raw.results ?? []).map((r) => ({
      chunkId: String(r.chunk_id ?? r.chunkId ?? ''),
      content: String(r.content ?? ''),
      nlSummary: String(r.nl_summary ?? r.nlSummary ?? ''),
      score: Number(r.score ?? 0),
      filePath: String(r.file_path ?? r.filePath ?? ''),
      startLine: Number(r.start_line ?? r.startLine ?? 0),
      endLine: Number(r.end_line ?? r.endLine ?? 0),
      language: String(r.language ?? ''),
      chunkType: String(r.chunk_type ?? r.chunkType ?? ''),
      name: String(r.name ?? ''),
    }));
  }

  /**
   * Call the `coderag_status` MCP tool.
   *
   * The server returns snake_case fields. We translate to StatusInfo.
   */
  async getStatus(): Promise<StatusInfo> {
    const response = await this.callTool('coderag_status', {});
    const raw = this.parseToolTextResult<Record<string, unknown>>(response);
    return {
      totalChunks: Number(raw.total_chunks ?? raw.totalChunks ?? 0),
      model: String(raw.model ?? 'unknown'),
      dimensions: Number(raw.dimensions ?? 0),
      languages: (raw.languages as StatusInfo['languages']) ?? 'auto',
      storagePath: String(raw.storage_path ?? raw.storagePath ?? ''),
      health: String(raw.health ?? 'unknown'),
    };
  }

  /**
   * Trigger re-indexing by calling `coderag_search` with a re-index hint.
   * In practice the CLI `coderag index` is the canonical way to re-index;
   * this is a convenience that sends a status check to verify connectivity.
   */
  async triggerIndex(): Promise<StatusInfo> {
    // The MCP server doesn't expose a dedicated "index" tool — use status
    // to confirm the server is alive and report current state.
    return this.getStatus();
  }

  /**
   * Send a tools/call JSON-RPC request to the MCP server.
   *
   * The MCP SSE protocol returns 202 Accepted for POST requests.
   * The actual JSON-RPC response arrives via the SSE stream and is
   * correlated by request ID.
   */
  private async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    if (!this.connected || !this.messageEndpoint) {
      throw new Error('MCP client is not connected');
    }

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    // Create a promise that will be resolved when the SSE stream
    // delivers the response matching this request ID.
    const responsePromise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id as number);
        reject(new Error(`MCP request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(request.id as number, {
        resolve: (value: JsonRpcResponse) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (reason: Error) => {
          clearTimeout(timeout);
          reject(reason);
        },
      });
    });

    const response = await fetch(this.messageEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      this.pendingRequests.delete(request.id as number);
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    return responsePromise;
  }

  /** Parse the text content from an MCP tool response. */
  private parseToolTextResult<T>(response: JsonRpcResponse): T {
    if (response.error) {
      throw new Error(`MCP tool error: ${response.error.message}`);
    }

    const result = response.result as { content?: Array<{ type: string; text: string }> } | undefined;
    if (!result?.content?.length) {
      throw new Error('Empty MCP tool response');
    }

    const textContent = result.content.find((c) => c.type === 'text');
    if (!textContent) {
      throw new Error('No text content in MCP tool response');
    }

    return JSON.parse(textContent.text) as T;
  }

  /**
   * Read the SSE stream in the background, parsing `message` events
   * and resolving pending request promises by JSON-RPC id.
   */
  private consumeSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    initialBuffer: string,
  ): void {
    let buffer = initialBuffer;

    const readLoop = (): void => {
      reader.read().then(({ value, done }) => {
        if (done || !this.connected) {
          this.connected = false;
          this.rejectAllPending('SSE stream closed');
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            this.handleSseData(data);
          }
        }

        readLoop();
      }).catch(() => {
        this.connected = false;
        this.rejectAllPending('SSE stream error');
      });
    };

    readLoop();
  }

  /** Try to parse an SSE data payload as a JSON-RPC response. */
  private handleSseData(data: string): void {
    // Skip non-JSON data (e.g. the initial endpoint URL)
    if (!data.startsWith('{')) {
      return;
    }

    try {
      const parsed = JSON.parse(data) as JsonRpcResponse;
      if (parsed.jsonrpc === '2.0' && parsed.id != null) {
        const pending = this.pendingRequests.get(parsed.id as number);
        if (pending) {
          this.pendingRequests.delete(parsed.id as number);
          pending.resolve(parsed);
        }
      }
    } catch {
      // Not valid JSON — ignore (keepalive pings, etc.)
    }
  }

  /** Reject all pending requests (called on disconnect). */
  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }
}
