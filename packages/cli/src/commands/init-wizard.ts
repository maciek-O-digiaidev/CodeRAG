import chalk from 'chalk';
import { select, input, confirm } from '@inquirer/prompts';
import { stringify } from 'yaml';
import { writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { detectLanguages } from './init.js';

// --- Types ---

/** Embedding provider choice selected by the user. */
export type EmbeddingProviderChoice = 'ollama' | 'voyage' | 'openai';

/** Monorepo tool detected in the project. */
export interface MonorepoInfo {
  detected: boolean;
  tool: string;
  packagesDir: boolean;
}

/** Ollama status including available models. */
export interface OllamaStatus {
  running: boolean;
  models: string[];
  hasNomicEmbed: boolean;
}

/** Result of the wizard prompts. */
export interface WizardAnswers {
  embeddingProvider: EmbeddingProviderChoice;
  apiKey?: string;
  projectName: string;
  languages: string[];
  isMonorepo: boolean;
}

/** Full wizard configuration output. */
export interface WizardConfig {
  version: string;
  project: {
    name: string;
    languages: string[] | 'auto';
  };
  ingestion: {
    maxTokensPerChunk: number;
    exclude: string[];
  };
  embedding: {
    provider: string;
    model: string;
    dimensions: number;
  };
  llm: {
    provider: string;
    model: string;
  };
  search: {
    topK: number;
    vectorWeight: number;
    bm25Weight: number;
  };
  storage: {
    path: string;
  };
  repos?: unknown[];
}

// --- Constants ---

const EMBEDDING_PROVIDERS: ReadonlyMap<
  EmbeddingProviderChoice,
  { model: string; dimensions: number; description: string }
> = new Map([
  [
    'ollama',
    {
      model: 'nomic-embed-text',
      dimensions: 768,
      description: 'Local, free, private. Requires Ollama running on your machine.',
    },
  ],
  [
    'voyage',
    {
      model: 'voyage-code-3',
      dimensions: 1024,
      description: 'Best for code. Cloud API, requires API key. ~$0.06/1M tokens.',
    },
  ],
  [
    'openai',
    {
      model: 'text-embedding-3-small',
      dimensions: 1536,
      description: 'General purpose. Cloud API, requires API key. ~$0.02/1M tokens.',
    },
  ],
]);

const MONOREPO_INDICATORS: ReadonlyArray<{ file: string; tool: string }> = [
  { file: 'pnpm-workspace.yaml', tool: 'pnpm workspaces' },
  { file: 'lerna.json', tool: 'Lerna' },
  { file: 'nx.json', tool: 'Nx' },
];

// --- Auto-detection ---

/**
 * Detect monorepo structure by checking for common config files
 * and a packages/ directory.
 */
export async function detectMonorepo(rootDir: string): Promise<MonorepoInfo> {
  for (const indicator of MONOREPO_INDICATORS) {
    try {
      await access(join(rootDir, indicator.file));
      let packagesDir = false;
      try {
        await access(join(rootDir, 'packages'));
        packagesDir = true;
      } catch {
        // packages dir not found
      }
      return { detected: true, tool: indicator.tool, packagesDir };
    } catch {
      // File not found, try next
    }
  }

  // Check for packages/ directory even without a monorepo config
  try {
    await access(join(rootDir, 'packages'));
    return { detected: true, tool: 'unknown', packagesDir: true };
  } catch {
    return { detected: false, tool: '', packagesDir: false };
  }
}

/**
 * Check if Ollama is running and what models are available.
 */
export async function checkOllamaStatus(
  host?: string,
): Promise<OllamaStatus> {
  const baseUrl = host ?? process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';
  try {
    const response = await globalThis.fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { running: false, models: [], hasNomicEmbed: false };
    }
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    const hasNomicEmbed = models.some((m) => m.startsWith('nomic-embed-text'));
    return { running: true, models, hasNomicEmbed };
  } catch {
    return { running: false, models: [], hasNomicEmbed: false };
  }
}

/**
 * Validate an API key by making a test embedding call.
 * Returns true if the call succeeds, false otherwise.
 */
