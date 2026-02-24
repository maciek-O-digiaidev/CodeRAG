/**
 * AgentDetector — detects installed AI coding agents and their MCP config paths.
 *
 * Checks for:
 *   - Claude Code (`claude --version`)
 *   - Codex CLI (`codex --version`)
 *   - Gemini CLI (`gemini --version`)
 *   - amp (`amp --version`)
 *   - GitHub Copilot (VS Code extension check)
 */

import { exec } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Unique identifier for each supported AI agent. */
export type AgentId = 'claude' | 'codex' | 'gemini' | 'amp' | 'copilot';

/** Detection result for a single agent. */
export interface AgentDetectionResult {
  readonly id: AgentId;
  readonly name: string;
  readonly installed: boolean;
  readonly version?: string;
  /** URL to install the agent if not found. */
  readonly installUrl: string;
  /** Path where MCP config should be written (undefined if N/A). */
  readonly mcpConfigPath?: string;
}

/** Static metadata for each agent. */
interface AgentMeta {
  readonly id: AgentId;
  readonly name: string;
  readonly command: string;
  readonly installUrl: string;
  /** Function to derive the MCP config file path from home directory. */
  readonly configPath?: (home: string) => string;
}

const AGENT_REGISTRY: readonly AgentMeta[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude --version',
    installUrl: 'https://claude.ai/download',
    configPath: (home) => join(home, '.claude', 'settings.json'),
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex --version',
    installUrl: 'https://github.com/openai/codex',
    configPath: (home) => join(home, '.codex', 'config.json'),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini --version',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
    configPath: (home) => join(home, '.gemini', 'settings.json'),
  },
  {
    id: 'amp',
    name: 'amp',
    command: 'amp --version',
    installUrl: 'https://ampcode.com',
    configPath: (home) => join(home, '.amp', 'settings.json'),
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    command: '', // Detected via VS Code extension API
    installUrl: 'https://marketplace.visualstudio.com/items?itemName=GitHub.copilot',
  },
] as const;

/** Timeout for CLI version checks in milliseconds. */
const EXEC_TIMEOUT_MS = 5_000;

/** Version regex: extracts semver-like version from CLI output. */
const VERSION_REGEX = /(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/;

/**
 * Execute a shell command and return its stdout.
 * Returns null on any error (command not found, timeout, etc.).
 */
function execCommand(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(command, { encoding: 'utf-8', timeout: EXEC_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Parse a version string from CLI output.
 * Returns undefined if no version pattern is found.
 */
function parseVersion(output: string): string | undefined {
  const match = VERSION_REGEX.exec(output);
  return match?.[1];
}

/**
 * Detect a single CLI-based agent by running its version command.
 */
async function detectCliAgent(meta: AgentMeta): Promise<AgentDetectionResult> {
  const home = homedir();

  if (!meta.command) {
    // Non-CLI agent (e.g., Copilot) — return not installed by default
    return {
      id: meta.id,
      name: meta.name,
      installed: false,
      installUrl: meta.installUrl,
    };
  }

  const output = await execCommand(meta.command);
  if (output === null) {
    return {
      id: meta.id,
      name: meta.name,
      installed: false,
      installUrl: meta.installUrl,
    };
  }

  return {
    id: meta.id,
    name: meta.name,
    installed: true,
    version: parseVersion(output),
    installUrl: meta.installUrl,
    mcpConfigPath: meta.configPath?.(home),
  };
}

/**
 * Interface for checking VS Code extension presence.
 * Allows dependency injection for testing.
 */
export interface ExtensionChecker {
  isExtensionInstalled(extensionId: string): boolean;
}

/**
 * Detect all supported AI agents.
 *
 * @param extensionChecker - Optional checker for VS Code extensions (for Copilot detection).
 * @returns Array of detection results for all agents.
 */
export async function detectAllAgents(
  extensionChecker?: ExtensionChecker,
): Promise<readonly AgentDetectionResult[]> {
  const results: AgentDetectionResult[] = [];

  const cliDetections = AGENT_REGISTRY
    .filter((meta) => meta.id !== 'copilot')
    .map((meta) => detectCliAgent(meta));

  const cliResults = await Promise.all(cliDetections);
  results.push(...cliResults);

  // Detect GitHub Copilot via VS Code extension API
  const copilotMeta = AGENT_REGISTRY.find((m) => m.id === 'copilot');
  if (copilotMeta) {
    const copilotInstalled = extensionChecker?.isExtensionInstalled('GitHub.copilot') ?? false;
    results.push({
      id: copilotMeta.id,
      name: copilotMeta.name,
      installed: copilotInstalled,
      installUrl: copilotMeta.installUrl,
    });
  }

  return results;
}

/**
 * Detect a single agent by its ID.
 */
export async function detectAgent(
  agentId: AgentId,
  extensionChecker?: ExtensionChecker,
): Promise<AgentDetectionResult | undefined> {
  const meta = AGENT_REGISTRY.find((m) => m.id === agentId);
  if (!meta) {
    return undefined;
  }

  if (agentId === 'copilot') {
    const installed = extensionChecker?.isExtensionInstalled('GitHub.copilot') ?? false;
    return {
      id: meta.id,
      name: meta.name,
      installed,
      installUrl: meta.installUrl,
    };
  }

  return detectCliAgent(meta);
}

/**
 * Get the list of all supported agent IDs.
 */
export function getSupportedAgentIds(): readonly AgentId[] {
  return AGENT_REGISTRY.map((m) => m.id);
}

/**
 * Get agent display name from its ID.
 */
export function getAgentName(agentId: AgentId): string {
  const meta = AGENT_REGISTRY.find((m) => m.id === agentId);
  return meta?.name ?? agentId;
}
