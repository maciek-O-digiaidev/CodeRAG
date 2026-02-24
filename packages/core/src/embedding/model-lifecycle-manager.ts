import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { ok, err, type Result } from 'neverthrow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackendType = 'ollama' | 'docker';
export type GpuMode = 'auto' | 'nvidia' | 'none';

export interface DockerConfig {
  image: string;
  gpu: GpuMode;
}

export interface ModelLifecycleConfig {
  model: string;
  autoStart: boolean;
  autoStop: boolean;
  docker: DockerConfig;
  healthCheckTimeoutMs: number;
  healthCheckIntervalMs: number;
  baseUrl: string;
}

export interface BackendInfo {
  type: BackendType;
  baseUrl: string;
  pid?: number;
  containerId?: string;
  managedByUs: boolean;
}

export type ProgressCallback = (status: string, completed: number, total: number) => void;

export class ModelLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelLifecycleError';
  }
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_LIFECYCLE_CONFIG: ModelLifecycleConfig = {
  model: 'nomic-embed-text',
  autoStart: true,
  autoStop: false,
  docker: {
    image: 'ollama/ollama',
    gpu: 'auto',
  },
  healthCheckTimeoutMs: 60_000,
  healthCheckIntervalMs: 1_000,
  baseUrl: 'http://localhost:11434',
};

// ---------------------------------------------------------------------------
// Installation instructions
// ---------------------------------------------------------------------------

const INSTALL_INSTRUCTIONS = `
CodeRAG requires an embedding backend but none was found.

Option 1: Install Ollama (recommended)
  macOS:   brew install ollama
  Linux:   curl -fsSL https://ollama.com/install.sh | sh
  Windows: Download from https://ollama.com/download

Option 2: Install Docker
  https://docs.docker.com/get-docker/

Option 3: Use an OpenAI-compatible API
  Set provider: openai-compatible in .coderag.yaml

After installing, run "coderag index" again.
`.trim();

// ---------------------------------------------------------------------------
// Helpers — process execution (injectable for testing)
// ---------------------------------------------------------------------------

export interface ProcessExecutor {
  execFile(
    command: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }>;
  spawn(
    command: string,
    args: string[],
    options: { detached: boolean; stdio: 'ignore' | 'pipe' },
  ): ChildProcess;
}

