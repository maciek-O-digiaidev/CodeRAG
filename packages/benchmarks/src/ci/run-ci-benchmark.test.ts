import { describe, it, expect } from 'vitest';
import { generateRepo } from '../generator/repo-generator.js';
import type { ManifestEntity } from '../generator/repo-generator.js';
import {
  runCIBenchmark,
  buildManifestRetrievalFn,
  scoreEntity,
  tokenize,
  runQuickValidation,
  DEFAULT_CI_CONFIG,
} from './run-ci-benchmark.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DEFAULT_CI_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_CI_CONFIG.seed).toBe(42);
    expect(DEFAULT_CI_CONFIG.fileCount).toBe(20);
    expect(DEFAULT_CI_CONFIG.minQueries).toBe(30);
  });
});

describe('tokenize', () => {
  it('should split on whitespace', () => {
    expect(tokenize('hello world')).toEqual(['hello', 'world']);
  });

  it('should split camelCase', () => {
    expect(tokenize('createUser')).toEqual(['create', 'user']);
  });

  it('should split PascalCase', () => {
    expect(tokenize('AuthService')).toEqual(['auth', 'service']);
  });

  it('should split snake_case', () => {
    expect(tokenize('create_user')).toEqual(['create', 'user']);
  });

  it('should split kebab-case', () => {
    expect(tokenize('auth-service')).toEqual(['auth', 'service']);
  });

  it('should split path separators', () => {
    expect(tokenize('src/auth/service.ts')).toEqual(['src', 'auth', 'service', 'ts']);
  });

  it('should lowercase everything', () => {
    expect(tokenize('HelloWorld')).toEqual(['hello', 'world']);
  });

  it('should remove empty tokens', () => {
    expect(tokenize('  hello  world  ')).toEqual(['hello', 'world']);
  });
});

describe('scoreEntity', () => {
  const makeEntity = (overrides: Partial<ManifestEntity> = {}): ManifestEntity => ({
    id: 'file:src/auth/auth-service.ts::function::createUser',
    filePath: 'src/auth/auth-service.ts',
    entityType: 'function',
    name: 'createUser',
    module: 'auth',
    language: 'typescript',
    dependencies: [],
    description: 'Creates a new user account',
    ...overrides,
  });

  it('should score exact name match highly', () => {
    const entity = makeEntity({ name: 'createUser' });
    const score = scoreEntity(entity, 'find the createuser function', tokenize('find the createuser function'));
    expect(score).toBeGreaterThan(0);
  });

  it('should score module name match', () => {
    const entity = makeEntity({ module: 'auth' });
    const score = scoreEntity(entity, 'how does the auth module work', tokenize('how does the auth module work'));
    expect(score).toBeGreaterThan(0);
  });

  it('should return 0 for completely unrelated query', () => {
    const entity = makeEntity({
      name: 'createUser',
      module: 'auth',
      description: 'Creates a new user account',
      filePath: 'src/auth/auth-service.ts',
    });
    const score = scoreEntity(entity, 'xyz qqq zzz', tokenize('xyz qqq zzz'));
    expect(score).toBe(0);
  });

  it('should score token overlap with description', () => {
    const entity = makeEntity({ description: 'Validates the payment token' });
    const score = scoreEntity(entity, 'payment validation logic', tokenize('payment validation logic'));
    expect(score).toBeGreaterThan(0);
  });

  it('should score class.method names', () => {
    const entity = makeEntity({ name: 'AuthService.validateToken' });
    const score = scoreEntity(entity, 'find the validatetoken method', tokenize('find the validatetoken method'));
    expect(score).toBeGreaterThan(0);
  });
});

