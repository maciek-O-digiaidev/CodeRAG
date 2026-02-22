/**
 * Tests for ClaudeConfigManager — Claude Code MCP auto-configuration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock/home'),
}));

import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ClaudeConfigManager } from './claude-config.js';
import type { McpServerConfig } from './claude-config.js';

const mockedExecSync = vi.mocked(execSync);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeConfigManager', () => {
  let manager: ClaudeConfigManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ClaudeConfigManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // detectClaudeCode
  // -----------------------------------------------------------------------

  describe('detectClaudeCode', () => {
    it('should detect Claude Code when CLI is available', () => {
      mockedExecSync.mockReturnValue('Claude Code v1.5.2\n');

      const result = manager.detectClaudeCode();

      expect(result.installed).toBe(true);
      expect(result.version).toBe('1.5.2');
      expect(result.configPath).toBe(join('/mock/home', '.claude'));
    });

    it('should parse version from bare version string', () => {
      mockedExecSync.mockReturnValue('2.0.1');

      const result = manager.detectClaudeCode();

      expect(result.installed).toBe(true);
      expect(result.version).toBe('2.0.1');
    });

    it('should parse version with pre-release suffix', () => {
      mockedExecSync.mockReturnValue('Claude Code v1.5.2-beta.1');

      const result = manager.detectClaudeCode();

      expect(result.installed).toBe(true);
      expect(result.version).toBe('1.5.2-beta.1');
    });

    it('should return installed=true with undefined version when format is unexpected', () => {
      mockedExecSync.mockReturnValue('some unexpected output');

      const result = manager.detectClaudeCode();

      expect(result.installed).toBe(true);
      expect(result.version).toBeUndefined();
    });

    it('should return installed=false when CLI is not found', () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('Command not found: claude');
      });

      const result = manager.detectClaudeCode();

      expect(result.installed).toBe(false);
      expect(result.version).toBeUndefined();
      expect(result.configPath).toBeUndefined();
    });

    it('should call execSync with correct arguments', () => {
      mockedExecSync.mockReturnValue('1.0.0');

      manager.detectClaudeCode();

      expect(mockedExecSync).toHaveBeenCalledWith('claude --version', {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    });
  });

  // -----------------------------------------------------------------------
  // generateMcpConfig
  // -----------------------------------------------------------------------

  describe('generateMcpConfig', () => {
    it('should generate stdio config when no port specified', () => {
      const config = manager.generateMcpConfig();

      expect(config.command).toBe('npx');
      expect(config.args).toEqual(['coderag', 'serve']);
      expect(config.env).toBeUndefined();
    });

    it('should generate SSE config with port', () => {
      const config = manager.generateMcpConfig(3100);

      expect(config.command).toBe('npx');
      expect(config.args).toEqual(['coderag', 'serve', '--port', '3100']);
    });

    it('should generate SSE config with custom port', () => {
      const config = manager.generateMcpConfig(4200);

      expect(config.args).toEqual(['coderag', 'serve', '--port', '4200']);
    });
  });

  // -----------------------------------------------------------------------
  // readExistingConfig
  // -----------------------------------------------------------------------

  describe('readExistingConfig', () => {
    it('should return parsed config when file exists', async () => {
      const existingConfig = {
        mcpServers: {
          other: { command: 'node', args: ['server.js'] },
        },
        someOtherSetting: true,
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existingConfig));

      const result = await manager.readExistingConfig('/workspace');

      expect(result).toEqual(existingConfig);
      expect(mockedReadFile).toHaveBeenCalledWith(
        join('/workspace', '.claude', 'settings.json'),
        'utf-8',
      );
    });

    it('should return null when file does not exist', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await manager.readExistingConfig('/workspace');

      expect(result).toBeNull();
    });

    it('should return null when file contains invalid JSON', async () => {
      mockedReadFile.mockResolvedValue('not valid json {{{');

      const result = await manager.readExistingConfig('/workspace');

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // writeConfig
  // -----------------------------------------------------------------------

  describe('writeConfig', () => {
    it('should create new config when none exists', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      await manager.writeConfig('/workspace', 3100);

      expect(mockedMkdir).toHaveBeenCalledWith(
        join('/workspace', '.claude'),
        { recursive: true },
      );

      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent) as Record<string, unknown>;

      expect(parsed).toEqual({
        mcpServers: {
          coderag: {
            command: 'npx',
            args: ['coderag', 'serve', '--port', '3100'],
          },
        },
      });
    });

    it('should merge with existing config preserving other servers', async () => {
      const existing = {
        mcpServers: {
          other: { command: 'node', args: ['other-server.js'] },
        },
        customSetting: 'keep-me',
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      await manager.writeConfig('/workspace', 3100);

      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent) as Record<string, unknown>;

      expect(parsed).toEqual({
        mcpServers: {
          other: { command: 'node', args: ['other-server.js'] },
          coderag: {
            command: 'npx',
            args: ['coderag', 'serve', '--port', '3100'],
          },
        },
        customSetting: 'keep-me',
      });
    });

    it('should overwrite existing coderag config', async () => {
      const existing = {
        mcpServers: {
          coderag: { command: 'npx', args: ['coderag', 'serve', '--port', '9999'] },
        },
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      await manager.writeConfig('/workspace', 4200);

      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent) as Record<string, unknown>;

      expect((parsed as { mcpServers: Record<string, McpServerConfig> }).mcpServers.coderag.args).toEqual(
        ['coderag', 'serve', '--port', '4200'],
      );
    });

    it('should create stdio config when no port specified', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      await manager.writeConfig('/workspace');

      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent) as { mcpServers: Record<string, McpServerConfig> };

      expect(parsed.mcpServers.coderag.args).toEqual(['coderag', 'serve']);
    });

    it('should write formatted JSON with trailing newline', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      await manager.writeConfig('/workspace');

      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      expect(writtenContent).toMatch(/\n$/);
      // Should be pretty-printed (contains indentation)
      expect(writtenContent).toContain('  ');
    });

    it('should write to correct path', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      await manager.writeConfig('/my/workspace');

      expect(mockedWriteFile).toHaveBeenCalledWith(
        join('/my/workspace', '.claude', 'settings.json'),
        expect.any(String),
        'utf-8',
      );
    });
  });

  // -----------------------------------------------------------------------
  // updatePort
  // -----------------------------------------------------------------------

  describe('updatePort', () => {
    it('should update port in existing config', async () => {
      const existing = {
        mcpServers: {
          coderag: { command: 'npx', args: ['coderag', 'serve', '--port', '3100'] },
        },
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      await manager.updatePort('/workspace', 5000);

      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent) as { mcpServers: Record<string, McpServerConfig> };

      expect(parsed.mcpServers.coderag.args).toEqual(
        ['coderag', 'serve', '--port', '5000'],
      );
    });

    it('should create config when none exists', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue();

      await manager.updatePort('/workspace', 3100);

      expect(mockedWriteFile).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // isConfigured
  // -----------------------------------------------------------------------

  describe('isConfigured', () => {
    it('should return true when coderag is configured', async () => {
      const existing = {
        mcpServers: {
          coderag: { command: 'npx', args: ['coderag', 'serve'] },
        },
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));

      const result = await manager.isConfigured('/workspace');

      expect(result).toBe(true);
    });

    it('should return false when no config file exists', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await manager.isConfigured('/workspace');

      expect(result).toBe(false);
    });

    it('should return false when config has no coderag entry', async () => {
      const existing = {
        mcpServers: {
          other: { command: 'node', args: ['server.js'] },
        },
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));

      const result = await manager.isConfigured('/workspace');

      expect(result).toBe(false);
    });

    it('should return false when config has no mcpServers', async () => {
      const existing = { someOtherKey: true };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));

      const result = await manager.isConfigured('/workspace');

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getConfiguredPort
  // -----------------------------------------------------------------------

  describe('getConfiguredPort', () => {
    it('should return the port when configured with --port flag', async () => {
      const existing = {
        mcpServers: {
          coderag: { command: 'npx', args: ['coderag', 'serve', '--port', '3100'] },
        },
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));

      const port = await manager.getConfiguredPort('/workspace');

      expect(port).toBe(3100);
    });

    it('should return undefined when no port flag present (stdio)', async () => {
      const existing = {
        mcpServers: {
          coderag: { command: 'npx', args: ['coderag', 'serve'] },
        },
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));

      const port = await manager.getConfiguredPort('/workspace');

      expect(port).toBeUndefined();
    });

    it('should return undefined when no config exists', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));

      const port = await manager.getConfiguredPort('/workspace');

      expect(port).toBeUndefined();
    });

    it('should return undefined when coderag is not configured', async () => {
      const existing = {
        mcpServers: {
          other: { command: 'node', args: ['server.js'] },
        },
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));

      const port = await manager.getConfiguredPort('/workspace');

      expect(port).toBeUndefined();
    });

    it('should return undefined when --port value is not a valid number', async () => {
      const existing = {
        mcpServers: {
          coderag: { command: 'npx', args: ['coderag', 'serve', '--port', 'invalid'] },
        },
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));

      const port = await manager.getConfiguredPort('/workspace');

      expect(port).toBeUndefined();
    });

    it('should return undefined when --port is last arg with no value', async () => {
      const existing = {
        mcpServers: {
          coderag: { command: 'npx', args: ['coderag', 'serve', '--port'] },
        },
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(existing));

      const port = await manager.getConfiguredPort('/workspace');

      expect(port).toBeUndefined();
    });
  });
});
