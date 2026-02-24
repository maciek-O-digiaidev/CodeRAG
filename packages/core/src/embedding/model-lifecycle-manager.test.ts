import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ModelLifecycleManager,
  ModelLifecycleError,
  type ProcessExecutor,
  type FetchFn,
  type ModelLifecycleConfig,
  type ProgressCallback,
} from './model-lifecycle-manager.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockExecutor(overrides?: Partial<ProcessExecutor>): ProcessExecutor {
  return {
    execFile: vi.fn<ProcessExecutor['execFile']>().mockRejectedValue(new Error('not mocked')),
    spawn: vi.fn<ProcessExecutor['spawn']>().mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<ProcessExecutor['spawn']>),
    ...overrides,
  };
}

function createMockFetch(overrides?: {
  tagsOk?: boolean;
  showOk?: boolean;
  pullOk?: boolean;
  pullBody?: ReadableStream<Uint8Array> | null;
  throwOnTags?: boolean;
}): FetchFn {
  const opts = {
    tagsOk: false,
    showOk: false,
    pullOk: true,
    pullBody: null,
    throwOnTags: false,
    ...overrides,
  };

  return vi.fn<FetchFn>().mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/tags')) {
      if (opts.throwOnTags) {
        throw new Error('ECONNREFUSED');
      }
      return {
        ok: opts.tagsOk,
        status: opts.tagsOk ? 200 : 503,
        text: async () => '',
      } as Response;
    }

    if (url.includes('/api/show')) {
      return {
        ok: opts.showOk,
        status: opts.showOk ? 200 : 404,
        text: async () => '',
      } as Response;
    }

    if (url.includes('/api/pull')) {
      return {
        ok: opts.pullOk,
        status: opts.pullOk ? 200 : 500,
        body: opts.pullBody,
        text: async () => 'pull error',
      } as unknown as Response;
    }

    return { ok: false, status: 404, text: async () => 'not found' } as Response;
  });
}