function createDefaultExecutor(): ProcessExecutor {
  return {
    execFile(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
      return new Promise((resolve, reject) => {
        execFile(command, args, { timeout: 10_000 }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });
    },
    spawn(
      command: string,
      args: string[],
      options: { detached: boolean; stdio: 'ignore' | 'pipe' },
    ): ChildProcess {
      return spawn(command, args, {
        detached: options.detached,
        stdio: options.stdio,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers — fetch (injectable for testing)
// ---------------------------------------------------------------------------

export type FetchFn = typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// ModelLifecycleManager
// ---------------------------------------------------------------------------

export class ModelLifecycleManager {
  private readonly config: ModelLifecycleConfig;
  private readonly executor: ProcessExecutor;
  private readonly fetchFn: FetchFn;
  private backendInfo: BackendInfo | null = null;

  constructor(
    config?: Partial<ModelLifecycleConfig>,
    executor?: ProcessExecutor,
    fetchFn?: FetchFn,
  ) {
    this.config = { ...DEFAULT_LIFECYCLE_CONFIG, ...config };
    if (config?.docker) {
      this.config.docker = { ...DEFAULT_LIFECYCLE_CONFIG.docker, ...config.docker };
    }
    this.executor = executor ?? createDefaultExecutor();
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /** Returns the active backend info, or null if not yet started. */
  get activeBackend(): BackendInfo | null {
    return this.backendInfo;
  }

  // -----------------------------------------------------------------------
  // Detection
  // -----------------------------------------------------------------------

  /**
   * Detect the first available backend, checking in priority order:
   * 1. Running Ollama service
   * 2. Ollama binary installed (not running)
   * 3. Docker available
   */
  async detectBackend(): Promise<BackendInfo | null> {
    // 1. Check if Ollama is already running
    const running = await this.isOllamaRunning();
    if (running) {
      return {
        type: 'ollama',
        baseUrl: this.config.baseUrl,
        managedByUs: false,
      };
    }

    // 2. Check if Ollama binary is installed
    const ollamaInstalled = await this.isOllamaInstalled();
    if (ollamaInstalled) {
      return {
        type: 'ollama',
        baseUrl: this.config.baseUrl,
        managedByUs: true, // will need to start it
      };
    }

    // 3. Check if Docker is available
    const dockerAvailable = await this.isDockerAvailable();
    if (dockerAvailable) {
      return {
        type: 'docker',
        baseUrl: this.config.baseUrl,
        managedByUs: true,
      };
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Ensure running
  // -----------------------------------------------------------------------

  /**
   * Ensure an embedding backend is running. Tries in order:
   * 1. If Ollama is already running, use it
   * 2. If Ollama is installed, start it
   * 3. If Docker is available, start Ollama container
   * 4. Return err with installation instructions
   */
  async ensureRunning(): Promise<Result<BackendInfo, ModelLifecycleError>> {
    if (!this.config.autoStart) {
      // Auto-start disabled — just check if Ollama is running
      const running = await this.isOllamaRunning();
      if (running) {
        this.backendInfo = {
          type: 'ollama',
          baseUrl: this.config.baseUrl,
          managedByUs: false,
        };
        return ok(this.backendInfo);
      }
      return err(new ModelLifecycleError(
        'Embedding backend is not running and auto_start is disabled. Start Ollama manually.',
      ));
    }

    // 1. Already running?
    const running = await this.isOllamaRunning();
    if (running) {
      this.backendInfo = {
        type: 'ollama',
        baseUrl: this.config.baseUrl,
        managedByUs: false,
      };
      return ok(this.backendInfo);
    }

    // 2. Ollama installed — start it
    const ollamaInstalled = await this.isOllamaInstalled();
    if (ollamaInstalled) {
      const startResult = await this.startOllama();
      if (startResult.isErr()) {
        return err(startResult.error);
      }
      this.backendInfo = startResult.value;
      return ok(startResult.value);
    }

    // 3. Docker available — start container
    const dockerAvailable = await this.isDockerAvailable();
    if (dockerAvailable) {
      const startResult = await this.startDockerContainer();
      if (startResult.isErr()) {
        return err(startResult.error);
      }
      this.backendInfo = startResult.value;
      return ok(startResult.value);
    }

    // 4. Nothing available
    return err(new ModelLifecycleError(INSTALL_INSTRUCTIONS));
  }

  // -----------------------------------------------------------------------
  // Model management
  // -----------------------------------------------------------------------

  /**
   * Ensure the embedding model is available locally.
   * Pulls it if not present, with progress reporting.
   */
  async ensureModel(model?: string, onProgress?: ProgressCallback): Promise<Result<void, ModelLifecycleError>> {
    const modelName = model ?? this.config.model;

    // Check if model exists via /api/show
    const exists = await this.isModelAvailable(modelName);
    if (exists) {
      return ok(undefined);
    }

    // Pull the model
    const pullResult = await this.pullModel(modelName, onProgress);
    return pullResult;
  }

  // -----------------------------------------------------------------------
  // Stop
  // -----------------------------------------------------------------------

  /**
   * Stop the backend if it was started by us.
   * Caller is responsible for checking autoStop config.
   */
  async stop(): Promise<Result<void, ModelLifecycleError>> {
    if (!this.backendInfo?.managedByUs) {
      return ok(undefined);
    }

    if (this.backendInfo.type === 'ollama' && this.backendInfo.pid) {
      try {
        process.kill(this.backendInfo.pid, 'SIGTERM');
      } catch {
        // Process may already be gone
      }
    }

    if (this.backendInfo.type === 'docker' && this.backendInfo.containerId) {
      try {
        await this.executor.execFile('docker', ['stop', this.backendInfo.containerId]);
      } catch {
        // Container may already be stopped
      }
    }

    this.backendInfo = null;
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // Private — Ollama detection & start
  // -----------------------------------------------------------------------

  private async isOllamaRunning(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async isOllamaInstalled(): Promise<boolean> {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      await this.executor.execFile(whichCmd, ['ollama']);
      return true;
    } catch {
      return false;
    }
  }

  private async startOllama(): Promise<Result<BackendInfo, ModelLifecycleError>> {
    const child = this.executor.spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
    });

    // Unref so the parent process can exit even if child is alive
    child.unref?.();

    if (!child.pid) {
      return err(new ModelLifecycleError('Failed to spawn Ollama process: no PID returned.'));
    }

    const pid = child.pid;

    // Wait for health check
    const healthResult = await this.waitForHealth();
    if (healthResult.isErr()) {
      return err(healthResult.error);
    }

    return ok({
      type: 'ollama' as const,
      baseUrl: this.config.baseUrl,
      pid,
      managedByUs: true,
    });
  }

  // -----------------------------------------------------------------------
  // Private — Docker detection & start
  // -----------------------------------------------------------------------

  private async isDockerAvailable(): Promise<boolean> {
    try {
      await this.executor.execFile('docker', ['info']);
      return true;
    } catch {
      return false;
    }
  }

  private async startDockerContainer(): Promise<Result<BackendInfo, ModelLifecycleError>> {
    // Parse port from baseUrl, defaulting to 11434
    const parsedPort = new URL(this.config.baseUrl).port || '11434';
    const args = ['run', '-d', '--rm', '-p', `${parsedPort}:11434`];

    // GPU support
    const gpu = this.config.docker.gpu;
    if (gpu === 'nvidia' || (gpu === 'auto' && await this.hasNvidiaGpu())) {
      args.push('--gpus', 'all');
    }

    args.push(this.config.docker.image);

    try {
      const { stdout } = await this.executor.execFile('docker', args);
      const containerId = stdout.trim().slice(0, 12);

      // Wait for health check
      const healthResult = await this.waitForHealth();
      if (healthResult.isErr()) {
        return err(healthResult.error);
      }

      return ok({
        type: 'docker' as const,
        baseUrl: this.config.baseUrl,
        containerId,
        managedByUs: true,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new ModelLifecycleError(`Failed to start Docker container: ${message}`));
    }
  }

  private async hasNvidiaGpu(): Promise<boolean> {
    try {
      await this.executor.execFile('nvidia-smi', []);
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Private — Health check
  // -----------------------------------------------------------------------

  private async waitForHealth(): Promise<Result<void, ModelLifecycleError>> {
    const startTime = Date.now();
    const { healthCheckTimeoutMs, healthCheckIntervalMs } = this.config;

    while (Date.now() - startTime < healthCheckTimeoutMs) {
      const isReady = await this.isOllamaRunning();
      if (isReady) {
        return ok(undefined);
      }
      await this.sleep(healthCheckIntervalMs);
    }

    return err(new ModelLifecycleError(
      `Backend health check timed out after ${healthCheckTimeoutMs / 1000}s. ` +
      `Ollama did not respond at ${this.config.baseUrl}.`,
    ));
  }

  // -----------------------------------------------------------------------
  // Private — Model availability & pull
  // -----------------------------------------------------------------------

  private async isModelAvailable(modelName: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.config.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async pullModel(modelName: string, onProgress?: ProgressCallback): Promise<Result<void, ModelLifecycleError>> {
    const response = await this.fetchFn(`${this.config.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal: AbortSignal.timeout(600_000), // 10 min timeout for large models
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      return err(new ModelLifecycleError(
        `Failed to pull model "${modelName}": ${response.status} ${text}`,
      ));
    }

    if (!response.body) {
      // Non-streaming response — model pulled successfully
      return ok(undefined);
    }

    // Parse streaming NDJSON response for progress
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const progress = JSON.parse(line) as {
              status?: string;
              completed?: number;
              total?: number;
              error?: string;
            };

            if (progress.error) {
              return err(new ModelLifecycleError(
                `Model pull error: ${progress.error}`,
              ));
            }

            if (onProgress) {
              onProgress(
                progress.status ?? 'pulling',
                progress.completed ?? 0,
                progress.total ?? 0,
              );
            }
          } catch (parseErr) {
            if (parseErr instanceof ModelLifecycleError) {
              return err(parseErr);
            }
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // Private — Utility
  // -----------------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
