import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Root of the monorepo (three levels up from packages/cli/src/).
 */
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

/** Helper to read a file from the repo root. */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(resolve(REPO_ROOT, relativePath), 'utf-8');
}

// ---------------------------------------------------------------------------
// Dockerfile validation
// ---------------------------------------------------------------------------

describe('Dockerfile', () => {
  let content: string;

  it('should exist at repository root', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toBeTruthy();
  });

  it('should use node:22-alpine as base image', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/FROM\s+node:22-alpine\s+AS\s+builder/);
  });

  it('should have a multi-stage build with builder and production stages', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/FROM\s+node:22-alpine\s+AS\s+builder/);
    expect(content).toMatch(/FROM\s+node:22-alpine\s+AS\s+production/);
  });

  it('should install pnpm via corepack in builder stage', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toContain('corepack enable');
    expect(content).toContain('corepack prepare pnpm');
  });

  it('should use frozen lockfile for reproducible installs', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toContain('--frozen-lockfile');
  });

  it('should install native build tools for LanceDB and tree-sitter', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/apk add.*python3/);
    expect(content).toMatch(/apk add.*make/);
    expect(content).toMatch(/apk add.*g\+\+/);
  });

  it('should install git in production stage for simple-git', async () => {
    content = await readRepoFile('Dockerfile');
    // After the production FROM, there should be a git install
    const productionStage = content.split(/FROM\s+node:22-alpine\s+AS\s+production/)[1];
    expect(productionStage).toBeDefined();
    expect(productionStage).toMatch(/apk add.*git/);
  });

  it('should copy all package sources in builder stage', async () => {
    content = await readRepoFile('Dockerfile');
    const requiredPackages = ['core', 'cli', 'mcp-server', 'api-server', 'viewer'];
    for (const pkg of requiredPackages) {
      expect(content).toContain(`packages/${pkg}/`);
    }
  });

  it('should expose API server, MCP server, and viewer ports', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/EXPOSE\s+.*3000/);
    expect(content).toMatch(/EXPOSE\s+.*3001/);
    expect(content).toMatch(/EXPOSE\s+.*5173/);
  });

  it('should have a HEALTHCHECK directive', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toContain('HEALTHCHECK');
    expect(content).toMatch(/\/health/);
  });

  it('should set NODE_ENV to production', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/ENV\s+NODE_ENV[= ]production/);
  });

  it('should set entrypoint to CLI', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/ENTRYPOINT\s+\["node",\s*"packages\/cli\/dist\/index\.js"\]/);
  });

  it('should default CMD to --help', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/CMD\s+\["--help"\]/);
  });

  it('should set OLLAMA_HOST for inter-container communication', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/OLLAMA_HOST.*ollama/);
  });

  it('should install production dependencies only in production stage', async () => {
    content = await readRepoFile('Dockerfile');
    const productionStage = content.split(/FROM\s+node:22-alpine\s+AS\s+production/)[1];
    expect(productionStage).toBeDefined();
    expect(productionStage).toContain('--prod');
  });

  it('should run as a non-root user', async () => {
    content = await readRepoFile('Dockerfile');
    const productionStage = content.split(/FROM\s+node:22-alpine\s+AS\s+production/)[1];
    expect(productionStage).toBeDefined();
    expect(productionStage).toMatch(/addgroup.*coderag/);
    expect(productionStage).toMatch(/adduser.*coderag/);
    expect(productionStage).toMatch(/USER\s+coderag/);
  });

  it('should set ownership of /app and /data to the non-root user', async () => {
    content = await readRepoFile('Dockerfile');
    const productionStage = content.split(/FROM\s+node:22-alpine\s+AS\s+production/)[1];
    expect(productionStage).toBeDefined();
    expect(productionStage).toMatch(/chown.*coderag:coderag\s+\/app\s+\/data/);
  });

  it('should pin pnpm version instead of using latest', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).not.toContain('pnpm@latest');
    expect(content).toMatch(/corepack prepare pnpm@\d+\.\d+\.\d+ --activate/);
  });

  it('should hardcode port 3000 in healthcheck', async () => {
    content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/HEALTHCHECK[\s\S]*localhost:3000\/health/);
    expect(content).not.toMatch(/\$\{CODERAG_PORT\}/);
  });
});