const SHORT_TIMEOUT_CONFIG: Partial<ModelLifecycleConfig> = {
  healthCheckTimeoutMs: 200,
  healthCheckIntervalMs: 50,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelLifecycleManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const manager = new ModelLifecycleManager();
      expect(manager.activeBackend).toBeNull();
    });

    it('should merge partial config with defaults', () => {
      const manager = new ModelLifecycleManager({ model: 'custom-model' });
      expect(manager.activeBackend).toBeNull();
    });

    it('should merge docker config deeply', () => {
      const manager = new ModelLifecycleManager({
        docker: { image: 'custom/ollama', gpu: 'nvidia' },
      });
      expect(manager.activeBackend).toBeNull();
    });
  });

  describe('detectBackend', () => {
    it('should return running Ollama when health check succeeds', async () => {
      const fetchFn = createMockFetch({ tagsOk: true });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const backend = await manager.detectBackend();

      expect(backend).not.toBeNull();
      expect(backend!.type).toBe('ollama');
      expect(backend!.managedByUs).toBe(false);
      expect(backend!.baseUrl).toBe('http://localhost:11434');
    });

    it('should return installed Ollama when binary exists but not running', async () => {
      const fetchFn = createMockFetch({ tagsOk: false });
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockImplementation(
          async (cmd: string) => {
            if (cmd === whichCmd) return { stdout: '/usr/local/bin/ollama', stderr: '' };
            throw new Error('not found');
          },
        ),
      });
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const backend = await manager.detectBackend();

      expect(backend).not.toBeNull();
      expect(backend!.type).toBe('ollama');
      expect(backend!.managedByUs).toBe(true);
    });

    it('should return Docker when Ollama is not available but Docker is', async () => {
      const fetchFn = createMockFetch({ tagsOk: false });
      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockImplementation(
          async (cmd: string) => {
            if (cmd === 'docker') return { stdout: '', stderr: '' };
            throw new Error('not found');
          },
        ),
      });
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const backend = await manager.detectBackend();

      expect(backend).not.toBeNull();
      expect(backend!.type).toBe('docker');
      expect(backend!.managedByUs).toBe(true);
    });

    it('should return null when nothing is available', async () => {
      const fetchFn = createMockFetch({ tagsOk: false });
      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockRejectedValue(new Error('not found')),
      });
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const backend = await manager.detectBackend();

      expect(backend).toBeNull();
    });

    it('should handle fetch throwing (not just non-ok)', async () => {
      const fetchFn = createMockFetch({ throwOnTags: true });
      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockRejectedValue(new Error('not found')),
      });
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const backend = await manager.detectBackend();

      expect(backend).toBeNull();
    });
  });

  describe('ensureRunning', () => {
    it('should return ok immediately if Ollama is already running', async () => {
      const fetchFn = createMockFetch({ tagsOk: true });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const result = await manager.ensureRunning();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.type).toBe('ollama');
        expect(result.value.managedByUs).toBe(false);
      }
      expect(manager.activeBackend).not.toBeNull();
    });

    it('should start Ollama when installed but not running', async () => {
      let callCount = 0;
      const fetchFn = vi.fn<FetchFn>().mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/tags')) {
          callCount++;
          // First call: not running. Subsequent calls: running (simulates startup).
          return {
            ok: callCount > 1,
            status: callCount > 1 ? 200 : 503,
            text: async () => '',
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockImplementation(
          async (cmd: string) => {
            if (cmd === whichCmd) return { stdout: '/usr/local/bin/ollama', stderr: '' };
            throw new Error('not found');
          },
        ),
      });

      const manager = new ModelLifecycleManager(
        SHORT_TIMEOUT_CONFIG,
        executor,
        fetchFn,
      );

      const result = await manager.ensureRunning();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.type).toBe('ollama');
        expect(result.value.managedByUs).toBe(true);
        expect(result.value.pid).toBe(12345);
      }
      expect(executor.spawn).toHaveBeenCalledWith('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
      });
    });

    it('should start Docker container when Ollama is not available', async () => {
      let callCount = 0;
      const fetchFn = vi.fn<FetchFn>().mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/tags')) {
          callCount++;
          // First two calls (detect + first health check): not running
          // Third call: running (Docker container started)
          return {
            ok: callCount > 2,
            status: callCount > 2 ? 200 : 503,
            text: async () => '',
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockImplementation(
          async (cmd: string, args: string[]) => {
            if (cmd === 'docker' && args[0] === 'info') return { stdout: '', stderr: '' };
            if (cmd === 'docker' && args[0] === 'run') return { stdout: 'abc123def456789\n', stderr: '' };
            throw new Error('not found');
          },
        ),
      });

      const manager = new ModelLifecycleManager(
        SHORT_TIMEOUT_CONFIG,
        executor,
        fetchFn,
      );

      const result = await manager.ensureRunning();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.type).toBe('docker');
        expect(result.value.managedByUs).toBe(true);
        expect(result.value.containerId).toBe('abc123def456');
      }
    });

    it('should return err with install instructions when nothing is available', async () => {
      const fetchFn = createMockFetch({ tagsOk: false });
      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockRejectedValue(new Error('not found')),
      });
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const result = await manager.ensureRunning();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ModelLifecycleError);
        expect(result.error.message).toContain('Install Ollama');
      }
    });

    it('should return err when autoStart is disabled and Ollama is not running', async () => {
      const fetchFn = createMockFetch({ tagsOk: false });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager(
        { autoStart: false },
        executor,
        fetchFn,
      );

      const result = await manager.ensureRunning();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('auto_start is disabled');
      }
    });

    it('should return ok when autoStart is disabled but Ollama is running', async () => {
      const fetchFn = createMockFetch({ tagsOk: true });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager(
        { autoStart: false },
        executor,
        fetchFn,
      );

      const result = await manager.ensureRunning();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.type).toBe('ollama');
        expect(result.value.managedByUs).toBe(false);
      }
    });

    it('should return err on health check timeout', async () => {
      // Ollama is installed but never starts (health check always fails)
      const fetchFn = createMockFetch({ tagsOk: false });
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockImplementation(
          async (cmd: string) => {
            if (cmd === whichCmd) return { stdout: '/usr/local/bin/ollama', stderr: '' };
            throw new Error('not found');
          },
        ),
      });

      const manager = new ModelLifecycleManager(
        { healthCheckTimeoutMs: 150, healthCheckIntervalMs: 50 },
        executor,
        fetchFn,
      );

      const result = await manager.ensureRunning();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('health check timed out');
      }
    });

    it('should include GPU flags for Docker with nvidia GPU detection', async () => {
      let callCount = 0;
      const fetchFn = vi.fn<FetchFn>().mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/tags')) {
          callCount++;
          return {
            ok: callCount > 2,
            status: callCount > 2 ? 200 : 503,
            text: async () => '',
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      const execFileMock = vi.fn<ProcessExecutor['execFile']>().mockImplementation(
        async (cmd: string, args: string[]) => {
          if (cmd === 'docker' && args[0] === 'info') return { stdout: '', stderr: '' };
          if (cmd === 'docker' && args[0] === 'run') return { stdout: 'container123\n', stderr: '' };
          if (cmd === 'nvidia-smi') return { stdout: 'GPU info', stderr: '' };
          throw new Error('not found');
        },
      );

      const executor = createMockExecutor({ execFile: execFileMock });

      const manager = new ModelLifecycleManager(
        { ...SHORT_TIMEOUT_CONFIG, docker: { image: 'ollama/ollama', gpu: 'auto' } },
        executor,
        fetchFn,
      );

      const result = await manager.ensureRunning();
      expect(result.isOk()).toBe(true);

      // Verify docker run was called with --gpus all
      const dockerRunCall = execFileMock.mock.calls.find(
        (c) => c[0] === 'docker' && c[1][0] === 'run',
      );
      expect(dockerRunCall).toBeDefined();
      expect(dockerRunCall![1]).toContain('--gpus');
      expect(dockerRunCall![1]).toContain('all');
    });

    it('should not include GPU flags when gpu is none', async () => {
      let callCount = 0;
      const fetchFn = vi.fn<FetchFn>().mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/tags')) {
          callCount++;
          return {
            ok: callCount > 2,
            status: callCount > 2 ? 200 : 503,
            text: async () => '',
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      const execFileMock = vi.fn<ProcessExecutor['execFile']>().mockImplementation(
        async (cmd: string, args: string[]) => {
          if (cmd === 'docker' && args[0] === 'info') return { stdout: '', stderr: '' };
          if (cmd === 'docker' && args[0] === 'run') return { stdout: 'container123\n', stderr: '' };
          throw new Error('not found');
        },
      );

      const executor = createMockExecutor({ execFile: execFileMock });

      const manager = new ModelLifecycleManager(
        { ...SHORT_TIMEOUT_CONFIG, docker: { image: 'ollama/ollama', gpu: 'none' } },
        executor,
        fetchFn,
      );

      const result = await manager.ensureRunning();
      expect(result.isOk()).toBe(true);

      const dockerRunCall = execFileMock.mock.calls.find(
        (c) => c[0] === 'docker' && c[1][0] === 'run',
      );
      expect(dockerRunCall).toBeDefined();
      expect(dockerRunCall![1]).not.toContain('--gpus');
    });
  });

  describe('ensureModel', () => {
    it('should return ok if model is already available', async () => {
      const fetchFn = createMockFetch({ showOk: true });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const result = await manager.ensureModel('nomic-embed-text');

      expect(result.isOk()).toBe(true);
      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/show'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should pull model when not available (no streaming body)', async () => {
      const fetchFn = createMockFetch({ showOk: false, pullOk: true, pullBody: null });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const result = await manager.ensureModel('nomic-embed-text');

      expect(result.isOk()).toBe(true);
      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/pull'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should pull model with streaming progress', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"status":"downloading","completed":50,"total":100}\n'));
          controller.enqueue(encoder.encode('{"status":"verifying","completed":100,"total":100}\n'));
          controller.close();
        },
      });

      const fetchFn = createMockFetch({ showOk: false, pullOk: true, pullBody: stream });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const progressUpdates: Array<{ status: string; completed: number; total: number }> = [];
      const onProgress: ProgressCallback = (status, completed, total) => {
        progressUpdates.push({ status, completed, total });
      };

      const result = await manager.ensureModel('nomic-embed-text', onProgress);

      expect(result.isOk()).toBe(true);
      expect(progressUpdates).toHaveLength(2);
      expect(progressUpdates[0]).toEqual({ status: 'downloading', completed: 50, total: 100 });
      expect(progressUpdates[1]).toEqual({ status: 'verifying', completed: 100, total: 100 });
    });

    it('should return err on pull failure (non-200)', async () => {
      const fetchFn = createMockFetch({ showOk: false, pullOk: false });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const result = await manager.ensureModel('nomic-embed-text');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to pull model');
      }
    });

    it('should return err on streaming error in progress', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"error":"model not found"}\n'));
          controller.close();
        },
      });

      const fetchFn = createMockFetch({ showOk: false, pullOk: true, pullBody: stream });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const result = await manager.ensureModel('nonexistent-model');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Model pull error');
      }
    });

    it('should use default model from config when none specified', async () => {
      const fetchFn = createMockFetch({ showOk: true });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager(
        { model: 'my-default-model' },
        executor,
        fetchFn,
      );

      const result = await manager.ensureModel();

      expect(result.isOk()).toBe(true);
      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining('/api/show'),
        expect.objectContaining({
          body: JSON.stringify({ name: 'my-default-model' }),
        }),
      );
    });

    it('should skip unparseable lines in streaming response', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('not-json\n'));
          controller.enqueue(encoder.encode('{"status":"done","completed":100,"total":100}\n'));
          controller.close();
        },
      });

      const fetchFn = createMockFetch({ showOk: false, pullOk: true, pullBody: stream });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const progressUpdates: Array<{ status: string; completed: number; total: number }> = [];
      const onProgress: ProgressCallback = (status, completed, total) => {
        progressUpdates.push({ status, completed, total });
      };

      const result = await manager.ensureModel('test-model', onProgress);

      expect(result.isOk()).toBe(true);
      // Only the valid JSON line should have produced a progress callback
      expect(progressUpdates).toHaveLength(1);
      expect(progressUpdates[0]!.status).toBe('done');
    });
  });

  describe('stop', () => {
    it('should return ok if no backend was started', async () => {
      const fetchFn = createMockFetch();
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const result = await manager.stop();

      expect(result.isOk()).toBe(true);
    });

    it('should return ok if backend was not managed by us', async () => {
      const fetchFn = createMockFetch({ tagsOk: true });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const ensureResult = await manager.ensureRunning(); // sets managedByUs: false
      expect(ensureResult.isOk()).toBe(true);

      const stopResult = await manager.stop();

      expect(stopResult.isOk()).toBe(true);
      expect(executor.execFile).not.toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['stop']),
      );
    });

    it('should kill Ollama process when managed by us', async () => {
      let callCount = 0;
      const fetchFn = vi.fn<FetchFn>().mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/tags')) {
          callCount++;
          return {
            ok: callCount > 1,
            status: callCount > 1 ? 200 : 503,
            text: async () => '',
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockImplementation(
          async (cmd: string) => {
            if (cmd === whichCmd) return { stdout: '/usr/local/bin/ollama', stderr: '' };
            throw new Error('not found');
          },
        ),
      });

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const manager = new ModelLifecycleManager(
        SHORT_TIMEOUT_CONFIG,
        executor,
        fetchFn,
      );

      const ensureResult = await manager.ensureRunning();
      expect(ensureResult.isOk()).toBe(true);

      const stopResult = await manager.stop();
      expect(stopResult.isOk()).toBe(true);

      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
      expect(manager.activeBackend).toBeNull();

      killSpy.mockRestore();
    });

    it('should stop Docker container when managed by us', async () => {
      let callCount = 0;
      const fetchFn = vi.fn<FetchFn>().mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/tags')) {
          callCount++;
          return {
            ok: callCount > 2,
            status: callCount > 2 ? 200 : 503,
            text: async () => '',
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      const execFileMock = vi.fn<ProcessExecutor['execFile']>().mockImplementation(
        async (cmd: string, args: string[]) => {
          if (cmd === 'docker' && args[0] === 'info') return { stdout: '', stderr: '' };
          if (cmd === 'docker' && args[0] === 'run') return { stdout: 'container123abc\n', stderr: '' };
          if (cmd === 'docker' && args[0] === 'stop') return { stdout: '', stderr: '' };
          throw new Error('not found');
        },
      );
      const executor = createMockExecutor({ execFile: execFileMock });

      const manager = new ModelLifecycleManager(
        SHORT_TIMEOUT_CONFIG,
        executor,
        fetchFn,
      );

      const ensureResult = await manager.ensureRunning();
      expect(ensureResult.isOk()).toBe(true);

      const stopResult = await manager.stop();
      expect(stopResult.isOk()).toBe(true);

      expect(execFileMock).toHaveBeenCalledWith('docker', ['stop', 'container123']);
      expect(manager.activeBackend).toBeNull();
    });

    it('should handle stop errors gracefully (process already gone)', async () => {
      let callCount = 0;
      const fetchFn = vi.fn<FetchFn>().mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/tags')) {
          callCount++;
          return {
            ok: callCount > 1,
            status: callCount > 1 ? 200 : 503,
            text: async () => '',
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const executor = createMockExecutor({
        execFile: vi.fn<ProcessExecutor['execFile']>().mockImplementation(
          async (cmd: string) => {
            if (cmd === whichCmd) return { stdout: '/usr/local/bin/ollama', stderr: '' };
            throw new Error('not found');
          },
        ),
      });

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });

      const manager = new ModelLifecycleManager(
        SHORT_TIMEOUT_CONFIG,
        executor,
        fetchFn,
      );

      const ensureResult = await manager.ensureRunning();
      expect(ensureResult.isOk()).toBe(true);

      // Should return ok even though process.kill throws
      const stopResult = await manager.stop();
      expect(stopResult.isOk()).toBe(true);

      killSpy.mockRestore();
    });
  });

  describe('detection priority order', () => {
    it('should prefer running Ollama over installed Ollama', async () => {
      const fetchFn = createMockFetch({ tagsOk: true });
      const execFileMock = vi.fn<ProcessExecutor['execFile']>().mockResolvedValue({
        stdout: '/usr/local/bin/ollama',
        stderr: '',
      });
      const executor = createMockExecutor({ execFile: execFileMock });
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const backend = await manager.detectBackend();

      expect(backend!.type).toBe('ollama');
      expect(backend!.managedByUs).toBe(false);
      // Should not even check which/docker
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it('should prefer installed Ollama over Docker', async () => {
      const fetchFn = createMockFetch({ tagsOk: false });
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const execFileMock = vi.fn<ProcessExecutor['execFile']>().mockImplementation(
        async (cmd: string) => {
          if (cmd === whichCmd) return { stdout: '/usr/local/bin/ollama', stderr: '' };
          if (cmd === 'docker') return { stdout: '', stderr: '' };
          throw new Error('not found');
        },
      );
      const executor = createMockExecutor({ execFile: execFileMock });
      const manager = new ModelLifecycleManager({}, executor, fetchFn);

      const backend = await manager.detectBackend();

      expect(backend!.type).toBe('ollama');
      expect(backend!.managedByUs).toBe(true);
      // Should not have checked docker
      expect(execFileMock).not.toHaveBeenCalledWith('docker', expect.anything());
    });
  });

  describe('ModelLifecycleError', () => {
    it('should have correct name', () => {
      const error = new ModelLifecycleError('test');
      expect(error.name).toBe('ModelLifecycleError');
      expect(error.message).toBe('test');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('custom baseUrl', () => {
    it('should use custom baseUrl for health checks', async () => {
      const fetchFn = createMockFetch({ tagsOk: true });
      const executor = createMockExecutor();
      const manager = new ModelLifecycleManager(
        { baseUrl: 'http://remote:9999' },
        executor,
        fetchFn,
      );

      const backend = await manager.detectBackend();

      expect(backend!.baseUrl).toBe('http://remote:9999');
      expect(fetchFn).toHaveBeenCalledWith(
        'http://remote:9999/api/tags',
        expect.anything(),
      );
    });
  });

  describe('docker image configuration', () => {
    it('should use custom Docker image', async () => {
      let callCount = 0;
      const fetchFn = vi.fn<FetchFn>().mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/tags')) {
          callCount++;
          return {
            ok: callCount > 2,
            status: callCount > 2 ? 200 : 503,
            text: async () => '',
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      const execFileMock = vi.fn<ProcessExecutor['execFile']>().mockImplementation(
        async (cmd: string, args: string[]) => {
          if (cmd === 'docker' && args[0] === 'info') return { stdout: '', stderr: '' };
          if (cmd === 'docker' && args[0] === 'run') return { stdout: 'container123\n', stderr: '' };
          throw new Error('not found');
        },
      );
      const executor = createMockExecutor({ execFile: execFileMock });

      const manager = new ModelLifecycleManager(
        { ...SHORT_TIMEOUT_CONFIG, docker: { image: 'my-custom/ollama:latest', gpu: 'none' } },
        executor,
        fetchFn,
      );

      const result = await manager.ensureRunning();
      expect(result.isOk()).toBe(true);

      const dockerRunCall = execFileMock.mock.calls.find(
        (c) => c[0] === 'docker' && c[1][0] === 'run',
      );
      expect(dockerRunCall).toBeDefined();
      expect(dockerRunCall![1]).toContain('my-custom/ollama:latest');
    });
  });
});
