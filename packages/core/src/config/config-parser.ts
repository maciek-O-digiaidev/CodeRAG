import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Result, ok, err } from 'neverthrow';
import { parse } from 'yaml';
import type { CodeRAGConfig } from '../types/config.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

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
};

function applyDefaults(partial: Record<string, unknown>): CodeRAGConfig {
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
  } as CodeRAGConfig;
}

export function loadConfig(rootDir: string): Result<CodeRAGConfig, ConfigError> {
  const configPath = join(rootDir, '.coderag.yaml');

  let content: string;
  try {
    content = readFileSync(configPath, 'utf-8');
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

  const config = applyDefaults(parsed as Record<string, unknown>);
  return ok(config);
}
