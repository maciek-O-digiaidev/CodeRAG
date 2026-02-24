import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectMonorepo,
  checkOllamaStatus,
  validateApiKey,
  countFilesByLanguage,
  buildWizardConfig,
  generateYamlContent,
  runNonInteractive,
  type WizardAnswers,
  type EmbeddingProviderChoice,
} from './init-wizard.js';

// --- detectMonorepo ---

describe('detectMonorepo', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coderag-monorepo-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect pnpm-workspace.yaml', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const result = await detectMonorepo(tempDir);
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('pnpm workspaces');
  });

  it('should detect lerna.json', async () => {
    await writeFile(join(tempDir, 'lerna.json'), '{}');
    const result = await detectMonorepo(tempDir);
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('Lerna');
  });

  it('should detect nx.json', async () => {
    await writeFile(join(tempDir, 'nx.json'), '{}');
    const result = await detectMonorepo(tempDir);
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('Nx');
  });

  it('should detect packages/ directory alone', async () => {
    await mkdir(join(tempDir, 'packages'));
    const result = await detectMonorepo(tempDir);
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('unknown');
    expect(result.packagesDir).toBe(true);
  });

  it('should report packagesDir when present with monorepo config', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), '');
    await mkdir(join(tempDir, 'packages'));
    const result = await detectMonorepo(tempDir);
    expect(result.detected).toBe(true);
    expect(result.packagesDir).toBe(true);
  });

  it('should report packagesDir false when not present', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), '');
    const result = await detectMonorepo(tempDir);
    expect(result.detected).toBe(true);
    expect(result.packagesDir).toBe(false);
  });

  it('should return detected false for plain project', async () => {
    await writeFile(join(tempDir, 'index.ts'), 'export {};');
    const result = await detectMonorepo(tempDir);
    expect(result.detected).toBe(false);
    expect(result.tool).toBe('');
  });

  it('should prioritize pnpm over lerna when both exist', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), '');
    await writeFile(join(tempDir, 'lerna.json'), '{}');
    const result = await detectMonorepo(tempDir);
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('pnpm workspaces');
  });
});

// --- checkOllamaStatus ---

describe('checkOllamaStatus', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return running=true when Ollama responds with models', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [
            { name: 'nomic-embed-text:latest' },
            { name: 'llama3:latest' },
          ],
        }),
    }) as unknown as typeof globalThis.fetch;

    const status = await checkOllamaStatus('http://localhost:11434');
    expect(status.running).toBe(true);
    expect(status.models).toHaveLength(2);
    expect(status.hasNomicEmbed).toBe(true);
  });

  it('should return running=true and hasNomicEmbed=false when model not present', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [{ name: 'llama3:latest' }],
        }),
    }) as unknown as typeof globalThis.fetch;

    const status = await checkOllamaStatus('http://localhost:11434');
    expect(status.running).toBe(true);
    expect(status.hasNomicEmbed).toBe(false);
  });

  it('should return running=false when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error('Connection refused'),
    ) as unknown as typeof globalThis.fetch;

    const status = await checkOllamaStatus('http://localhost:11434');
    expect(status.running).toBe(false);
    expect(status.models).toEqual([]);
    expect(status.hasNomicEmbed).toBe(false);
  });

  it('should return running=false when response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as unknown as typeof globalThis.fetch;

    const status = await checkOllamaStatus('http://localhost:11434');
    expect(status.running).toBe(false);
  });

  it('should handle empty models array', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [] }),
    }) as unknown as typeof globalThis.fetch;

    const status = await checkOllamaStatus('http://localhost:11434');
    expect(status.running).toBe(true);
    expect(status.models).toEqual([]);
    expect(status.hasNomicEmbed).toBe(false);
  });

  it('should handle missing models field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }) as unknown as typeof globalThis.fetch;

    const status = await checkOllamaStatus('http://localhost:11434');
    expect(status.running).toBe(true);
    expect(status.models).toEqual([]);
  });
});

// --- validateApiKey ---

