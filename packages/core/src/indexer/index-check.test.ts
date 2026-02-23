import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkIndexExists } from './index-check.js';

describe('checkIndexExists', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coderag-index-check-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return exists:false when storage path does not exist', async () => {
    const result = await checkIndexExists(join(tempDir, 'nonexistent'));
    expect(result.exists).toBe(false);
    expect(result.empty).toBe(false);
  });

  it('should return exists:false when storage directory is empty', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(storagePath, { recursive: true });

    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(false);
  });

  it('should return exists:false when only BM25 index exists (no LanceDB data)', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(storagePath, { recursive: true });
    await writeFile(join(storagePath, 'bm25-index.json'), '{"documentCount": 5}');

    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(false);
  });

  it('should return exists:false when only LanceDB data exists (no BM25 file)', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(join(storagePath, 'chunks.lance'), { recursive: true });

    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(false);
  });

  it('should return exists:true, empty:false when both LanceDB and BM25 exist with data', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(join(storagePath, 'chunks.lance'), { recursive: true });
    await writeFile(join(storagePath, 'bm25-index.json'), '{"documentCount": 42}');

    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(true);
    expect(result.empty).toBe(false);
  });

  it('should return exists:true, empty:true when index exists but has 0 documents', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(join(storagePath, 'chunks.lance'), { recursive: true });
    await writeFile(join(storagePath, 'bm25-index.json'), '{"documentCount": 0}');

    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(true);
    expect(result.empty).toBe(true);
  });

  it('should ignore graph.json when checking for LanceDB content', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(storagePath, { recursive: true });
    await writeFile(join(storagePath, 'graph.json'), '{}');
    await writeFile(join(storagePath, 'bm25-index.json'), '{"documentCount": 5}');

    // Only graph.json and bm25-index.json exist — no actual LanceDB data
    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(false);
  });

  it('should handle corrupted BM25 JSON gracefully', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(join(storagePath, 'chunks.lance'), { recursive: true });
    await writeFile(join(storagePath, 'bm25-index.json'), 'NOT VALID JSON');

    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(true);
    // Corrupted file treated as empty
    expect(result.empty).toBe(true);
  });

  it('should handle BM25 JSON without documentCount field', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(join(storagePath, 'chunks.lance'), { recursive: true });
    await writeFile(join(storagePath, 'bm25-index.json'), '{"someOtherField": true}');

    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(true);
    // Cannot determine count; conservatively assume not empty
    expect(result.empty).toBe(false);
  });

  it('should handle BM25 JSON that is an array', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(join(storagePath, 'chunks.lance'), { recursive: true });
    await writeFile(join(storagePath, 'bm25-index.json'), '[1,2,3]');

    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(true);
    // Array is not a recognized format; conservatively assume not empty
    expect(result.empty).toBe(false);
  });

  it('should work with multiple LanceDB data entries', async () => {
    const storagePath = join(tempDir, '.coderag');
    await mkdir(join(storagePath, 'chunks.lance'), { recursive: true });
    await mkdir(join(storagePath, '_versions'), { recursive: true });
    await writeFile(join(storagePath, 'bm25-index.json'), '{"documentCount": 100}');

    const result = await checkIndexExists(storagePath);
    expect(result.exists).toBe(true);
    expect(result.empty).toBe(false);
  });
});
