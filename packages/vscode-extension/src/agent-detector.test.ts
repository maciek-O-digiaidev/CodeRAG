/**
 * Tests for AgentDetector — AI coding agent detection module.
 *
 * Mocks `node:child_process.exec` and `node:os.homedir` to test
 * detection of CLI agents (Claude, Codex, Gemini, amp) and
 * VS Code extension-based agents (GitHub Copilot).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock/home'),
}));

import { exec } from 'node:child_process';
import type { ExecException } from 'node:child_process';
import {
  detectAllAgents,
  detectAgent,
  getSupportedAgentIds,
  getAgentName,
} from './agent-detector.js';
import type { ExtensionChecker, AgentId } from './agent-detector.js';

const mockedExec = vi.mocked(exec);

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;

/**
 * Helper: configure the exec mock so that specific commands resolve/reject.
 */
function mockExecResponses(responses: Record<string, string | null>): void {
  mockedExec.mockImplementation(((
    command: string,
    _options: unknown,
    callback: ExecCallback,
  ) => {
    const output = responses[command];
    if (output === null || output === undefined) {
      callback(new Error('Command not found') as ExecException, '', 'not found');
    } else {
      callback(null, output, '');
    }
  }) as typeof exec);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // detectAllAgents
  // -----------------------------------------------------------------------

  describe('detectAllAgents', () => {
    it('should detect all CLI agents when installed', async () => {
      mockExecResponses({
        'claude --version': 'Claude Code v1.5.2',
        'codex --version': 'Codex CLI v0.1.0',
        'gemini --version': 'Gemini CLI v2.0.1',
        'amp --version': 'amp v0.3.0',
      });

      const results = await detectAllAgents();

      const claude = results.find((r) => r.id === 'claude');
      expect(claude?.installed).toBe(true);
      expect(claude?.version).toBe('1.5.2');
      expect(claude?.mcpConfigPath).toBe(join('/mock/home', '.claude', 'settings.json'));

      const codex = results.find((r) => r.id === 'codex');
      expect(codex?.installed).toBe(true);
      expect(codex?.version).toBe('0.1.0');

      const gemini = results.find((r) => r.id === 'gemini');
      expect(gemini?.installed).toBe(true);
      expect(gemini?.version).toBe('2.0.1');

      const amp = results.find((r) => r.id === 'amp');
      expect(amp?.installed).toBe(true);
      expect(amp?.version).toBe('0.3.0');
    });

    it('should handle missing CLI agents gracefully', async () => {
      mockExecResponses({
        'claude --version': 'Claude Code v1.5.2',
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const results = await detectAllAgents();

      const claude = results.find((r) => r.id === 'claude');
      expect(claude?.installed).toBe(true);

      const codex = results.find((r) => r.id === 'codex');
      expect(codex?.installed).toBe(false);
      expect(codex?.version).toBeUndefined();
      expect(codex?.mcpConfigPath).toBeUndefined();

      const gemini = results.find((r) => r.id === 'gemini');
      expect(gemini?.installed).toBe(false);

      const amp = results.find((r) => r.id === 'amp');
      expect(amp?.installed).toBe(false);
    });

    it('should detect GitHub Copilot via extension checker', async () => {
      mockExecResponses({
        'claude --version': null,
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const extensionChecker: ExtensionChecker = {
        isExtensionInstalled: (id) => id === 'GitHub.copilot',
      };

      const results = await detectAllAgents(extensionChecker);

      const copilot = results.find((r) => r.id === 'copilot');
      expect(copilot?.installed).toBe(true);
      expect(copilot?.name).toBe('GitHub Copilot');
    });

    it('should mark Copilot as not installed when extension is missing', async () => {
      mockExecResponses({
        'claude --version': null,
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const extensionChecker: ExtensionChecker = {
        isExtensionInstalled: () => false,
      };

      const results = await detectAllAgents(extensionChecker);

      const copilot = results.find((r) => r.id === 'copilot');
      expect(copilot?.installed).toBe(false);
    });

    it('should mark Copilot as not installed when no extension checker provided', async () => {
      mockExecResponses({
        'claude --version': null,
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const results = await detectAllAgents();

      const copilot = results.find((r) => r.id === 'copilot');
      expect(copilot?.installed).toBe(false);
    });

    it('should return results for all 5 agents', async () => {
      mockExecResponses({
        'claude --version': null,
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const results = await detectAllAgents();

      expect(results).toHaveLength(5);
      const ids = results.map((r) => r.id);
      expect(ids).toContain('claude');
      expect(ids).toContain('codex');
      expect(ids).toContain('gemini');
      expect(ids).toContain('amp');
      expect(ids).toContain('copilot');
    });

    it('should include install URLs for all agents', async () => {
      mockExecResponses({
        'claude --version': null,
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const results = await detectAllAgents();

      for (const result of results) {
        expect(result.installUrl).toBeDefined();
        expect(result.installUrl.length).toBeGreaterThan(0);
      }
    });

    it('should parse version from bare version string', async () => {
      mockExecResponses({
        'claude --version': '2.0.1',
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const results = await detectAllAgents();
      const claude = results.find((r) => r.id === 'claude');
      expect(claude?.version).toBe('2.0.1');
    });

    it('should handle version with pre-release suffix', async () => {
      mockExecResponses({
        'claude --version': 'Claude Code v1.5.2-beta.1',
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const results = await detectAllAgents();
      const claude = results.find((r) => r.id === 'claude');
      expect(claude?.version).toBe('1.5.2-beta.1');
    });

    it('should return undefined version when no version pattern matches', async () => {
      mockExecResponses({
        'claude --version': 'some unexpected output',
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const results = await detectAllAgents();
      const claude = results.find((r) => r.id === 'claude');
      expect(claude?.installed).toBe(true);
      expect(claude?.version).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // detectAgent
  // -----------------------------------------------------------------------

  describe('detectAgent', () => {
    it('should detect a specific CLI agent', async () => {
      mockExecResponses({
        'claude --version': 'Claude Code v1.5.2',
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const result = await detectAgent('claude');

      expect(result).toBeDefined();
      expect(result?.installed).toBe(true);
      expect(result?.version).toBe('1.5.2');
      expect(result?.id).toBe('claude');
    });

    it('should return not installed for missing agent', async () => {
      mockExecResponses({
        'claude --version': null,
        'codex --version': null,
        'gemini --version': null,
        'amp --version': null,
      });

      const result = await detectAgent('codex');

      expect(result?.installed).toBe(false);
      expect(result?.version).toBeUndefined();
    });

    it('should detect Copilot with extension checker', async () => {
      const extensionChecker: ExtensionChecker = {
        isExtensionInstalled: (id) => id === 'GitHub.copilot',
      };

      const result = await detectAgent('copilot', extensionChecker);

      expect(result?.installed).toBe(true);
      expect(result?.id).toBe('copilot');
    });

    it('should return undefined for unknown agent ID', async () => {
      const result = await detectAgent('unknown-agent' as AgentId);
      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // getSupportedAgentIds
  // -----------------------------------------------------------------------

  describe('getSupportedAgentIds', () => {
    it('should return all 5 agent IDs', () => {
      const ids = getSupportedAgentIds();

      expect(ids).toHaveLength(5);
      expect(ids).toContain('claude');
      expect(ids).toContain('codex');
      expect(ids).toContain('gemini');
      expect(ids).toContain('amp');
      expect(ids).toContain('copilot');
    });
  });

  // -----------------------------------------------------------------------
  // getAgentName
  // -----------------------------------------------------------------------

  describe('getAgentName', () => {
    it('should return display name for known agents', () => {
      expect(getAgentName('claude')).toBe('Claude Code');
      expect(getAgentName('codex')).toBe('Codex CLI');
      expect(getAgentName('gemini')).toBe('Gemini CLI');
      expect(getAgentName('amp')).toBe('amp');
      expect(getAgentName('copilot')).toBe('GitHub Copilot');
    });

    it('should return the ID itself for unknown agents', () => {
      expect(getAgentName('unknown' as AgentId)).toBe('unknown');
    });
  });
});