describe('validateApiKey', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return valid=true for successful OpenAI validation', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0.1] }] }),
    }) as unknown as typeof globalThis.fetch;

    const result = await validateApiKey('openai', 'sk-test-key');
    expect(result.valid).toBe(true);
  });

  it('should return valid=false for failed OpenAI validation', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Invalid API key'),
    }) as unknown as typeof globalThis.fetch;

    const result = await validateApiKey('openai', 'bad-key');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('401');
  });

  it('should return valid=true for successful Voyage validation', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0.1] }] }),
    }) as unknown as typeof globalThis.fetch;

    const result = await validateApiKey('voyage', 'voy-test-key');
    expect(result.valid).toBe(true);
  });

  it('should return valid=false for failed Voyage validation', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    }) as unknown as typeof globalThis.fetch;

    const result = await validateApiKey('voyage', 'bad-key');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('403');
  });

  it('should handle network errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error('Network error'),
    ) as unknown as typeof globalThis.fetch;

    const result = await validateApiKey('openai', 'sk-test');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('should call correct endpoint for OpenAI', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = mockFetch;

    await validateApiKey('openai', 'sk-test');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      }),
    );
  });

  it('should call correct endpoint for Voyage', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = mockFetch;

    await validateApiKey('voyage', 'voy-test');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer voy-test',
        }),
      }),
    );
  });
});

// --- countFilesByLanguage ---

describe('countFilesByLanguage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coderag-count-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should count TypeScript files', async () => {
    await writeFile(join(tempDir, 'a.ts'), '');
    await writeFile(join(tempDir, 'b.ts'), '');
    await writeFile(join(tempDir, 'c.tsx'), '');
    const counts = await countFilesByLanguage(tempDir);
    expect(counts.get('typescript')).toBe(3);
  });

  it('should count multiple languages', async () => {
    await writeFile(join(tempDir, 'a.ts'), '');
    await writeFile(join(tempDir, 'b.py'), '');
    await writeFile(join(tempDir, 'c.go'), '');
    const counts = await countFilesByLanguage(tempDir);
    expect(counts.get('typescript')).toBe(1);
    expect(counts.get('python')).toBe(1);
    expect(counts.get('go')).toBe(1);
  });

  it('should return empty map for no source files', async () => {
    await writeFile(join(tempDir, 'readme.md'), '');
    const counts = await countFilesByLanguage(tempDir);
    expect(counts.size).toBe(0);
  });

  it('should skip node_modules', async () => {
    await mkdir(join(tempDir, 'node_modules'));
    await writeFile(join(tempDir, 'node_modules', 'lib.js'), '');
    const counts = await countFilesByLanguage(tempDir);
    expect(counts.has('javascript')).toBe(false);
  });

  it('should scan nested directories', async () => {
    await mkdir(join(tempDir, 'src', 'utils'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'utils', 'a.ts'), '');
    const counts = await countFilesByLanguage(tempDir);
    expect(counts.get('typescript')).toBe(1);
  });

  it('should handle non-existent directory', async () => {
    const counts = await countFilesByLanguage(join(tempDir, 'nope'));
    expect(counts.size).toBe(0);
  });
});

// --- buildWizardConfig ---

describe('buildWizardConfig', () => {
  it('should build config with Ollama defaults', () => {
    const answers: WizardAnswers = {
      embeddingProvider: 'ollama',
      projectName: 'my-project',
      languages: ['typescript', 'python'],
      isMonorepo: false,
    };
    const config = buildWizardConfig(answers);
    expect(config.version).toBe('1');
    expect(config.project.name).toBe('my-project');
    expect(config.project.languages).toEqual(['typescript', 'python']);
    expect(config.embedding.provider).toBe('ollama');
    expect(config.embedding.model).toBe('nomic-embed-text');
    expect(config.embedding.dimensions).toBe(768);
    expect(config.repos).toBeUndefined();
  });

  it('should build config with Voyage settings', () => {
    const answers: WizardAnswers = {
      embeddingProvider: 'voyage',
      apiKey: 'voy-test',
      projectName: 'test',
      languages: [],
      isMonorepo: false,
    };
    const config = buildWizardConfig(answers);
    expect(config.embedding.provider).toBe('voyage');
    expect(config.embedding.model).toBe('voyage-code-3');
    expect(config.embedding.dimensions).toBe(1024);
  });

  it('should build config with OpenAI settings', () => {
    const answers: WizardAnswers = {
      embeddingProvider: 'openai',
      apiKey: 'sk-test',
      projectName: 'test',
      languages: [],
      isMonorepo: false,
    };
    const config = buildWizardConfig(answers);
    expect(config.embedding.provider).toBe('openai');
    expect(config.embedding.model).toBe('text-embedding-3-small');
    expect(config.embedding.dimensions).toBe(1536);
  });

  it('should use "auto" when no languages detected', () => {
    const answers: WizardAnswers = {
      embeddingProvider: 'ollama',
      projectName: 'test',
      languages: [],
      isMonorepo: false,
    };
    const config = buildWizardConfig(answers);
    expect(config.project.languages).toBe('auto');
  });

  it('should include repos array for monorepo', () => {
    const answers: WizardAnswers = {
      embeddingProvider: 'ollama',
      projectName: 'test',
      languages: ['typescript'],
      isMonorepo: true,
    };
    const config = buildWizardConfig(answers);
    expect(config.repos).toBeDefined();
    expect(config.repos).toEqual([]);
  });

  it('should set sensible defaults for search config', () => {
    const answers: WizardAnswers = {
      embeddingProvider: 'ollama',
      projectName: 'test',
      languages: [],
      isMonorepo: false,
    };
    const config = buildWizardConfig(answers);
    expect(config.search.topK).toBe(10);
    expect(config.search.vectorWeight).toBe(0.7);
    expect(config.search.bm25Weight).toBe(0.3);
  });

  it('should set default ingestion config', () => {
    const answers: WizardAnswers = {
      embeddingProvider: 'ollama',
      projectName: 'test',
      languages: [],
      isMonorepo: false,
    };
    const config = buildWizardConfig(answers);
    expect(config.ingestion.maxTokensPerChunk).toBe(512);
    expect(config.ingestion.exclude).toContain('node_modules');
    expect(config.ingestion.exclude).toContain('.git');
  });

  it('should set default LLM config', () => {
    const answers: WizardAnswers = {
      embeddingProvider: 'openai',
      projectName: 'test',
      languages: [],
      isMonorepo: false,
    };
    const config = buildWizardConfig(answers);
    // LLM always defaults to Ollama
    expect(config.llm.provider).toBe('ollama');
    expect(config.llm.model).toBe('qwen2.5-coder:7b');
  });

  it('should set storage path to .coderag', () => {
    const answers: WizardAnswers = {
      embeddingProvider: 'ollama',
      projectName: 'test',
      languages: [],
      isMonorepo: false,
    };
    const config = buildWizardConfig(answers);
    expect(config.storage.path).toBe('.coderag');
  });
});

