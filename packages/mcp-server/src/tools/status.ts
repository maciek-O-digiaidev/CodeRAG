import type { LanceDBStore, CodeRAGConfig } from '@coderag/core';

export interface StatusResult {
  total_chunks: number;
  last_indexed: string | null;
  model: string;
  languages: string[] | 'auto';
  health: 'ok' | 'degraded' | 'not_initialized';
}

export async function handleStatus(
  store: LanceDBStore | null,
  config: CodeRAGConfig | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    let totalChunks = 0;
    let health: StatusResult['health'] = 'not_initialized';

    if (store) {
      const countResult = await store.count();
      if (countResult.isOk()) {
        totalChunks = countResult.value;
        health = totalChunks > 0 ? 'ok' : 'degraded';
      } else {
        health = 'degraded';
      }
    }

    const status: StatusResult = {
      total_chunks: totalChunks,
      last_indexed: null,
      model: config?.embedding.model ?? 'unknown',
      languages: config?.project.languages ?? 'auto',
      health,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(status) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Status check failed',
            message,
            health: 'degraded',
          }),
        },
      ],
    };
  }
}
