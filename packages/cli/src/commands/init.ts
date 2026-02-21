import { Command } from 'commander';
import chalk from 'chalk';
import { readdir, writeFile, mkdir, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { stringify } from 'yaml';

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

/**
 * Build the default config object for .coderag.yaml.
 */
function buildDefaultConfig(languages: string[]): Record<string, unknown> {
  return {
    version: '1',
    project: {
      name: 'unnamed',
      languages: languages.length > 0 ? languages : 'auto',
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
}

/**
 * Check if Ollama is reachable at the default endpoint.
 */
async function checkOllama(): Promise<{ ok: boolean; message: string }> {
  const host = process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';
  try {
    const response = await globalThis.fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      return { ok: true, message: `Ollama is running at ${host}` };
    }
    return { ok: false, message: `Ollama returned status ${response.status}` };
  } catch {
    return { ok: false, message: `Ollama is not reachable at ${host}` };
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new CodeRAG project in the current directory')
    .option('--languages <langs>', 'Comma-separated list of languages (overrides auto-detection)')
    .option('--force', 'Overwrite existing configuration file')
    .action(async (options: { languages?: string; force?: boolean }) => {
      try {
        const rootDir = process.cwd();

        // Step 0: Check if config already exists
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

        // Step 1: Detect or parse languages
        let languages: string[];
        if (options.languages) {
          languages = options.languages.split(',').map((l) => l.trim()).filter((l) => l.length > 0);
          // eslint-disable-next-line no-console
          console.log(chalk.blue('Using specified languages:'), languages.join(', '));
        } else {
          // eslint-disable-next-line no-console
          console.log(chalk.blue('Scanning for project languages...'));
          languages = await detectLanguages(rootDir);
          if (languages.length > 0) {
            // eslint-disable-next-line no-console
            console.log(chalk.green('Detected languages:'), languages.join(', '));
          } else {
            // eslint-disable-next-line no-console
            console.log(chalk.yellow('No languages detected, using "auto"'));
          }
        }

        // Step 2: Write .coderag.yaml
        const config = buildDefaultConfig(languages);
        const yamlContent = stringify(config);
        await writeFile(configPath, yamlContent, 'utf-8');
        // eslint-disable-next-line no-console
        console.log(chalk.green('Created'), configPath);

        // Step 3: Create .coderag/ storage directory
        const storageDir = join(rootDir, '.coderag');
        await mkdir(storageDir, { recursive: true });
        // eslint-disable-next-line no-console
        console.log(chalk.green('Created'), storageDir);

        // Step 4: Check Ollama connectivity
        const ollamaStatus = await checkOllama();
        if (ollamaStatus.ok) {
          // eslint-disable-next-line no-console
          console.log(chalk.green('\u2714'), ollamaStatus.message);
        } else {
          // eslint-disable-next-line no-console
          console.log(chalk.yellow('\u26A0'), ollamaStatus.message);
        }

        // eslint-disable-next-line no-console
        console.log(chalk.green('\nCodeRAG initialized successfully!'));
        // eslint-disable-next-line no-console
        console.log(chalk.dim('Run "coderag index" to index your codebase.'));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('Init failed:'), message);
        process.exit(1);
      }
    });
}