// --- generateYamlContent ---

describe('generateYamlContent', () => {
  it('should generate valid YAML', () => {
    const config = buildWizardConfig({
      embeddingProvider: 'ollama',
      projectName: 'test',
      languages: ['typescript'],
      isMonorepo: false,
    });
    const yaml = generateYamlContent(config);
    expect(yaml).toContain('version: "1"');
    expect(yaml).toContain('name: test');
    expect(yaml).toContain('provider: ollama');
    expect(yaml).toContain('model: nomic-embed-text');
  });

  it('should include multi-repo comments for monorepo config', () => {
    const config = buildWizardConfig({
      embeddingProvider: 'ollama',
      projectName: 'test',
      languages: [],
      isMonorepo: true,
    });
    const yaml = generateYamlContent(config);
    expect(yaml).toContain('repos:');
    expect(yaml).toContain('# repos:');
    expect(yaml).toContain('#   - path: /absolute/path/to/repo-a');
  });

  it('should not include repos comments for non-monorepo', () => {
    const config = buildWizardConfig({
      embeddingProvider: 'ollama',
      projectName: 'test',
      languages: [],
      isMonorepo: false,
    });
    const yaml = generateYamlContent(config);
    expect(yaml).not.toContain('# repos:');
  });
});

// --- runNonInteractive ---

