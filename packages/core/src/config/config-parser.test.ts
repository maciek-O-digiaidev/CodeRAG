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

  it('should load a valid config file', async () => {
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

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.project.name).toBe('test-project');
      expect(result.value.ingestion.maxTokensPerChunk).toBe(256);
      expect(result.value.search.topK).toBe(5);
      expect(result.value.search.vectorWeight).toBe(0.6);
      expect(result.value.search.bm25Weight).toBe(0.4);
    }
  });

  it('should accept languages as an array of strings', async () => {
    const configContent = `
version: "1"
project:
  name: multi-lang
  languages:
    - typescript
    - python
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.project.languages).toEqual(['typescript', 'python']);
    }
  });

  it('should apply defaults for missing fields', async () => {
    const configContent = `
version: "1"
project:
  name: minimal-project
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

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

  it('should return error on invalid YAML', async () => {
    const invalidYaml = `
version: "1"
project:
  name: test
  invalid: [unclosed bracket
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), invalidYaml);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Invalid YAML');
    }
  });

  it('should return error when file does not exist', async () => {
    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config file not found');
    }
  });

  it('should return error when config file contains a scalar value', async () => {
    writeFileSync(join(tempDir, '.coderag.yaml'), 'just a string');

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('empty or not a valid YAML object');
    }
  });

  it('should return error when config file is empty', async () => {
    writeFileSync(join(tempDir, '.coderag.yaml'), '');

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('empty or not a valid YAML object');
    }
  });

  // --- Zod validation edge case tests ---

  it('should return validation error for invalid dimensions (negative)', async () => {
    const configContent = `
version: "1"
project:
  name: bad-dims
embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: -5
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('dimensions');
    }
  });

  it('should return validation error for non-integer dimensions', async () => {
    const configContent = `
version: "1"
project:
  name: bad-dims
embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: 768.5
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('dimensions');
    }
  });

  it('should return validation error for empty embedding provider', async () => {
    const configContent = `
version: "1"
project:
  name: no-provider
embedding:
  provider: ""
  model: nomic-embed-text
  dimensions: 768
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('provider');
    }
  });

  it('should return validation error for empty LLM provider', async () => {
    const configContent = `
version: "1"
project:
  name: no-llm
llm:
  provider: ""
  model: "qwen2.5-coder:7b"
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('provider');
    }
  });

  it('should return validation error for negative topK', async () => {
    const configContent = `
version: "1"
project:
  name: bad-topk
search:
  topK: -3
  vectorWeight: 0.7
  bm25Weight: 0.3
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('topK');
    }
  });

  it('should return validation error for vectorWeight out of range', async () => {
    const configContent = `
version: "1"
project:
  name: bad-weight
search:
  topK: 10
  vectorWeight: 1.5
  bm25Weight: 0.3
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('vectorWeight');
    }
  });

  it('should return validation error for bm25Weight out of range', async () => {
    const configContent = `
version: "1"
project:
  name: bad-bm25
search:
  topK: 10
  vectorWeight: 0.7
  bm25Weight: -0.1
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('bm25Weight');
    }
  });

  it('should return validation error for empty version string', async () => {
    const configContent = `
version: ""
project:
  name: no-version
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('version');
    }
  });

  it('should return validation error for empty project name', async () => {
    const configContent = `
version: "1"
project:
  name: ""
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('name');
    }
  });

  it('should return validation error for empty storage path', async () => {
    const configContent = `
version: "1"
project:
  name: no-path
storage:
  path: ""
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('path');
    }
  });

  // --- Multi-repo config tests ---

  it('should load a valid multi-repo config with repos array', async () => {
    const configContent = `
version: "1"
project:
  name: multi-repo
  languages: auto
repos:
  - path: /home/dev/repo-a
    name: repo-a
    languages:
      - typescript
    exclude:
      - dist
  - path: /home/dev/repo-b
    name: repo-b
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.repos).toBeDefined();
      expect(result.value.repos).toHaveLength(2);
      expect(result.value.repos![0]!.path).toBe('/home/dev/repo-a');
      expect(result.value.repos![0]!.name).toBe('repo-a');
      expect(result.value.repos![0]!.languages).toEqual(['typescript']);
      expect(result.value.repos![0]!.exclude).toEqual(['dist']);
      expect(result.value.repos![1]!.path).toBe('/home/dev/repo-b');
      expect(result.value.repos![1]!.name).toBe('repo-b');
    }
  });

  it('should load config without repos field (single repo, backwards compatible)', async () => {
    const configContent = `
version: "1"
project:
  name: single-repo
  languages: auto
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.repos).toBeUndefined();
      expect(result.value.project.name).toBe('single-repo');
    }
  });

  it('should return validation error for repo entry missing path', async () => {
    const configContent = `
version: "1"
project:
  name: bad-repo
repos:
  - name: no-path-repo
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
    }
  });

  it('should accept repo entries with per-repo language and exclude overrides', async () => {
    const configContent = `
version: "1"
project:
  name: overrides
repos:
  - path: /repos/frontend
    languages:
      - typescript
      - javascript
    exclude:
      - node_modules
      - .next
  - path: /repos/backend
    languages:
      - python
    exclude:
      - __pycache__
      - .venv
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.repos).toHaveLength(2);
      expect(result.value.repos![0]!.languages).toEqual(['typescript', 'javascript']);
      expect(result.value.repos![0]!.exclude).toEqual(['node_modules', '.next']);
      expect(result.value.repos![1]!.languages).toEqual(['python']);
      expect(result.value.repos![1]!.exclude).toEqual(['__pycache__', '.venv']);
    }
  });

  it('should return validation error for repo with empty path', async () => {
    const configContent = `
version: "1"
project:
  name: empty-path
repos:
  - path: ""
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('path');
    }
  });

  it('should accept empty repos array', async () => {
    const configContent = `
version: "1"
project:
  name: empty-repos
repos: []
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.repos).toEqual([]);
    }
  });

  it('should accept boundary values for weights (0 and 1)', async () => {
    const configContent = `
version: "1"
project:
  name: boundary-weights
search:
  topK: 10
  vectorWeight: 0
  bm25Weight: 1
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.search.vectorWeight).toBe(0);
      expect(result.value.search.bm25Weight).toBe(1);
    }
  });

  it('should return validation error for zero topK', async () => {
    const configContent = `
version: "1"
project:
  name: zero-topk
search:
  topK: 0
  vectorWeight: 0.7
  bm25Weight: 0.3
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Config validation failed');
      expect(result.error.message).toContain('topK');
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
