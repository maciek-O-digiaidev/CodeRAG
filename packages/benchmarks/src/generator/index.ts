/**
 * Synthetic repository generator and query template engine.
 *
 * Creates deterministic test repos with known structure and produces
 * benchmark queries with ground-truth expected chunks.
 */

// Seeded PRNG
export { SeededRng } from './seed-rng.js';

// Repo generator
export { generateRepo } from './repo-generator.js';
export type {
  RepoGeneratorOptions,
  SupportedLanguage,
  Complexity,
  GeneratedFile,
  ManifestEntity,
  RepoManifest,
  GeneratedRepo,
} from './repo-generator.js';

// Query template engine
export { generateQueries } from './query-template-engine.js';
export type { QueryEngineOptions } from './query-template-engine.js';
