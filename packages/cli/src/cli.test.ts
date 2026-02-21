import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerIndexCommand } from './commands/index-cmd.js';
import { registerSearchCommand } from './commands/search.js';
import { registerServeCommand } from './commands/serve.js';
import { registerStatusCommand } from './commands/status.js';
import { detectLanguages } from './commands/init.js';
import { formatSearchResult } from './commands/search.js';
import { formatStatus, formatStatusJSON, type StatusInfo } from './commands/status.js';
import type { SearchResult } from '@coderag/core';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// --- Program Setup Tests ---

describe('CLI program setup', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program
      .name('coderag')
      .description('CodeRAG — intelligent codebase context engine for AI coding agents')
      .version('0.1.0');

    registerInitCommand(program);
    registerIndexCommand(program);
    registerSearchCommand(program);
    registerServeCommand(program);
    registerStatusCommand(program);
  });

  it('should create program with correct name', () => {
    expect(program.name()).toBe('coderag');
  });

  it('should create program with correct version', () => {
    expect(program.version()).toBe('0.1.0');
  });

  it('should register all 5 commands', () => {
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('index');
    expect(commandNames).toContain('search');
    expect(commandNames).toContain('serve');
    expect(commandNames).toContain('status');
  });

  it('should have exactly 5 commands', () => {
    expect(program.commands).toHaveLength(5);
  });

  it('init command should have --languages option', () => {
    const initCmd = program.commands.find((c) => c.name() === 'init');
    expect(initCmd).toBeDefined();
    const opts = initCmd!.options.map((o) => o.long);
    expect(opts).toContain('--languages');
  });

  it('index command should have --full option', () => {
    const indexCmd = program.commands.find((c) => c.name() === 'index');
    expect(indexCmd).toBeDefined();
    const opts = indexCmd!.options.map((o) => o.long);
    expect(opts).toContain('--full');
  });

  it('search command should accept a query argument', () => {
    const searchCmd = program.commands.find((c) => c.name() === 'search');
    expect(searchCmd).toBeDefined();
    // Commander registers arguments as _args
    const args = searchCmd!.registeredArguments;
    expect(args.length).toBeGreaterThan(0);
    expect(args[0]!.name()).toBe('query');
  });

  it('search command should have --top-k, --language, --type, --file options', () => {
    const searchCmd = program.commands.find((c) => c.name() === 'search');
    expect(searchCmd).toBeDefined();
    const opts = searchCmd!.options.map((o) => o.long);
    expect(opts).toContain('--top-k');
    expect(opts).toContain('--language');
    expect(opts).toContain('--type');
    expect(opts).toContain('--file');
  });

  it('serve command should have --port option', () => {
    const serveCmd = program.commands.find((c) => c.name() === 'serve');
    expect(serveCmd).toBeDefined();
    const opts = serveCmd!.options.map((o) => o.long);
    expect(opts).toContain('--port');
  });

  it('status command should have --json option', () => {
    const statusCmd = program.commands.find((c) => c.name() === 'status');
    expect(statusCmd).toBeDefined();
    const opts = statusCmd!.options.map((o) => o.long);
    expect(opts).toContain('--json');
  });
});

// --- Language Detection Tests ---

describe('detectLanguages', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coderag-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect TypeScript files', async () => {
    await writeFile(join(tempDir, 'app.ts'), 'const x = 1;');
    const langs = await detectLanguages(tempDir);
    expect(langs).toContain('typescript');
  });

  it('should detect Python files', async () => {
    await writeFile(join(tempDir, 'main.py'), 'x = 1');
    const langs = await detectLanguages(tempDir);
    expect(langs).toContain('python');
  });

  it('should detect JavaScript files', async () => {
    await writeFile(join(tempDir, 'app.js'), 'const x = 1;');
    const langs = await detectLanguages(tempDir);
    expect(langs).toContain('javascript');
  });

  it('should detect multiple languages', async () => {
    await writeFile(join(tempDir, 'app.ts'), '');
    await writeFile(join(tempDir, 'main.py'), '');
    await writeFile(join(tempDir, 'lib.go'), '');

    const langs = await detectLanguages(tempDir);
    expect(langs).toContain('typescript');
    expect(langs).toContain('python');
    expect(langs).toContain('go');
  });

  it('should return sorted languages', async () => {
    await writeFile(join(tempDir, 'app.ts'), '');
    await writeFile(join(tempDir, 'main.go'), '');
    await writeFile(join(tempDir, 'lib.py'), '');

    const langs = await detectLanguages(tempDir);
    const sorted = [...langs].sort();
    expect(langs).toEqual(sorted);
  });

  it('should return empty array for directory with no source files', async () => {
    await writeFile(join(tempDir, 'readme.md'), 'Hello');
    await writeFile(join(tempDir, 'data.json'), '{}');

    const langs = await detectLanguages(tempDir);
    expect(langs).toEqual([]);
  });

  it('should skip node_modules directory', async () => {
    await mkdir(join(tempDir, 'node_modules'), { recursive: true });
    await writeFile(join(tempDir, 'node_modules', 'lib.js'), '');

    const langs = await detectLanguages(tempDir);
    expect(langs).not.toContain('javascript');
  });

  it('should scan nested directories', async () => {
    await mkdir(join(tempDir, 'src', 'utils'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'utils', 'helper.ts'), '');

    const langs = await detectLanguages(tempDir);
    expect(langs).toContain('typescript');
  });

  it('should deduplicate languages', async () => {
    await writeFile(join(tempDir, 'a.ts'), '');
    await writeFile(join(tempDir, 'b.ts'), '');
    await writeFile(join(tempDir, 'c.tsx'), '');

    const langs = await detectLanguages(tempDir);
    // typescript should appear only once
    expect(langs.filter((l) => l === 'typescript')).toHaveLength(1);
  });

  it('should detect Rust files', async () => {
    await writeFile(join(tempDir, 'main.rs'), '');
    const langs = await detectLanguages(tempDir);
    expect(langs).toContain('rust');
  });

  it('should detect Java files', async () => {
    await writeFile(join(tempDir, 'Main.java'), '');
    const langs = await detectLanguages(tempDir);
    expect(langs).toContain('java');
  });

  it('should detect C/C++ files', async () => {
    await writeFile(join(tempDir, 'main.c'), '');
    await writeFile(join(tempDir, 'lib.cpp'), '');
    const langs = await detectLanguages(tempDir);
    expect(langs).toContain('c');
    expect(langs).toContain('cpp');
  });

  it('should handle non-existent directory gracefully', async () => {
    const langs = await detectLanguages(join(tempDir, 'nonexistent'));
    expect(langs).toEqual([]);
  });
});

