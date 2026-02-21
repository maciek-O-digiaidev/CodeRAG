import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, ConfigError } from './config-parser.js';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'coderag-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should load a valid config file', () => {
    const configContent = `
version: "1"
project:
  name: test-project
  languages: auto
ingestion:
  maxTokensPerChunk: 256
  exclude:
    - node_modules
    - dist
embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: 768
llm:
  provider: ollama
  model: "qwen2.5-coder:7b"
search:
  topK: 5
  vectorWeight: 0.6
  bm25Weight: 0.4
storage:
  path: .coderag
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.project.name).toBe('test-project');
      expect(result.value.ingestion.maxTokensPerChunk).toBe(256);
      expect(result.value.search.topK).toBe(5);
      expect(result.value.search.vectorWeight).toBe(0.6);
      expect(result.value.search.bm25Weight).toBe(0.4);
    }
  });

  it('should apply defaults for missing fields', () => {
    const configContent = `
version: "1"
project:
  name: minimal-project
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.project.name).toBe('minimal-project');
      expect(result.value.project.languages).toBe('auto');
      expect(result.value.ingestion.maxTokensPerChunk).toBe(512);
      expect(result.value.embedding.provider).toBe('ollama');
      expect(result.value.embedding.model).toBe('nomic-embed-text');
      expect(result.value.embedding.dimensions).toBe(768);
      expect(result.value.llm.provider).toBe('ollama');
      expect(result.value.search.topK).toBe(10);
      expect(result.value.storage.path).toBe('.coderag');
    }
  });

  it('should return error on invalid YAML', () => {
    const invalidYaml = `
version: "1"
project:
  name: test
  invalid: [unclosed bracket
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), invalidYaml);

    const result = loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Invalid YAML');
    }
  });

  it('should return error when file does not exist', () => {
    const result = loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config file not found');
    }
  });

  it('should return error when config file contains a scalar value', () => {
    writeFileSync(join(tempDir, '.coderag.yaml'), 'just a string');

    const result = loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('empty or not a valid YAML object');
    }
  });

  it('should return error when config file is empty', () => {
    writeFileSync(join(tempDir, '.coderag.yaml'), '');

    const result = loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('empty or not a valid YAML object');
    }
  });
});

describe('barrel exports', () => {
  it('should re-export loadConfig and ConfigError from the package entry point', async () => {
    const barrel = await import('../index.js');

    expect(barrel.loadConfig).toBeDefined();
    expect(barrel.ConfigError).toBeDefined();
    expect(barrel.EmbedError).toBeDefined();
    expect(barrel.StoreError).toBeDefined();
    expect(barrel.LLMError).toBeDefined();
    expect(barrel.ParseError).toBeDefined();
    expect(barrel.ChunkError).toBeDefined();
  });
});
