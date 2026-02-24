import { Command } from 'commander';
import chalk from 'chalk';
import { readdir, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { runWizard, runNonInteractive } from './init-wizard.js';

/**
 * Maps file extensions to language names for auto-detection.
 */
const EXTENSION_TO_LANGUAGE: ReadonlyMap<string, string> = new Map([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
  ['.pyw', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.java', 'java'],
  ['.cs', 'c_sharp'],
  ['.c', 'c'],
  ['.h', 'c'],
  ['.cpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.cxx', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hxx', 'cpp'],
  ['.rb', 'ruby'],
  ['.php', 'php'],
]);

/**
 * Directories to skip during language detection scan.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.coderag',
  'dist',
  'build',
  'coverage',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'vendor',
]);

/**
 * Recursively scan a directory to detect programming languages
 * based on file extensions.
 */
export async function detectLanguages(rootDir: string): Promise<string[]> {
  const found = new Set<string>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        const lang = EXTENSION_TO_LANGUAGE.get(ext);
        if (lang !== undefined) {
          found.add(lang);
        }
      }
    }
  }

  await walk(rootDir);
  return [...found].sort();
}

interface InitOptions {
  languages?: string;
  force?: boolean;
  multi?: boolean;
  yes?: boolean;
  default?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new CodeRAG project in the current directory')
    .option('--languages <langs>', 'Comma-separated list of languages (overrides auto-detection)')
    .option('--force', 'Overwrite existing configuration file')
    .option('--multi', 'Generate multi-repo configuration with repos array')
    .option('--yes', 'Non-interactive mode with sensible defaults')
    .option('--default', 'Non-interactive mode with sensible defaults (alias for --yes)')
    .action(async (options: InitOptions) => {
      try {
        const rootDir = process.cwd();

        // Check if config already exists
        const configPath = join(rootDir, '.coderag.yaml');
        if (!options.force) {
          try {
            await access(configPath);
            // eslint-disable-next-line no-console
            console.error(chalk.red('.coderag.yaml already exists.'), 'Use --force to overwrite.');
            process.exit(1);
          } catch {
            // File doesn't exist, proceed
          }
        }

        const nonInteractive = options.yes === true || options.default === true;

        if (nonInteractive) {
          await runNonInteractive(rootDir, {
            languages: options.languages,
            multi: options.multi,
          });
        } else {
          await runWizard(rootDir);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('Init failed:'), message);
        process.exit(1);
      }
    });
}
