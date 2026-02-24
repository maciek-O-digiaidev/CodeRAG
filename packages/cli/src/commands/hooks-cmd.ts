import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, writeFile, chmod, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Marker comment used to identify CodeRAG hook sections.
 * Used for both install and uninstall operations.
 */
const HOOK_MARKER_START = '# --- CodeRAG auto-index (start) ---';
const HOOK_MARKER_END = '# --- CodeRAG auto-index (end) ---';

/**
 * The hook script fragment that triggers background incremental indexing.
 * Spawns `coderag index --quiet` in the background so git operations
 * are not blocked (<100ms hook execution time).
 */
const HOOK_SCRIPT = `${HOOK_MARKER_START}
# Trigger background incremental re-indexing (non-blocking).
if command -v coderag >/dev/null 2>&1; then
  nohup coderag index --quiet >/dev/null 2>&1 &
fi
${HOOK_MARKER_END}`;

/** Hook types that CodeRAG installs. */
const HOOK_NAMES = ['post-commit', 'post-merge', 'post-checkout'] as const;
type HookName = typeof HOOK_NAMES[number];

/**
 * Determine the .git/hooks directory path for the current project.
 */
function getHooksDir(rootDir: string): string {
  return join(rootDir, '.git', 'hooks');
}

/**
 * Check whether a hook file already contains the CodeRAG marker.
 */
function hookHasCoderagSection(content: string): boolean {
  return content.includes(HOOK_MARKER_START) && content.includes(HOOK_MARKER_END);
}

/**
 * Remove the CodeRAG section from a hook file's content.
 * Returns the cleaned content, or null if the file becomes empty/shebang-only.
 */
function removeCoderagSection(content: string): string | null {
  const startIdx = content.indexOf(HOOK_MARKER_START);
  const endIdx = content.indexOf(HOOK_MARKER_END);

  if (startIdx === -1 || endIdx === -1) {
    return content;
  }

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + HOOK_MARKER_END.length);
  const cleaned = (before + after).trim();

  // If only a shebang remains (or nothing), the file is effectively empty
  if (cleaned === '' || cleaned === '#!/bin/sh' || cleaned === '#!/bin/bash') {
    return null;
  }

  return cleaned + '\n';
}

/**
 * Install the CodeRAG hook fragment into a single hook file.
 * If the hook file already exists, append the fragment (don't overwrite).
 * If it already contains the CodeRAG section, skip it.
 */
async function installHook(hooksDir: string, hookName: HookName): Promise<'installed' | 'already' | 'appended'> {
  const hookPath = join(hooksDir, hookName);

  let existingContent = '';
  try {
    existingContent = await readFile(hookPath, 'utf-8');
  } catch {
    // File doesn't exist — we'll create it
  }

  if (existingContent && hookHasCoderagSection(existingContent)) {
    return 'already';
  }

  let newContent: string;
  if (existingContent) {
    // Append to existing hook
    const trimmed = existingContent.trimEnd();
    newContent = `${trimmed}\n\n${HOOK_SCRIPT}\n`;
  } else {
    // Create new hook file with shebang
    newContent = `#!/bin/sh\n\n${HOOK_SCRIPT}\n`;
  }

  await writeFile(hookPath, newContent, 'utf-8');
  await chmod(hookPath, 0o755);

  return existingContent ? 'appended' : 'installed';
}

/**
 * Uninstall the CodeRAG hook fragment from a single hook file.
 * If the hook file only contains the CodeRAG section, delete the file.
 * If it contains other content, remove only the CodeRAG section.
 */
async function uninstallHook(hooksDir: string, hookName: HookName): Promise<'removed' | 'deleted' | 'not_found'> {
  const hookPath = join(hooksDir, hookName);

  let existingContent: string;
  try {
    existingContent = await readFile(hookPath, 'utf-8');
  } catch {
    return 'not_found';
  }

  if (!hookHasCoderagSection(existingContent)) {
    return 'not_found';
  }

  const cleaned = removeCoderagSection(existingContent);

  if (cleaned === null) {
    // File is now empty — delete it
    await unlink(hookPath);
    return 'deleted';
  }

  await writeFile(hookPath, cleaned, 'utf-8');
  return 'removed';
}

/**
 * Register the `coderag hooks` CLI command group.
 *
 * Subcommands:
 *   - `coderag hooks install`   — install post-commit/post-merge/post-checkout hooks
 *   - `coderag hooks uninstall` — remove CodeRAG hooks
 *   - `coderag hooks status`    — check which hooks are installed
 */
