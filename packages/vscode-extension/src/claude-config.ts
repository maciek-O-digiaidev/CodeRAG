/**
 * ClaudeConfigManager — auto-configures Claude Code MCP settings for CodeRAG.
 *
 * Detects Claude Code installation, generates the MCP server configuration,
 * and writes/updates `.claude/settings.json` in the workspace so that
 * Claude Code can use CodeRAG immediately.
 */

import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Result of Claude Code detection. */
export interface ClaudeCodeDetection {
  readonly installed: boolean;
  readonly version?: string;
  readonly configPath?: string;
}

/** MCP server configuration entry for Claude Code settings.json. */
export interface McpServerConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** Shape of the Claude Code settings.json mcpServers section. */
interface ClaudeSettingsJson {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

const CLAUDE_CONFIG_DIR = '.claude';
const CLAUDE_SETTINGS_FILE = 'settings.json';
const CODERAG_SERVER_KEY = 'coderag';

export class ClaudeConfigManager {
  /**
   * Detect whether Claude Code CLI is installed and determine its version
   * and config path.
   */
  detectClaudeCode(): ClaudeCodeDetection {
    try {
      const output = execSync('claude --version', {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

      // Parse version from output (e.g. "Claude Code v1.2.3" or just "1.2.3")
      const versionMatch = /(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/.exec(output);
      const version = versionMatch?.[1];

      const configPath = join(homedir(), CLAUDE_CONFIG_DIR);

      return {
        installed: true,
        version,
        configPath,
      };
    } catch {
      return { installed: false };
    }
  }

  /**
   * Generate the MCP server config object for CodeRAG.
   *
   * Uses stdio transport via `npx coderag serve` by default.
   * If a port is specified, uses SSE transport with `--port`.
   */
  generateMcpConfig(serverPort?: number): McpServerConfig {
    if (serverPort !== undefined) {
      return {
        command: 'npx',
        args: ['coderag', 'serve', '--port', String(serverPort)],
      };
    }

    return {
      command: 'npx',
      args: ['coderag', 'serve'],
    };
  }

  /**
   * Read existing `.claude/settings.json` from a workspace root.
   * Returns null if the file does not exist or is unreadable.
   */
  async readExistingConfig(workspaceRoot: string): Promise<ClaudeSettingsJson | null> {
    const settingsPath = join(workspaceRoot, CLAUDE_CONFIG_DIR, CLAUDE_SETTINGS_FILE);

    try {
      const content = await readFile(settingsPath, 'utf-8');
      return JSON.parse(content) as ClaudeSettingsJson;
    } catch {
      return null;
    }
  }

  /**
   * Write or update `.claude/settings.json` in the workspace, merging
   * the CodeRAG MCP server config with any existing settings.
   *
   * Non-CodeRAG settings are preserved.
   */
  async writeConfig(workspaceRoot: string, serverPort?: number): Promise<void> {
    const configDir = join(workspaceRoot, CLAUDE_CONFIG_DIR);
    const settingsPath = join(configDir, CLAUDE_SETTINGS_FILE);

    // Read existing config or start fresh
    const existing = await this.readExistingConfig(workspaceRoot);
    const settings: ClaudeSettingsJson = existing ?? {};

    // Merge MCP server config
    const mcpServers: Record<string, McpServerConfig> = {
      ...(settings.mcpServers ?? {}),
    };
    mcpServers[CODERAG_SERVER_KEY] = this.generateMcpConfig(serverPort);

    settings.mcpServers = mcpServers;

    // Ensure .claude directory exists
    await mkdir(configDir, { recursive: true });

    // Write settings file with pretty formatting
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  }

  /**
   * Update the port in an existing CodeRAG MCP server configuration.
   * If no config exists, creates one.
   */
  async updatePort(workspaceRoot: string, newPort: number): Promise<void> {
    await this.writeConfig(workspaceRoot, newPort);
  }

  /**
   * Check whether the CodeRAG MCP server is already configured in
   * the workspace settings.
   */
  async isConfigured(workspaceRoot: string): Promise<boolean> {
    const settings = await this.readExistingConfig(workspaceRoot);
    return settings?.mcpServers?.[CODERAG_SERVER_KEY] !== undefined;
  }

  /**
   * Get the currently configured port from settings, if any.
   * Returns undefined if no port-based config exists.
   */
  async getConfiguredPort(workspaceRoot: string): Promise<number | undefined> {
    const settings = await this.readExistingConfig(workspaceRoot);
    const config = settings?.mcpServers?.[CODERAG_SERVER_KEY];

    if (!config) {
      return undefined;
    }

    const portFlagIndex = config.args.indexOf('--port');
    if (portFlagIndex === -1 || portFlagIndex >= config.args.length - 1) {
      return undefined;
    }

    const portStr = config.args[portFlagIndex + 1];
    const port = portStr !== undefined ? Number(portStr) : Number.NaN;
    return Number.isFinite(port) ? port : undefined;
  }
}