// --- Search Output Formatting Tests ---

describe('formatSearchResult', () => {
  function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
    return {
      chunkId: 'chunk-1',
      content: 'function hello() {}',
      nlSummary: 'A greeting function',
      score: 0.9512,
      method: 'hybrid',
      metadata: {
        chunkType: 'function',
        name: 'hello',
        declarations: [],
        imports: [],
        exports: [],
      },
      chunk: {
        id: 'chunk-1',
        content: 'function hello() {}',
        nlSummary: 'A greeting function',
        filePath: 'src/utils/hello.ts',
        startLine: 10,
        endLine: 15,
        language: 'typescript',
        metadata: {
          chunkType: 'function',
          name: 'hello',
          declarations: [],
          imports: [],
          exports: [],
        },
      },
      ...overrides,
    };
  }

  it('should include file path in output', () => {
    const output = formatSearchResult(makeResult(), 0);
    expect(output).toContain('src/utils/hello.ts');
  });

  it('should include score in output', () => {
    const output = formatSearchResult(makeResult(), 0);
    expect(output).toContain('0.9512');
  });

  it('should include chunk type in output', () => {
    const output = formatSearchResult(makeResult(), 0);
    expect(output).toContain('function');
  });

  it('should include line range in output', () => {
    const output = formatSearchResult(makeResult(), 0);
    expect(output).toContain('L10-15');
  });

  it('should include NL summary in output', () => {
    const output = formatSearchResult(makeResult(), 0);
    expect(output).toContain('A greeting function');
  });

  it('should show rank starting from 1', () => {
    const output = formatSearchResult(makeResult(), 0);
    expect(output).toContain('[1]');

    const output2 = formatSearchResult(makeResult(), 4);
    expect(output2).toContain('[5]');
  });

  it('should handle result without chunk gracefully', () => {
    const result = makeResult();
    delete result.chunk;
    const output = formatSearchResult(result, 0);
    // Should not throw
    expect(output).toBeDefined();
  });

  it('should handle empty NL summary', () => {
    const result = makeResult({ nlSummary: '' });
    const output = formatSearchResult(result, 0);
    expect(output).toBeDefined();
    // Should not include the summary line
    expect(output.split('\n')).toHaveLength(1);
  });
});

// --- Status Formatting Tests ---

describe('formatStatus', () => {
  function makeStatus(overrides: Partial<StatusInfo> = {}): StatusInfo {
    return {
      totalChunks: 42,
      model: 'nomic-embed-text',
      dimensions: 768,
      languages: ['typescript', 'python'],
      storagePath: '/path/to/.coderag',
      health: 'ok',
      ...overrides,
    };
  }

  it('should include total chunks', () => {
    const output = formatStatus(makeStatus());
    expect(output).toContain('42');
  });

  it('should include model name', () => {
    const output = formatStatus(makeStatus());
    expect(output).toContain('nomic-embed-text');
  });

  it('should include health status', () => {
    const output = formatStatus(makeStatus());
    expect(output).toContain('ok');
  });

  it('should include languages', () => {
    const output = formatStatus(makeStatus());
    expect(output).toContain('typescript');
    expect(output).toContain('python');
  });

  it('should show "auto" for auto languages', () => {
    const output = formatStatus(makeStatus({ languages: 'auto' }));
    expect(output).toContain('auto');
  });

  it('should include storage path', () => {
    const output = formatStatus(makeStatus());
    expect(output).toContain('/path/to/.coderag');
  });

  it('should include dimensions', () => {
    const output = formatStatus(makeStatus());
    expect(output).toContain('768');
  });
});

describe('formatStatusJSON', () => {
  it('should return valid JSON', () => {
    const status: StatusInfo = {
      totalChunks: 100,
      model: 'nomic-embed-text',
      dimensions: 768,
      languages: ['typescript'],
      storagePath: '.coderag',
      health: 'ok',
    };

    const json = formatStatusJSON(status);
    const parsed = JSON.parse(json) as StatusInfo;

    expect(parsed.totalChunks).toBe(100);
    expect(parsed.model).toBe('nomic-embed-text');
    expect(parsed.health).toBe('ok');
    expect(parsed.languages).toEqual(['typescript']);
  });

  it('should handle not_initialized health', () => {
    const status: StatusInfo = {
      totalChunks: 0,
      model: 'unknown',
      dimensions: 0,
      languages: 'auto',
      storagePath: '',
      health: 'not_initialized',
    };

    const json = formatStatusJSON(status);
    const parsed = JSON.parse(json) as StatusInfo;

    expect(parsed.health).toBe('not_initialized');
    expect(parsed.totalChunks).toBe(0);
  });
});