// ---------------------------------------------------------------------------
// docker-compose.yml validation
// ---------------------------------------------------------------------------

describe('docker-compose.yml', () => {
  let content: string;
  let parsed: Record<string, unknown>;

  it('should exist at repository root', async () => {
    content = await readRepoFile('docker-compose.yml');
    expect(content).toBeTruthy();
  });

  it('should be valid YAML', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    expect(parsed).toBeDefined();
    expect(parsed).toHaveProperty('services');
  });

  it('should define coderag service', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    expect(services).toHaveProperty('coderag');
  });

  it('should define ollama service', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    expect(services).toHaveProperty('ollama');
  });

  it('should define viewer service with optional profile', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    expect(services).toHaveProperty('viewer');
    const viewer = services['viewer'] as Record<string, unknown>;
    expect(viewer['profiles']).toContain('viewer');
  });

  it('should mount source code as read-only volume', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const coderag = services['coderag'] as Record<string, unknown>;
    const volumes = coderag['volumes'] as string[];
    const hasReadOnlyMount = volumes.some(
      (v: string) => typeof v === 'string' && v.includes(':ro'),
    );
    expect(hasReadOnlyMount).toBe(true);
  });

  it('should mount persistent data volume for .coderag', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const coderag = services['coderag'] as Record<string, unknown>;
    const volumes = coderag['volumes'] as string[];
    const hasDataVolume = volumes.some(
      (v: string) => typeof v === 'string' && v.includes('coderag-data'),
    );
    expect(hasDataVolume).toBe(true);
  });

  it('should configure coderag to depend on ollama', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const coderag = services['coderag'] as Record<string, unknown>;
    expect(coderag).toHaveProperty('depends_on');
    const dependsOn = coderag['depends_on'] as Record<string, unknown>;
    expect(dependsOn).toHaveProperty('ollama');
  });

  it('should set OLLAMA_HOST environment variable for coderag service', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const coderag = services['coderag'] as Record<string, unknown>;
    const env = coderag['environment'] as Record<string, string>;
    expect(env['OLLAMA_HOST']).toContain('ollama');
  });

  it('should expose API server port for coderag service', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const coderag = services['coderag'] as Record<string, unknown>;
    const ports = coderag['ports'] as string[];
    const has3000 = ports.some((p: string) => String(p).includes('3000'));
    expect(has3000).toBe(true);
  });

  it('should use shared network for inter-service communication', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty('networks');
    const services = parsed['services'] as Record<string, unknown>;
    const coderag = services['coderag'] as Record<string, unknown>;
    expect(coderag).toHaveProperty('networks');
  });

  it('should define persistent volumes', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const volumes = parsed['volumes'] as Record<string, unknown>;
    expect(volumes).toHaveProperty('coderag-data');
    expect(volumes).toHaveProperty('ollama-data');
  });

  it('should have a healthcheck for coderag service', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const coderag = services['coderag'] as Record<string, unknown>;
    expect(coderag).toHaveProperty('healthcheck');
    const healthcheck = coderag['healthcheck'] as Record<string, unknown>;
    const test = healthcheck['test'] as string[];
    const testStr = Array.isArray(test) ? test.join(' ') : String(test);
    expect(testStr).toContain('/health');
  });

  it('should have a healthcheck for ollama service', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const ollama = services['ollama'] as Record<string, unknown>;
    expect(ollama).toHaveProperty('healthcheck');
  });

  it('should specify ollama image tag', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const ollama = services['ollama'] as Record<string, unknown>;
    const image = ollama['image'] as string;
    expect(image).toMatch(/^ollama\/ollama:.+/);
  });

  it('should set restart policy on coderag service', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const coderag = services['coderag'] as Record<string, unknown>;
    expect(coderag['restart']).toBe('unless-stopped');
  });

  it('should set restart policy on ollama service', async () => {
    content = await readRepoFile('docker-compose.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const services = parsed['services'] as Record<string, unknown>;
    const ollama = services['ollama'] as Record<string, unknown>;
    expect(ollama['restart']).toBe('unless-stopped');
  });
});

