import { describe, it, expect } from 'vitest';
import { generateRepo } from './repo-generator.js';
import { generateQueries } from './query-template-engine.js';
import type { RepoGeneratorOptions } from './repo-generator.js';

describe('generateQueries', () => {
  const repoOptions: RepoGeneratorOptions = {
    seed: 42,
    fileCount: 30,
    languages: ['typescript'],
    complexity: 'medium',
  };
  const manifest = generateRepo(repoOptions).manifest;

  describe('determinism', () => {
    it('should produce identical queries for the same seed and manifest', () => {
      const queries1 = generateQueries(manifest, { seed: 100 });
      const queries2 = generateQueries(manifest, { seed: 100 });

      expect(queries1.queries.length).toBe(queries2.queries.length);
      for (let i = 0; i < queries1.queries.length; i++) {
        expect(queries1.queries[i]!.id).toBe(queries2.queries[i]!.id);
        expect(queries1.queries[i]!.query).toBe(queries2.queries[i]!.query);
        expect(queries1.queries[i]!.expectedChunks).toEqual(
          queries2.queries[i]!.expectedChunks,
        );
      }
    });

    it('should produce different queries for different seeds', () => {
      const queries1 = generateQueries(manifest, { seed: 100 });
      const queries2 = generateQueries(manifest, { seed: 200 });

      // At least some queries should differ
      const texts1 = queries1.queries.map((q) => q.query);
      const texts2 = queries2.queries.map((q) => q.query);
      expect(texts1).not.toEqual(texts2);
    });
  });

  describe('query count', () => {
    it('should produce at least 50 queries by default', () => {
      const dataset = generateQueries(manifest, { seed: 42 });
      expect(dataset.queries.length).toBeGreaterThanOrEqual(50);
    });

    it('should respect custom minQueries', () => {
      const dataset = generateQueries(manifest, {
        seed: 42,
        minQueries: 30,
      });
      expect(dataset.queries.length).toBeGreaterThanOrEqual(30);
    });

    it('should produce queries even with minimum repo size', () => {
      const smallRepo = generateRepo({
        seed: 42,
        fileCount: 10,
        languages: ['typescript'],
        complexity: 'simple',
      });
      const dataset = generateQueries(smallRepo.manifest, {
        seed: 42,
        minQueries: 20,
      });
      expect(dataset.queries.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('schema compliance', () => {
    it('should produce valid BenchmarkDataset structure', () => {
      const dataset = generateQueries(manifest, { seed: 42 });

      expect(typeof dataset.name).toBe('string');
      expect(typeof dataset.description).toBe('string');
      expect(typeof dataset.targetRepo).toBe('string');
      expect(Array.isArray(dataset.queries)).toBe(true);
    });

    it('should produce queries with all required fields', () => {
      const dataset = generateQueries(manifest, { seed: 42 });

      for (const query of dataset.queries) {
        expect(typeof query.id).toBe('string');
        expect(typeof query.query).toBe('string');
        expect(query.query.length).toBeGreaterThan(0);
        expect(['easy', 'medium', 'hard']).toContain(query.difficulty);
        expect([
          'function_lookup',
          'concept_search',
          'cross_file',
          'error_investigation',
        ]).toContain(query.category);
        expect(Array.isArray(query.expectedChunks)).toBe(true);
        expect(query.expectedChunks.length).toBeGreaterThan(0);
        expect(Array.isArray(query.tags)).toBe(true);
      }
    });

    it('should produce valid ExpectedChunk structures', () => {
      const dataset = generateQueries(manifest, { seed: 42 });

      for (const query of dataset.queries) {
        for (const chunk of query.expectedChunks) {
          expect(typeof chunk.filePath).toBe('string');
          expect(chunk.filePath.length).toBeGreaterThan(0);
          expect(typeof chunk.chunkType).toBe('string');
          expect(typeof chunk.name).toBe('string');
          expect(['primary', 'secondary']).toContain(chunk.relevance);
        }
      }
    });

    it('should generate unique query IDs', () => {
      const dataset = generateQueries(manifest, { seed: 42 });
      const ids = dataset.queries.map((q) => q.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should use gen-XXX ID format', () => {
      const dataset = generateQueries(manifest, { seed: 42 });
      for (const query of dataset.queries) {
        expect(query.id).toMatch(/^gen-\d{3}$/);
      }
    });
  });

  describe('query categories', () => {
    // Generate once for category tests
    const queriesDataset = generateQueries(manifest, { seed: 42 });

    it('should produce function_lookup queries', () => {
      const lookup = queriesDataset.queries.filter(
        (q) => q.category === 'function_lookup',
      );
      expect(lookup.length).toBeGreaterThan(0);
    });

    it('should produce concept_search queries', () => {
      const concept = queriesDataset.queries.filter(
        (q) => q.category === 'concept_search',
      );
      expect(concept.length).toBeGreaterThan(0);
    });

    it('should produce cross_file queries', () => {
      const crossFile = queriesDataset.queries.filter(
        (q) => q.category === 'cross_file',
      );
      expect(crossFile.length).toBeGreaterThan(0);
    });

    it('should produce queries across multiple difficulty levels', () => {
      const difficulties = new Set(
        queriesDataset.queries.map((q) => q.difficulty),
      );
      expect(difficulties.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('ground truth accuracy', () => {
    it('should reference file paths that exist in the manifest', () => {
      const dataset = generateQueries(manifest, { seed: 42 });
      const manifestPaths = new Set(manifest.entities.map((e) => e.filePath));

      for (const query of dataset.queries) {
        for (const chunk of query.expectedChunks) {
          expect(manifestPaths.has(chunk.filePath)).toBe(true);
        }
      }
    });

    it('should reference entity names that exist in the manifest', () => {
      const dataset = generateQueries(manifest, { seed: 42 });
      // Build a set of all known names (including method base names)
      const manifestNames = new Set<string>();
      for (const entity of manifest.entities) {
        manifestNames.add(entity.name);
        // For methods, also add just the method name part
        if (entity.entityType === 'method') {
          const parts = entity.name.split('.');
          if (parts[1]) manifestNames.add(parts[1]);
        }
      }

      for (const query of dataset.queries) {
        for (const chunk of query.expectedChunks) {
          expect(manifestNames.has(chunk.name)).toBe(true);
        }
      }
    });

    it('should have at least one primary chunk per query', () => {
      const dataset = generateQueries(manifest, { seed: 42 });

      for (const query of dataset.queries) {
        const primary = query.expectedChunks.filter(
          (c) => c.relevance === 'primary',
        );
        expect(primary.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('dataset metadata', () => {
    it('should include seed in dataset name', () => {
      const dataset = generateQueries(manifest, { seed: 42 });
      expect(dataset.name).toContain('42');
    });

    it('should include config info in description', () => {
      const dataset = generateQueries(manifest, { seed: 42 });
      expect(dataset.description).toContain('seed=42');
      expect(dataset.description).toContain('files=30');
    });

    it('should use custom targetRepo when provided', () => {
      const dataset = generateQueries(manifest, {
        seed: 42,
        targetRepo: 'my-custom-repo',
      });
      expect(dataset.targetRepo).toBe('my-custom-repo');
    });

    it('should use default targetRepo when not provided', () => {
      const dataset = generateQueries(manifest, { seed: 42 });
      expect(dataset.targetRepo).toBe('synthetic-repo');
    });
  });

  describe('multi-language repos', () => {
    it('should generate queries for both TypeScript and Python entities', () => {
      const mixedRepo = generateRepo({
        seed: 42,
        fileCount: 30,
        languages: ['typescript', 'python'],
        complexity: 'medium',
      });
      const dataset = generateQueries(mixedRepo.manifest, { seed: 42 });

      const chunkPaths = dataset.queries.flatMap((q) =>
        q.expectedChunks.map((c) => c.filePath),
      );
      const hasTsChunks = chunkPaths.some((p) => p.endsWith('.ts'));
      const hasPyChunks = chunkPaths.some((p) => p.endsWith('.py'));

      expect(hasTsChunks).toBe(true);
      expect(hasPyChunks).toBe(true);
    });
  });

  describe('JSON serialization', () => {
    it('should be serializable to JSON and back without data loss', () => {
      const dataset = generateQueries(manifest, { seed: 42 });
      const json = JSON.stringify(dataset);
      const parsed = JSON.parse(json) as typeof dataset;

      expect(parsed.name).toBe(dataset.name);
      expect(parsed.queries.length).toBe(dataset.queries.length);
      for (let i = 0; i < dataset.queries.length; i++) {
        expect(parsed.queries[i]!.id).toBe(dataset.queries[i]!.id);
        expect(parsed.queries[i]!.query).toBe(dataset.queries[i]!.query);
        expect(parsed.queries[i]!.expectedChunks).toEqual(
          dataset.queries[i]!.expectedChunks,
        );
      }
    });
  });
});
