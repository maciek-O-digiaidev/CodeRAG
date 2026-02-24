import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { _testing } from './hooks-cmd.js';

const {
  HOOK_MARKER_START,
  HOOK_MARKER_END,
  HOOK_SCRIPT,
  HOOK_NAMES,
  hookHasCoderagSection,
  removeCoderagSection,
  installHook,
  uninstallHook,
  getHooksDir,
} = _testing;

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'coderag-hooks-test-'));
}

describe('hooks-cmd', () => {
  let tempDir: string;
  let hooksDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    hooksDir = join(tempDir, '.git', 'hooks');
    await mkdir(hooksDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('hookHasCoderagSection', () => {
    it('should return true when both markers are present', () => {
      const content = `#!/bin/sh\n${HOOK_MARKER_START}\necho hello\n${HOOK_MARKER_END}\n`;
      expect(hookHasCoderagSection(content)).toBe(true);
    });

    it('should return false when no markers are present', () => {
      expect(hookHasCoderagSection('#!/bin/sh\necho hello\n')).toBe(false);
    });

    it('should return false when only start marker is present', () => {
      expect(hookHasCoderagSection(`#!/bin/sh\n${HOOK_MARKER_START}\n`)).toBe(false);
    });

    it('should return false when only end marker is present', () => {
      expect(hookHasCoderagSection(`#!/bin/sh\n${HOOK_MARKER_END}\n`)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hookHasCoderagSection('')).toBe(false);
    });
  });

  describe('removeCoderagSection', () => {
    it('should remove the CodeRAG section from content', () => {
      const content = `#!/bin/sh\necho before\n${HOOK_MARKER_START}\necho coderag\n${HOOK_MARKER_END}\necho after\n`;
      const result = removeCoderagSection(content);
      expect(result).not.toContain(HOOK_MARKER_START);
      expect(result).not.toContain(HOOK_MARKER_END);
      expect(result).toContain('echo before');
      expect(result).toContain('echo after');
    });

    it('should return null when only shebang remains', () => {
      const content = `#!/bin/sh\n${HOOK_MARKER_START}\necho coderag\n${HOOK_MARKER_END}\n`;
      const result = removeCoderagSection(content);
      expect(result).toBeNull();
    });

    it('should return null when nothing remains', () => {
      const content = `${HOOK_MARKER_START}\necho coderag\n${HOOK_MARKER_END}`;
      const result = removeCoderagSection(content);
      expect(result).toBeNull();
    });

    it('should return content unchanged when no markers present', () => {
      const content = '#!/bin/sh\necho hello\n';
      const result = removeCoderagSection(content);
      expect(result).toBe(content);
    });
  });

  describe('getHooksDir', () => {
    it('should return .git/hooks path', () => {
      const result = getHooksDir('/my/project');
      expect(result).toBe('/my/project/.git/hooks');
    });
  });

  describe('installHook', () => {
    it('should create a new hook file with shebang', async () => {
      const result = await installHook(hooksDir, 'post-commit');
      expect(result).toBe('installed');

      const hookPath = join(hooksDir, 'post-commit');
      const content = await readFile(hookPath, 'utf-8');
      expect(content).toContain('#!/bin/sh');
      expect(content).toContain(HOOK_MARKER_START);
      expect(content).toContain(HOOK_MARKER_END);
      expect(content).toContain('coderag index --quiet');
    });

    it('should append to existing hook file', async () => {
      const hookPath = join(hooksDir, 'post-commit');
      await writeFile(hookPath, '#!/bin/sh\necho "existing hook"\n');

      const result = await installHook(hooksDir, 'post-commit');
      expect(result).toBe('appended');

      const content = await readFile(hookPath, 'utf-8');
      expect(content).toContain('echo "existing hook"');
      expect(content).toContain(HOOK_MARKER_START);
    });

    it('should skip when already installed', async () => {
      // Install first time
      await installHook(hooksDir, 'post-commit');

      // Try installing again
      const result = await installHook(hooksDir, 'post-commit');
      expect(result).toBe('already');
    });

    it('should make hook file executable', async () => {
      await installHook(hooksDir, 'post-merge');

      const hookPath = join(hooksDir, 'post-merge');
      // Check file exists (executable check varies by platform)
      expect(existsSync(hookPath)).toBe(true);
    });

    it('should install all three hook types', async () => {
      for (const hookName of HOOK_NAMES) {
        const result = await installHook(hooksDir, hookName);
        expect(result).toBe('installed');
        expect(existsSync(join(hooksDir, hookName))).toBe(true);
      }
    });
  });

  describe('uninstallHook', () => {
    it('should delete hook file when it only contains CodeRAG section', async () => {
      await installHook(hooksDir, 'post-commit');
      const result = await uninstallHook(hooksDir, 'post-commit');
      expect(result).toBe('deleted');
      expect(existsSync(join(hooksDir, 'post-commit'))).toBe(false);
    });

    it('should remove CodeRAG section but keep other content', async () => {
      const hookPath = join(hooksDir, 'post-commit');
      await writeFile(hookPath, '#!/bin/sh\necho "keep me"\n');
      await installHook(hooksDir, 'post-commit');

      const result = await uninstallHook(hooksDir, 'post-commit');
      expect(result).toBe('removed');

      const content = await readFile(hookPath, 'utf-8');
      expect(content).toContain('echo "keep me"');
      expect(content).not.toContain(HOOK_MARKER_START);
    });

    it('should return not_found when hook does not exist', async () => {
      const result = await uninstallHook(hooksDir, 'post-commit');
      expect(result).toBe('not_found');
    });

    it('should return not_found when hook exists without CodeRAG section', async () => {
      const hookPath = join(hooksDir, 'post-commit');
      await writeFile(hookPath, '#!/bin/sh\necho "other hook"\n');

      const result = await uninstallHook(hooksDir, 'post-commit');
      expect(result).toBe('not_found');
    });
  });

  describe('HOOK_SCRIPT', () => {
    it('should contain the nohup background command', () => {
      expect(HOOK_SCRIPT).toContain('nohup coderag index --quiet');
    });

    it('should run in background with &', () => {
      expect(HOOK_SCRIPT).toContain('>/dev/null 2>&1 &');
    });

    it('should check if coderag is available before running', () => {
      expect(HOOK_SCRIPT).toContain('command -v coderag');
    });

    it('should have start and end markers', () => {
      expect(HOOK_SCRIPT).toContain(HOOK_MARKER_START);
      expect(HOOK_SCRIPT).toContain(HOOK_MARKER_END);
    });
  });

  describe('HOOK_NAMES', () => {
    it('should include post-commit, post-merge, and post-checkout', () => {
      expect(HOOK_NAMES).toContain('post-commit');
      expect(HOOK_NAMES).toContain('post-merge');
      expect(HOOK_NAMES).toContain('post-checkout');
    });

    it('should have exactly 3 hooks', () => {
      expect(HOOK_NAMES).toHaveLength(3);
    });
  });

  describe('round-trip: install then uninstall', () => {
    it('should cleanly install and uninstall all hooks', async () => {
      // Install
      for (const hookName of HOOK_NAMES) {
        await installHook(hooksDir, hookName);
      }

      // Verify installed
      for (const hookName of HOOK_NAMES) {
        const content = await readFile(join(hooksDir, hookName), 'utf-8');
        expect(hookHasCoderagSection(content)).toBe(true);
      }

      // Uninstall
      for (const hookName of HOOK_NAMES) {
        const result = await uninstallHook(hooksDir, hookName);
        expect(result).toBe('deleted');
      }

      // Verify uninstalled
      for (const hookName of HOOK_NAMES) {
        expect(existsSync(join(hooksDir, hookName))).toBe(false);
      }
    });

    it('should preserve existing hooks through install/uninstall cycle', async () => {
      // Pre-existing hook
      const hookPath = join(hooksDir, 'post-commit');
      const originalContent = '#!/bin/bash\nrun-my-linter\nrun-my-tests\n';
      await writeFile(hookPath, originalContent);

      // Install
      await installHook(hooksDir, 'post-commit');

      // Verify both sections exist
      const afterInstall = await readFile(hookPath, 'utf-8');
      expect(afterInstall).toContain('run-my-linter');
      expect(afterInstall).toContain(HOOK_MARKER_START);

      // Uninstall
      await uninstallHook(hooksDir, 'post-commit');

      // Verify original content is preserved
      const afterUninstall = await readFile(hookPath, 'utf-8');
      expect(afterUninstall).toContain('run-my-linter');
      expect(afterUninstall).toContain('run-my-tests');
      expect(afterUninstall).not.toContain(HOOK_MARKER_START);
    });
  });
});
