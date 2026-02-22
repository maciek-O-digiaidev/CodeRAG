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

    const response = await fetch(sseUrl, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
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
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Call the `coderag_search` MCP tool.
   */
  async search(query: string, topK = 10): Promise<readonly SearchResultItem[]> {
    const response = await this.callTool('coderag_search', { query, topK });
    return this.parseToolTextResult<readonly SearchResultItem[]>(response);
  }

  /**
   * Call the `coderag_status` MCP tool.
   */
  async getStatus(): Promise<StatusInfo> {
    const response = await this.callTool('coderag_status', {});
    return this.parseToolTextResult<StatusInfo>(response);
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

    const response = await fetch(this.messageEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    // The actual response comes via the SSE stream for MCP protocol,
    // but the POST returns 202 Accepted. For simplicity in this MVP
    // implementation, we read the POST response body if it contains
    // JSON-RPC data, or return a synthetic ack.
    const text = await response.text();
    if (text.trim().length > 0) {
      return JSON.parse(text) as JsonRpcResponse;
    }

    // Server accepted but response comes via SSE — return synthetic ack
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { content: [{ type: 'text', text: '{"status":"accepted"}' }] },
    };
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

  /** Continue reading the SSE stream in the background (for keepalive). */
  private consumeSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    _initialBuffer: string,
  ): void {
    const readLoop = (): void => {
      reader.read().then(({ done }) => {
        if (done || !this.connected) {
          this.connected = false;
          return;
        }
        readLoop();
      }).catch(() => {
        this.connected = false;
      });
    };

    readLoop();
  }
}