export async function validateApiKey(
  provider: 'voyage' | 'openai',
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  const testText = 'Hello, world!';

  try {
    if (provider === 'openai') {
      const response = await globalThis.fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: testText,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const text = await response.text();
        return { valid: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
      }
      return { valid: true };
    }

    // Voyage AI
    const response = await globalThis.fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'voyage-code-3',
        input: [testText],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const text = await response.text();
      return { valid: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }
    return { valid: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { valid: false, error: message };
  }
}

/**
 * Count files by extension in the root directory (non-recursive, fast scan).
 * Used for the language detection summary display.
 */
export async function countFilesByLanguage(
  rootDir: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const EXTENSION_TO_LANGUAGE: ReadonlyMap<string, string> = new Map([
    ['.ts', 'typescript'],
    ['.tsx', 'typescript'],
    ['.js', 'javascript'],
    ['.jsx', 'javascript'],
    ['.py', 'python'],
    ['.go', 'go'],
    ['.rs', 'rust'],
    ['.java', 'java'],
    ['.cs', 'c_sharp'],
    ['.c', 'c'],
    ['.cpp', 'cpp'],
    ['.rb', 'ruby'],
    ['.php', 'php'],
  ]);

  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.coderag', 'dist', 'build',
    'coverage', '.next', '__pycache__', '.venv', 'venv',
    'target', 'vendor',
  ]);

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5) return; // Limit depth for speed
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf('.'));
        const lang = EXTENSION_TO_LANGUAGE.get(ext);
        if (lang !== undefined) {
          counts.set(lang, (counts.get(lang) ?? 0) + 1);
        }
      }
    }
  }

  await walk(rootDir, 0);
  return counts;
}

// --- Config Builder ---

/**
 * Build a .coderag.yaml config object from wizard answers.
 */