describe('runNonInteractive', () => {
  let tempDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coderag-ni-'));
    originalFetch = globalThis.fetch;
    // Default: Ollama not running
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error('Connection refused'),
    ) as unknown as typeof globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should create .coderag.yaml with defaults', async () => {
    // Suppress console output
    const origLog = console.log;
    console.log = vi.fn();
    try {
      await runNonInteractive(tempDir, {});
    } finally {
      console.log = origLog;
    }

    const content = await readFile(join(tempDir, '.coderag.yaml'), 'utf-8');
    expect(content).toContain('provider: ollama');
    expect(content).toContain('model: nomic-embed-text');
  });

  it('should create .coderag storage directory', async () => {
    const origLog = console.log;
    console.log = vi.fn();
    try {
      await runNonInteractive(tempDir, {});
    } finally {
      console.log = origLog;
    }

    // Verify storage dir exists by trying to access it
    const { access: accessFn } = await import('node:fs/promises');
    await expect(accessFn(join(tempDir, '.coderag'))).resolves.not.toThrow();
  });

  it('should use specified languages', async () => {
    const origLog = console.log;
    console.log = vi.fn();
    try {
      await runNonInteractive(tempDir, { languages: 'python,go' });
    } finally {
      console.log = origLog;
    }

    const content = await readFile(join(tempDir, '.coderag.yaml'), 'utf-8');
    expect(content).toContain('python');
    expect(content).toContain('go');
  });

  it('should detect languages when not specified', async () => {
    await writeFile(join(tempDir, 'main.rs'), 'fn main() {}');
    const origLog = console.log;
    console.log = vi.fn();
    try {
      await runNonInteractive(tempDir, {});
    } finally {
      console.log = origLog;
    }

    const content = await readFile(join(tempDir, '.coderag.yaml'), 'utf-8');
    expect(content).toContain('rust');
  });

  it('should enable multi-repo when --multi is set', async () => {
    const origLog = console.log;
    console.log = vi.fn();
    try {
      await runNonInteractive(tempDir, { multi: true });
    } finally {
      console.log = origLog;
    }

    const content = await readFile(join(tempDir, '.coderag.yaml'), 'utf-8');
    expect(content).toContain('repos:');
    expect(content).toContain('# repos:');
  });

  it('should auto-detect monorepo when pnpm-workspace.yaml exists', async () => {
    await writeFile(join(tempDir, 'pnpm-workspace.yaml'), '');
    const origLog = console.log;
    console.log = vi.fn();
    try {
      await runNonInteractive(tempDir, {});
    } finally {
      console.log = origLog;
    }

    const content = await readFile(join(tempDir, '.coderag.yaml'), 'utf-8');
    expect(content).toContain('repos:');
  });

  it('should use directory name as project name', async () => {
    const origLog = console.log;
    console.log = vi.fn();
    try {
      await runNonInteractive(tempDir, {});
    } finally {
      console.log = origLog;
    }

    const content = await readFile(join(tempDir, '.coderag.yaml'), 'utf-8');
    // tempDir ends with random chars, just check name field exists
    expect(content).toContain('name:');
  });

  it('should log Ollama status when running', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: 'nomic-embed-text:latest' }] }),
    }) as unknown as typeof globalThis.fetch;

    const logMock = vi.fn();
    const origLog = console.log;
    console.log = logMock;
    try {
      await runNonInteractive(tempDir, {});
    } finally {
      console.log = origLog;
    }

    const allOutput = logMock.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allOutput).toContain('Ollama is running');
    expect(allOutput).toContain('nomic-embed-text available');
  });
});

// --- init command integration ---

describe('init command with --yes flag', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coderag-init-yes-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error('Connection refused'),
    ) as unknown as typeof globalThis.fetch;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should register --yes and --default options', async () => {
    const { Command } = await import('commander');
    const { registerInitCommand } = await import('./init.js');

    const program = new Command();
    program.exitOverride();
    registerInitCommand(program);

    const initCmd = program.commands.find((c) => c.name() === 'init');
    expect(initCmd).toBeDefined();
    const opts = initCmd!.options.map((o) => o.long);
    expect(opts).toContain('--yes');
    expect(opts).toContain('--default');
  });

  it('should create config non-interactively with --yes', async () => {
    const { Command } = await import('commander');
    const { registerInitCommand } = await import('./init.js');

    const program = new Command();
    program.exitOverride();
    registerInitCommand(program);

    const origLog = console.log;
    const origErr = console.error;
    console.log = vi.fn();
    console.error = vi.fn();
    try {
      await program.parseAsync(['node', 'coderag', 'init', '--yes']);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    const content = await readFile(join(tempDir, '.coderag.yaml'), 'utf-8');
    expect(content).toContain('version');
    expect(content).toContain('provider: ollama');
  });

  it('should create config non-interactively with --default', async () => {
    const { Command } = await import('commander');
    const { registerInitCommand } = await import('./init.js');

    const program = new Command();
    program.exitOverride();
    registerInitCommand(program);

    const origLog = console.log;
    const origErr = console.error;
    console.log = vi.fn();
    console.error = vi.fn();
    try {
      await program.parseAsync(['node', 'coderag', 'init', '--default']);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    const content = await readFile(join(tempDir, '.coderag.yaml'), 'utf-8');
    expect(content).toContain('version');
    expect(content).toContain('provider: ollama');
  });
});

// --- EmbeddingProviderChoice type ---

describe('EmbeddingProviderChoice type validation', () => {
  it('should accept all valid provider choices in buildWizardConfig', () => {
    const providers: EmbeddingProviderChoice[] = ['ollama', 'voyage', 'openai'];
    for (const provider of providers) {
      const config = buildWizardConfig({
        embeddingProvider: provider,
        projectName: 'test',
        languages: [],
        isMonorepo: false,
      });
      expect(config.embedding.provider).toBe(provider);
    }
  });
});
