import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Result, ok, err } from 'neverthrow';
import { parse } from 'yaml';
import { z } from 'zod';
import type { CodeRAGConfig } from '../types/config.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// --- Zod Schemas ---

const embeddingConfigSchema = z.object({
  provider: z.string().min(1, 'Embedding provider must not be empty'),
  model: z.string().min(1, 'Embedding model must not be empty'),
  dimensions: z.number().int('Dimensions must be an integer').positive('Dimensions must be positive'),
});

const llmConfigSchema = z.object({
  provider: z.string().min(1, 'LLM provider must not be empty'),
  model: z.string().min(1, 'LLM model must not be empty'),
});

const ingestionConfigSchema = z.object({
  maxTokensPerChunk: z.number().int('maxTokensPerChunk must be an integer').positive('maxTokensPerChunk must be positive'),
  exclude: z.array(z.string()),
});

const searchConfigSchema = z.object({
  topK: z.number().int('topK must be an integer').positive('topK must be positive'),
  vectorWeight: z.number().min(0, 'vectorWeight must be between 0 and 1').max(1, 'vectorWeight must be between 0 and 1'),
  bm25Weight: z.number().min(0, 'bm25Weight must be between 0 and 1').max(1, 'bm25Weight must be between 0 and 1'),
});

const storageConfigSchema = z.object({
  path: z.string().min(1, 'Storage path must not be empty'),
});

const projectConfigSchema = z.object({
  name: z.string().min(1, 'Project name must not be empty'),
  languages: z.union([z.literal('auto'), z.array(z.string())]),
});

const rerankerConfigSchema = z.object({
  enabled: z.boolean(),
  model: z.string().min(1),
  topN: z.number().int().positive().max(50),
});

const codeRAGConfigSchema = z.object({
  version: z.string().min(1, 'Version must not be empty'),
  project: projectConfigSchema,
  ingestion: ingestionConfigSchema,
  embedding: embeddingConfigSchema,
  llm: llmConfigSchema,
  search: searchConfigSchema,
  storage: storageConfigSchema,
  reranker: rerankerConfigSchema.optional(),
});

// --- Defaults ---

const DEFAULT_CONFIG: CodeRAGConfig = {
  version: '1',
  project: {
    name: 'unnamed',
    languages: 'auto',
  },
  ingestion: {
    maxTokensPerChunk: 512,
    exclude: ['node_modules', 'dist', '.git', 'coverage'],
  },
  embedding: {
    provider: 'ollama',
    model: 'nomic-embed-text',
    dimensions: 768,
  },
  llm: {
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
  },
  search: {
    topK: 10,
    vectorWeight: 0.7,
    bm25Weight: 0.3,
  },
  storage: {
    path: '.coderag',
  },
  reranker: {
    enabled: false,
    model: 'qwen2.5-coder:7b',
    topN: 20,
  },
};

// --- Helpers ---

function formatZodErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function applyDefaults(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    version: (partial['version'] as string | undefined) ?? DEFAULT_CONFIG.version,
    project: {
      ...DEFAULT_CONFIG.project,
      ...(partial['project'] as Record<string, unknown> | undefined),
    },
    ingestion: {
      ...DEFAULT_CONFIG.ingestion,
      ...(partial['ingestion'] as Record<string, unknown> | undefined),
    },
    embedding: {
      ...DEFAULT_CONFIG.embedding,
      ...(partial['embedding'] as Record<string, unknown> | undefined),
    },
    llm: {
      ...DEFAULT_CONFIG.llm,
      ...(partial['llm'] as Record<string, unknown> | undefined),
    },
    search: {
      ...DEFAULT_CONFIG.search,
      ...(partial['search'] as Record<string, unknown> | undefined),
    },
    storage: {
      ...DEFAULT_CONFIG.storage,
      ...(partial['storage'] as Record<string, unknown> | undefined),
    },
    ...(partial['reranker'] !== undefined
      ? {
          reranker: {
            ...DEFAULT_CONFIG.reranker,
            ...(partial['reranker'] as Record<string, unknown> | undefined),
          },
        }
      : {}),
  };
}

// --- Main ---

export async function loadConfig(rootDir: string): Promise<Result<CodeRAGConfig, ConfigError>> {
  const configPath = join(rootDir, '.coderag.yaml');

  let content: string;
  try {
    content = await readFile(configPath, 'utf-8');
  } catch {
    return err(new ConfigError(`Config file not found: ${configPath}`));
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    return err(new ConfigError(`Invalid YAML in config file: ${message}`));
  }

  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    return err(new ConfigError('Config file is empty or not a valid YAML object'));
  }

  const withDefaults = applyDefaults(parsed as Record<string, unknown>);

  const validationResult = codeRAGConfigSchema.safeParse(withDefaults);
  if (!validationResult.success) {
    return err(new ConfigError(`Config validation failed: ${formatZodErrors(validationResult.error)}`));
  }

  return ok(validationResult.data as CodeRAGConfig);
}
