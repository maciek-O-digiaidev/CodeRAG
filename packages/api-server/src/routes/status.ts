import { Router } from 'express';
import type { LanceDBStore, CodeRAGConfig } from '@coderag/core';

export interface StatusResponse {
  total_chunks: number;
  last_indexed: string | null;
  model: string;
  languages: string[] | 'auto';
  health: 'ok' | 'degraded' | 'not_initialized';
}

export interface StatusRouteDeps {
  readonly store: LanceDBStore | null;
  readonly config: CodeRAGConfig | null;
}

export function createStatusRouter(deps: StatusRouteDeps): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      let totalChunks = 0;
      let health: StatusResponse['health'] = 'not_initialized';

      if (deps.store) {
        const countResult = await deps.store.count();
        if (countResult.isOk()) {
          totalChunks = countResult.value;
          health = totalChunks > 0 ? 'ok' : 'degraded';
        } else {
          health = 'degraded';
        }
      }

      const status: StatusResponse = {
        total_chunks: totalChunks,
        last_indexed: null,
        model: deps.config?.embedding.model ?? 'unknown',
        languages: deps.config?.project.languages ?? 'auto',
        health,
      };

      res.json(status);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        error: 'Status Check Failed',
        message,
        health: 'degraded',
      });
    }
  });

  return router;
}
