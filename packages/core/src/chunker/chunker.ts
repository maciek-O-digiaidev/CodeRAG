/**
 * Re-exports the Chunker interface and ChunkError from the types module.
 *
 * The canonical definitions live in `types/provider.ts`; this file serves as a
 * convenient entry-point for consumers that only need the chunking contract.
 */
export type { Chunker } from '../types/provider.js';
export { ChunkError } from '../types/provider.js';