export function registerHooksCommand(program: Command): void {
  const hooks = program
    .command('hooks')
    .description('Manage git hooks for automatic re-indexing');

  hooks
    .command('install')
    .description('Install git hooks for automatic re-indexing on commit, merge, and checkout')
    .action(async () => {
      const rootDir = process.cwd();
      const hooksDir = getHooksDir(rootDir);

      // Verify .git directory exists
      if (!existsSync(join(rootDir, '.git'))) {
        // eslint-disable-next-line no-console
        console.error(chalk.red('Not a git repository. Run this command from a git repo root.'));
        process.exit(1);
      }

      // Ensure hooks directory exists
      if (!existsSync(hooksDir)) {
        await mkdir(hooksDir, { recursive: true });
      }

      // eslint-disable-next-line no-console
      console.log(chalk.bold('Installing CodeRAG git hooks...'));
      // eslint-disable-next-line no-console
      console.log('');

      for (const hookName of HOOK_NAMES) {
        const result = await installHook(hooksDir, hookName);
        switch (result) {
          case 'installed':
            // eslint-disable-next-line no-console
            console.log(`  ${chalk.green('+')} ${hookName} — ${chalk.green('installed')}`);
            break;
          case 'appended':
            // eslint-disable-next-line no-console
            console.log(`  ${chalk.green('+')} ${hookName} — ${chalk.cyan('appended to existing hook')}`);
            break;
          case 'already':
            // eslint-disable-next-line no-console
            console.log(`  ${chalk.gray('=')} ${hookName} — ${chalk.gray('already installed')}`);
            break;
        }
      }

      // eslint-disable-next-line no-console
      console.log('');
      // eslint-disable-next-line no-console
      console.log(chalk.green('Git hooks installed. Incremental indexing will run automatically on:'));
      // eslint-disable-next-line no-console
      console.log('  - post-commit  (after each commit)');
      // eslint-disable-next-line no-console
      console.log('  - post-merge   (after merge/pull)');
      // eslint-disable-next-line no-console
      console.log('  - post-checkout (after branch switch)');
    });

  hooks
    .command('uninstall')
    .description('Remove CodeRAG git hooks')
    .action(async () => {
      const rootDir = process.cwd();
      const hooksDir = getHooksDir(rootDir);

      if (!existsSync(join(rootDir, '.git'))) {
        // eslint-disable-next-line no-console
        console.error(chalk.red('Not a git repository. Run this command from a git repo root.'));
        process.exit(1);
      }

      // eslint-disable-next-line no-console
      console.log(chalk.bold('Uninstalling CodeRAG git hooks...'));
      // eslint-disable-next-line no-console
      console.log('');

      for (const hookName of HOOK_NAMES) {
        const result = await uninstallHook(hooksDir, hookName);
        switch (result) {
          case 'removed':
            // eslint-disable-next-line no-console
            console.log(`  ${chalk.red('-')} ${hookName} — ${chalk.yellow('CodeRAG section removed')}`);
            break;
          case 'deleted':
            // eslint-disable-next-line no-console
            console.log(`  ${chalk.red('-')} ${hookName} — ${chalk.red('hook file deleted (was CodeRAG-only)')}`);
            break;
          case 'not_found':
            // eslint-disable-next-line no-console
            console.log(`  ${chalk.gray('=')} ${hookName} — ${chalk.gray('not installed')}`);
            break;
        }
      }

      // eslint-disable-next-line no-console
      console.log('');
      // eslint-disable-next-line no-console
      console.log(chalk.green('CodeRAG git hooks removed.'));
    });

  hooks
    .command('status')
    .description('Check which CodeRAG git hooks are installed')
    .action(async () => {
      const rootDir = process.cwd();
      const hooksDir = getHooksDir(rootDir);

      if (!existsSync(join(rootDir, '.git'))) {
        // eslint-disable-next-line no-console
        console.error(chalk.red('Not a git repository. Run this command from a git repo root.'));
        process.exit(1);
      }

      // eslint-disable-next-line no-console
      console.log(chalk.bold('CodeRAG Git Hooks Status'));
      // eslint-disable-next-line no-console
      console.log('');

      let installed = 0;
      for (const hookName of HOOK_NAMES) {
        const hookPath = join(hooksDir, hookName);
        let status = 'not installed';
        try {
          const content = await readFile(hookPath, 'utf-8');
          if (hookHasCoderagSection(content)) {
            status = 'installed';
            installed++;
          } else {
            status = 'hook exists (no CodeRAG section)';
          }
        } catch {
          // File doesn't exist
        }

        const icon = status === 'installed' ? chalk.green('*') : chalk.gray('-');
        const label = status === 'installed'
          ? chalk.green(status)
          : status === 'not installed'
            ? chalk.gray(status)
            : chalk.yellow(status);

        // eslint-disable-next-line no-console
        console.log(`  ${icon} ${hookName}: ${label}`);
      }

      // eslint-disable-next-line no-console
      console.log('');
      if (installed === HOOK_NAMES.length) {
        // eslint-disable-next-line no-console
        console.log(chalk.green('All hooks installed.'));
      } else if (installed > 0) {
        // eslint-disable-next-line no-console
        console.log(chalk.yellow(`${installed}/${HOOK_NAMES.length} hooks installed.`));
      } else {
        // eslint-disable-next-line no-console
        console.log(chalk.gray('No CodeRAG hooks installed. Run "coderag hooks install" to install.'));
      }
    });
}

/**
 * Exported for testing.
 */
export const _testing = {
  HOOK_MARKER_START,
  HOOK_MARKER_END,
  HOOK_SCRIPT,
  HOOK_NAMES,
  hookHasCoderagSection,
  removeCoderagSection,
  installHook,
  uninstallHook,
  getHooksDir,
};
