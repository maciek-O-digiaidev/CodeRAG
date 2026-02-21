import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ignore from 'ignore';

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.coderag',
  'dist',
  'build',
];

function readIgnoreFile(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

export type IgnoreFilter = (filePath: string) => boolean;

export function createIgnoreFilter(rootDir: string): IgnoreFilter {
  const ig = ignore();

  ig.add(DEFAULT_IGNORE_PATTERNS);

  const gitignorePatterns = readIgnoreFile(join(rootDir, '.gitignore'));
  ig.add(gitignorePatterns);

  const coderagIgnorePatterns = readIgnoreFile(join(rootDir, '.coderagignore'));
  ig.add(coderagIgnorePatterns);

  return (filePath: string): boolean => ig.ignores(filePath);
}