describe('buildManifestRetrievalFn', () => {
  it('should return file paths ranked by relevance', async () => {
    const repo = generateRepo({
      seed: 42,
      fileCount: 10,
      languages: ['typescript'],
      complexity: 'medium',
    });

    const retrievalFn = buildManifestRetrievalFn(repo.manifest);

    // Pick a known entity name from the manifest
    const functions = repo.manifest.entities.filter((e) => e.entityType === 'function');
    expect(functions.length).toBeGreaterThan(0);

    const targetFn = functions[0]!;
    const results = await retrievalFn(`Find the ${targetFn.name} function`);

    // The target file should appear in results
    expect(results.length).toBeGreaterThan(0);
    expect(results).toContain(targetFn.filePath);
  });

  it('should return at most 20 results', async () => {
    const repo = generateRepo({
      seed: 42,
      fileCount: 50,
      languages: ['typescript'],
      complexity: 'medium',
    });

    const retrievalFn = buildManifestRetrievalFn(repo.manifest);
    const results = await retrievalFn('find create validate service');

    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('should deduplicate file paths', async () => {
    const repo = generateRepo({
      seed: 42,
      fileCount: 10,
      languages: ['typescript'],
      complexity: 'medium',
    });

    const retrievalFn = buildManifestRetrievalFn(repo.manifest);
    const results = await retrievalFn('service module');

    // Check for duplicates
    const unique = new Set(results);
    expect(unique.size).toBe(results.length);
  });
});

describe('runCIBenchmark', () => {
  it('should complete successfully with default config', async () => {
    const result = await runCIBenchmark({
      seed: 42,
      fileCount: 10,
      commitSha: 'test123',
      branch: 'test-branch',
      minQueries: 10,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const benchResult = result.value;
      expect(benchResult.commitSha).toBe('test123');
      expect(benchResult.branch).toBe('test-branch');
      expect(benchResult.seed).toBe(42);
      expect(benchResult.queryCount).toBeGreaterThan(0);
      expect(benchResult.durationMs).toBeGreaterThan(0);

      // Metrics should be populated
      expect(benchResult.metrics.precisionAt5).toBeGreaterThanOrEqual(0);
      expect(benchResult.metrics.mrr).toBeGreaterThanOrEqual(0);
      expect(benchResult.metrics.ndcgAt10).toBeGreaterThanOrEqual(0);
    }
  });

  it('should produce deterministic results for same seed', async () => {
    const config = {
      seed: 123,
      fileCount: 10,
      commitSha: 'test',
      branch: 'test',
      minQueries: 10,
    };

    const result1 = await runCIBenchmark(config);
    const result2 = await runCIBenchmark(config);

    expect(result1.isOk()).toBe(true);
    expect(result2.isOk()).toBe(true);

    if (result1.isOk() && result2.isOk()) {
      expect(result1.value.metrics.precisionAt5).toBe(result2.value.metrics.precisionAt5);
      expect(result1.value.metrics.mrr).toBe(result2.value.metrics.mrr);
      expect(result1.value.metrics.ndcgAt10).toBe(result2.value.metrics.ndcgAt10);
      expect(result1.value.queryCount).toBe(result2.value.queryCount);
    }
  });

  it('should produce different results for different seeds', async () => {
    const result1 = await runCIBenchmark({
      seed: 1,
      fileCount: 10,
      commitSha: 'test',
      branch: 'test',
      minQueries: 10,
    });
    const result2 = await runCIBenchmark({
      seed: 999,
      fileCount: 10,
      commitSha: 'test',
      branch: 'test',
      minQueries: 10,
    });

    expect(result1.isOk()).toBe(true);
    expect(result2.isOk()).toBe(true);

    if (result1.isOk() && result2.isOk()) {
      // At least some metrics should differ
      const m1 = result1.value.metrics;
      const m2 = result2.value.metrics;
      const allSame =
        m1.precisionAt5 === m2.precisionAt5 &&
        m1.mrr === m2.mrr &&
        m1.ndcgAt10 === m2.ndcgAt10;
      expect(allSame).toBe(false);
    }
  });
});

describe('runQuickValidation', () => {
  it('should complete successfully as a smoke test', async () => {
    const result = await runQuickValidation();
    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      expect(result.value.commitSha).toBe('validation');
      expect(result.value.branch).toBe('test');
      expect(result.value.queryCount).toBeGreaterThan(0);
    }
  });
});