// ---------------------------------------------------------------------------
// .dockerignore validation
// ---------------------------------------------------------------------------

describe('.dockerignore', () => {
  let content: string;

  it('should exist at repository root', async () => {
    content = await readRepoFile('.dockerignore');
    expect(content).toBeTruthy();
  });

  it('should exclude node_modules', async () => {
    content = await readRepoFile('.dockerignore');
    expect(content).toContain('node_modules');
  });

  it('should exclude .git directory', async () => {
    content = await readRepoFile('.dockerignore');
    expect(content).toContain('.git');
  });

  it('should exclude .claude directory', async () => {
    content = await readRepoFile('.dockerignore');
    expect(content).toContain('.claude');
  });

  it('should exclude test files', async () => {
    content = await readRepoFile('.dockerignore');
    expect(content).toMatch(/\*\.test\.ts/);
  });

  it('should exclude .coderag data directory', async () => {
    content = await readRepoFile('.dockerignore');
    expect(content).toContain('.coderag');
  });

  it('should exclude environment files', async () => {
    content = await readRepoFile('.dockerignore');
    expect(content).toContain('.env');
  });

  it('should exclude dist directories (rebuilt in container)', async () => {
    content = await readRepoFile('.dockerignore');
    expect(content).toMatch(/dist/);
  });
});

// ---------------------------------------------------------------------------
// GitHub Actions workflow validation
// ---------------------------------------------------------------------------

describe('docker-publish.yml workflow', () => {
  let content: string;
  let parsed: Record<string, unknown>;

  it('should exist at .github/workflows/docker-publish.yml', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    expect(content).toBeTruthy();
  });

  it('should be valid YAML', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    expect(parsed).toBeDefined();
  });

  it('should trigger on release tags matching v*', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const on = parsed['on'] as Record<string, unknown>;
    expect(on).toHaveProperty('push');
    const push = on['push'] as Record<string, unknown>;
    expect(push).toHaveProperty('tags');
    const tags = push['tags'] as string[];
    expect(tags).toContain('v*');
  });

  it('should target ghcr.io registry', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const env = parsed['env'] as Record<string, string>;
    expect(env['REGISTRY']).toBe('ghcr.io');
  });

  it('should define image name using github.repository', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const env = parsed['env'] as Record<string, string>;
    expect(env['IMAGE_NAME']).toBe('${{ github.repository }}');
  });

  it('should build multi-platform images (amd64 + arm64)', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    expect(content).toContain('linux/amd64');
    expect(content).toContain('linux/arm64');
  });

  it('should use docker/build-push-action', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    expect(content).toContain('docker/build-push-action');
  });

  it('should use docker/login-action for registry authentication', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    expect(content).toContain('docker/login-action');
  });

  it('should use docker/metadata-action for tag management', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    expect(content).toContain('docker/metadata-action');
  });

  it('should have packages write permission', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    parsed = parseYaml(content) as Record<string, unknown>;
    const permissions = parsed['permissions'] as Record<string, string>;
    expect(permissions['packages']).toBe('write');
  });

  it('should push images (push: true)', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    expect(content).toMatch(/push:\s*true/);
  });

  it('should use build cache for performance', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    expect(content).toContain('cache-from');
    expect(content).toContain('cache-to');
  });

  it('should use QEMU for multi-platform support', async () => {
    content = await readRepoFile('.github/workflows/docker-publish.yml');
    expect(content).toContain('setup-qemu-action');
  });
});
