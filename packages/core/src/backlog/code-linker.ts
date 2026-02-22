import { ok, err, type Result } from 'neverthrow';
import { BacklogError } from './backlog-provider.js';
import type { BacklogProvider } from './backlog-provider.js';
import type { BacklogItem } from './types.js';
import type { Chunk } from '../types/chunk.js';
import { scanForABReferences } from './ab-reference-scanner.js';

/**
 * Bidirectional mapping between backlog items and code chunks.
 *
 * - `itemToChunks`: Maps a backlog item ID to the set of chunk IDs that reference it.
 * - `chunkToItems`: Maps a chunk ID to the set of backlog item IDs it references.
 */
export interface BacklogCodeMap {
  itemToChunks: Map<string, Set<string>>;
  chunkToItems: Map<string, Set<string>>;
}

/**
 * Coverage report showing which backlog items have linked code and which do not.
 */
export interface CoverageReport {
  /** Backlog items that have at least one linked code chunk. */
  linkedItems: BacklogItem[];
  /** Backlog items that have no linked code chunks. */
  unlinkedItems: BacklogItem[];
  /** Total number of backlog items evaluated. */
  totalItems: number;
  /** Number of items with at least one linked chunk. */
  linkedCount: number;
  /** Number of items with no linked chunks. */
  unlinkedCount: number;
  /** Coverage percentage (0-100). */
  coveragePercent: number;
}

/**
 * Links code chunks to backlog items by scanning chunk content for AB# references
 * and creating bidirectional mappings.
 *
 * Uses `scanForABReferences` to detect `AB#<number>` patterns in chunk content
 * and resolves them against a BacklogProvider to build a BacklogCodeMap.
 */
export class CodeLinker {
  /**
   * Scans an array of chunks for AB# references and builds a bidirectional
   * mapping between backlog item IDs and chunk IDs.
   *
   * For each chunk, the content is scanned for AB# patterns. Each detected
   * reference is resolved against the provider to confirm the item exists.
   * Only valid (existing) backlog items are included in the map.
   *
   * @param chunks - Code chunks to scan for backlog references
   * @param provider - BacklogProvider used to validate item existence
   * @returns A Result containing the BacklogCodeMap or a BacklogError
   */
  async linkChunksToBacklog(
    chunks: Chunk[],
    provider: BacklogProvider,
  ): Promise<Result<BacklogCodeMap, BacklogError>> {
    const itemToChunks = new Map<string, Set<string>>();
    const chunkToItems = new Map<string, Set<string>>();

    try {
      for (const chunk of chunks) {
        const refIds = scanForABReferences(chunk.content);

        for (const refId of refIds) {
          // Validate that the backlog item actually exists
          const itemResult = await provider.getItem(refId);

          if (itemResult.isErr()) {
            // Item doesn't exist in backlog — skip this reference
            continue;
          }

          const itemId = itemResult.value.id;

          // Add to itemToChunks
          if (!itemToChunks.has(itemId)) {
            itemToChunks.set(itemId, new Set());
          }
          itemToChunks.get(itemId)!.add(chunk.id);

          // Add to chunkToItems
          if (!chunkToItems.has(chunk.id)) {
            chunkToItems.set(chunk.id, new Set());
          }
          chunkToItems.get(chunk.id)!.add(itemId);
        }
      }

      return ok({ itemToChunks, chunkToItems });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new BacklogError(`Failed to link chunks to backlog: ${message}`),
      );
    }
  }

  /**
   * Generates a coverage report showing which backlog items have linked code
   * chunks and which do not.
   *
   * @param map - The BacklogCodeMap produced by `linkChunksToBacklog`
   * @param allItems - The full list of backlog items to evaluate
   * @returns A CoverageReport with linked/unlinked items and statistics
   */
  getCoverageReport(map: BacklogCodeMap, allItems: BacklogItem[]): CoverageReport {
    const linkedItems: BacklogItem[] = [];
    const unlinkedItems: BacklogItem[] = [];

    for (const item of allItems) {
      const chunks = map.itemToChunks.get(item.id);
      if (chunks && chunks.size > 0) {
        linkedItems.push(item);
      } else {
        unlinkedItems.push(item);
      }
    }

    const totalItems = allItems.length;
    const linkedCount = linkedItems.length;
    const unlinkedCount = unlinkedItems.length;
    const coveragePercent =
      totalItems > 0 ? Math.round((linkedCount / totalItems) * 100) : 0;

    return {
      linkedItems,
      unlinkedItems,
      totalItems,
      linkedCount,
      unlinkedCount,
      coveragePercent,
    };
  }
}
