import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureGitignore } from './init-wizard.js';

describe('ensureGitignore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coderag-gitignore-'));
    // Suppress console output
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should create .gitignore with .coderag/ when file does not exist', async () => {
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf-8');
    expect(content).toBe('.coderag/\n');
  });

  it('should append .coderag/ to existing .gitignore without the entry', async () => {
    await writeFile(join(tempDir, '.gitignore'), 'node_modules/\ndist/\n', 'utf-8');
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\ndist/\n.coderag/\n');
  });

  it('should not duplicate entry when .coderag/ already present', async () => {
    await writeFile(join(tempDir, '.gitignore'), 'node_modules/\n.coderag/\n', 'utf-8');
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\n.coderag/\n');
  });

  it('should not duplicate entry when .coderag (without slash) already present', async () => {
    await writeFile(join(tempDir, '.gitignore'), '.coderag\n', 'utf-8');
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf-8');
    expect(content).toBe('.coderag\n');
  });

  it('should handle .gitignore without trailing newline', async () => {
    await writeFile(join(tempDir, '.gitignore'), 'node_modules/', 'utf-8');
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\n.coderag/\n');
  });

  it('should handle empty .gitignore', async () => {
    await writeFile(join(tempDir, '.gitignore'), '', 'utf-8');
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf-8');
    expect(content).toBe('\n.coderag/\n');
  });

  it('should skip entry with surrounding whitespace', async () => {
    await writeFile(join(tempDir, '.gitignore'), '  .coderag/  \n', 'utf-8');
    await ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf-8');
    // Should NOT add duplicate since trimmed line matches
    expect(content).toBe('  .coderag/  \n');
  });
});