export function buildWizardConfig(answers: WizardAnswers): WizardConfig {
  const providerInfo = EMBEDDING_PROVIDERS.get(answers.embeddingProvider);
  const embeddingModel = providerInfo?.model ?? 'nomic-embed-text';
  const dimensions = providerInfo?.dimensions ?? 768;

  const config: WizardConfig = {
    version: '1',
    project: {
      name: answers.projectName,
      languages: answers.languages.length > 0 ? answers.languages : 'auto',
    },
    ingestion: {
      maxTokensPerChunk: 512,
      exclude: ['node_modules', 'dist', '.git', 'coverage'],
    },
    embedding: {
      provider: answers.embeddingProvider,
      model: embeddingModel,
      dimensions,
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

  if (answers.isMonorepo) {
    config.repos = [];
  }

  return config;
}

/**
 * Generate the YAML content from a config, with optional multi-repo comments.
 */
export function generateYamlContent(config: WizardConfig): string {
  let yaml = stringify(config);
  if (config.repos !== undefined) {
    yaml += [
      '# repos:',
      '#   - path: /absolute/path/to/repo-a',
      '#     name: repo-a',
      '#     languages:',
      '#       - typescript',
      '#     exclude:',
      '#       - dist',
      '#   - path: /absolute/path/to/repo-b',
      '',
    ].join('\n');
  }
  return yaml;
}

// --- Interactive Wizard ---

/**
 * Run the interactive configuration wizard.
 * This is the main entry point called by the init command.
 */
export async function runWizard(rootDir: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(chalk.bold.blue('\n  CodeRAG Configuration Wizard\n'));

  // Step 1: Project name
  const dirName = basename(rootDir);
  const projectName = await input({
    message: 'Project name:',
    default: dirName,
  });

  // Step 2: Detect languages
  // eslint-disable-next-line no-console
  console.log(chalk.dim('\nScanning project for languages...'));
  const languages = await detectLanguages(rootDir);
  const fileCounts = await countFilesByLanguage(rootDir);

  if (languages.length > 0) {
    // eslint-disable-next-line no-console
    console.log(chalk.green('  Detected languages:'));
    for (const lang of languages) {
      const count = fileCounts.get(lang) ?? 0;
      // eslint-disable-next-line no-console
      console.log(chalk.dim(`    - ${lang} (${count} files)`));
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(chalk.yellow('  No programming languages detected. Using "auto" detection.'));
  }

  // Step 3: Detect monorepo
  const monorepo = await detectMonorepo(rootDir);
  let isMonorepo = false;
  if (monorepo.detected) {
    // eslint-disable-next-line no-console
    console.log(chalk.green(`\n  Monorepo detected: ${monorepo.tool}`));
    isMonorepo = await confirm({
      message: 'Enable multi-repo configuration?',
      default: true,
    });
  }

  // Step 4: Choose embedding provider
  // eslint-disable-next-line no-console
  console.log('');
  const embeddingProvider = await select<EmbeddingProviderChoice>({
    message: 'Embedding provider:',
    choices: [
      {
        name: `Ollama (local) - ${chalk.dim('Free, private, requires Ollama')}`,
        value: 'ollama' as const,
      },
      {
        name: `Voyage AI - ${chalk.dim('Best for code, ~$0.06/1M tokens')}`,
        value: 'voyage' as const,
      },
      {
        name: `OpenAI - ${chalk.dim('General purpose, ~$0.02/1M tokens')}`,
        value: 'openai' as const,
      },
    ],
    default: 'ollama',
  });

  let apiKey: string | undefined;

  // Step 5a: If Ollama, check availability
  if (embeddingProvider === 'ollama') {
    // eslint-disable-next-line no-console
    console.log(chalk.dim('\nChecking Ollama status...'));
    const ollamaStatus = await checkOllamaStatus();

    if (ollamaStatus.running) {
      // eslint-disable-next-line no-console
      console.log(chalk.green('  Ollama is running'));
      if (ollamaStatus.hasNomicEmbed) {
        // eslint-disable-next-line no-console
        console.log(chalk.green('  nomic-embed-text model is available'));
      } else {
        // eslint-disable-next-line no-console
        console.log(chalk.yellow('  nomic-embed-text model not found'));
        const shouldPull = await confirm({
          message: 'Pull nomic-embed-text model now?',
          default: true,
        });
        if (shouldPull) {
          // eslint-disable-next-line no-console
          console.log(chalk.dim('  Pulling model (this may take a few minutes)...'));
          try {
            await pullOllamaModel('nomic-embed-text');
            // eslint-disable-next-line no-console
            console.log(chalk.green('  Model pulled successfully'));
          } catch {
            // eslint-disable-next-line no-console
            console.log(chalk.yellow('  Failed to pull model. You can pull it later with: ollama pull nomic-embed-text'));
          }
        }
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(chalk.yellow('  Ollama is not running'));
      // eslint-disable-next-line no-console
      console.log(chalk.dim('  Start Ollama and run "ollama pull nomic-embed-text" before indexing.'));
    }
  }

  // Step 5b: If API provider, get API key
  if (embeddingProvider === 'voyage' || embeddingProvider === 'openai') {
    const envVarName = embeddingProvider === 'voyage' ? 'VOYAGE_API_KEY' : 'OPENAI_API_KEY';
    const existingKey = process.env[envVarName];

    if (existingKey) {
      // eslint-disable-next-line no-console
      console.log(chalk.green(`\n  Found ${envVarName} in environment`));
      // eslint-disable-next-line no-console
      console.log(chalk.dim('  Validating key...'));
      const validation = await validateApiKey(embeddingProvider, existingKey);
      if (validation.valid) {
        // eslint-disable-next-line no-console
        console.log(chalk.green('  API key is valid'));
        apiKey = existingKey;
      } else {
        // eslint-disable-next-line no-console
        console.log(chalk.yellow(`  API key validation failed: ${validation.error ?? 'unknown error'}`));
      }
    }

    if (!apiKey) {
      apiKey = await input({
        message: `${envVarName}:`,
        validate: (val: string) => (val.length > 0 ? true : 'API key is required'),
      });

      // eslint-disable-next-line no-console
      console.log(chalk.dim('  Validating key...'));
      const validation = await validateApiKey(embeddingProvider, apiKey);
      if (validation.valid) {
        // eslint-disable-next-line no-console
        console.log(chalk.green('  API key is valid'));
      } else {
        // eslint-disable-next-line no-console
        console.log(chalk.yellow(`  API key validation failed: ${validation.error ?? 'unknown error'}`));
        // eslint-disable-next-line no-console
        console.log(chalk.dim('  Continuing anyway. You can update the key later.'));
      }
    }
  }

  // Step 6: Build and write config
  const answers: WizardAnswers = {
    embeddingProvider,
    apiKey,
    projectName,
    languages,
    isMonorepo,
  };

  const config = buildWizardConfig(answers);
  const yamlContent = generateYamlContent(config);

  const configPath = join(rootDir, '.coderag.yaml');
  await writeFile(configPath, yamlContent, 'utf-8');
  // eslint-disable-next-line no-console
  console.log(chalk.green(`\n  Created ${configPath}`));

  // Step 7: Create storage directory
  const storageDir = join(rootDir, '.coderag');
  await mkdir(storageDir, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(chalk.green(`  Created ${storageDir}`));

  // Step 8: Summary
  // eslint-disable-next-line no-console
  console.log(chalk.bold.green('\n  CodeRAG initialized successfully!\n'));
  // eslint-disable-next-line no-console
  console.log(chalk.dim('  Next steps:'));
  // eslint-disable-next-line no-console
  console.log(chalk.dim('    1. Review .coderag.yaml and adjust settings'));
  // eslint-disable-next-line no-console
  console.log(chalk.dim('    2. Run "coderag index" to index your codebase'));
  // eslint-disable-next-line no-console
  console.log(chalk.dim('    3. Run "coderag search <query>" to search\n'));
}

/**
 * Run init with sensible defaults (non-interactive mode).
 * Used when --yes or --default flag is passed.
 */
export async function runNonInteractive(
  rootDir: string,
  options: { languages?: string; multi?: boolean },
): Promise<void> {
  const dirName = basename(rootDir);

  // Detect languages
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

  // Detect monorepo
  const monorepo = await detectMonorepo(rootDir);
  const isMonorepo = options.multi ?? monorepo.detected;

  if (monorepo.detected) {
    // eslint-disable-next-line no-console
    console.log(chalk.green('Monorepo detected:'), monorepo.tool);
  }

  // Check Ollama
  const ollamaStatus = await checkOllamaStatus();
  if (ollamaStatus.running) {
    // eslint-disable-next-line no-console
    console.log(chalk.green('\u2714'), 'Ollama is running');
    if (ollamaStatus.hasNomicEmbed) {
      // eslint-disable-next-line no-console
      console.log(chalk.green('\u2714'), 'nomic-embed-text available');
    } else {
      // eslint-disable-next-line no-console
      console.log(chalk.yellow('\u26A0'), 'nomic-embed-text not found. Run: ollama pull nomic-embed-text');
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(chalk.yellow('\u26A0'), 'Ollama is not running');
  }

  // Build config with defaults (Ollama)
  const answers: WizardAnswers = {
    embeddingProvider: 'ollama',
    projectName: dirName,
    languages,
    isMonorepo,
  };

  const config = buildWizardConfig(answers);
  const yamlContent = generateYamlContent(config);

  // Write config
  const configPath = join(rootDir, '.coderag.yaml');
  await writeFile(configPath, yamlContent, 'utf-8');
  // eslint-disable-next-line no-console
  console.log(chalk.green('Created'), configPath);

  // Create storage directory
  const storageDir = join(rootDir, '.coderag');
  await mkdir(storageDir, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(chalk.green('Created'), storageDir);

  // Done
  // eslint-disable-next-line no-console
  console.log(chalk.green('\nCodeRAG initialized successfully!'));
  // eslint-disable-next-line no-console
  console.log(chalk.dim('Run "coderag index" to index your codebase.'));
}

/**
 * Pull an Ollama model via the API.
 */
async function pullOllamaModel(modelName: string): Promise<void> {
  const host = process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';
  const response = await globalThis.fetch(`${host}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: false }),
    signal: AbortSignal.timeout(300_000), // 5 minutes for model pull
  });
  if (!response.ok) {
    throw new Error(`Ollama pull failed: HTTP ${response.status}`);
  }
  // Consume the response body
  await response.text();
}
