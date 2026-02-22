import { describe, it, expect, vi } from 'vitest';
import { ok, err } from 'neverthrow';
import { CodeLinker } from './code-linker.js';
import type { BacklogCodeMap } from './code-linker.js';
import { BacklogError } from './backlog-provider.js';
import type { BacklogProvider } from './backlog-provider.js';
import type { BacklogItem } from './types.js';
import type { Chunk } from '../types/chunk.js';

// --- Helpers ---

function createMockChunk(overrides?: Partial<Chunk>): Chunk {
  return {
    id: 'chunk-1',
    content: '// some code',
    nlSummary: 'A code chunk',
    filePath: 'src/example.ts',
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    metadata: {
      chunkType: 'function',
      name: 'example',
      declarations: [],
      imports: [],
      exports: [],
    },
    ...overrides,
  };
}

function createMockItem(overrides?: Partial<BacklogItem>): BacklogItem {
  return {
    id: '123',
    externalId: 'AB#123',
    title: 'Fix login bug',
    description: 'Users cannot log in when using SSO',
    type: 'bug',
    state: 'Active',
    assignedTo: 'dev@example.com',
    tags: ['auth'],
    linkedCodePaths: [],
    url: 'https://devops.example.com/workitem/123',
    metadata: {},
    ...overrides,
  };
}

function createMockProvider(items: BacklogItem[]): BacklogProvider {
  return {
    name: 'mock-provider',
    initialize: vi.fn().mockResolvedValue(ok(undefined)),
    getItems: vi.fn().mockResolvedValue(ok(items)),
    getItem: vi.fn().mockImplementation(async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item) {
        return err(new BacklogError(`Item not found: ${id}`));
      }
      return ok(item);
    }),
    searchItems: vi.fn().mockResolvedValue(ok(items)),
    getLinkedCode: vi.fn().mockResolvedValue(ok([])),
  };
}

// --- CodeLinker tests ---

describe('CodeLinker', () => {
  describe('linkChunksToBacklog', () => {
    it('should link a chunk containing a single AB# reference', async () => {
      const item = createMockItem({ id: '42', externalId: 'AB#42' });
      const chunk = createMockChunk({
        id: 'chunk-a',
        content: '// Fixes AB#42\nfunction login() { return true; }',
      });
      const provider = createMockProvider([item]);
      const linker = new CodeLinker();

      const result = await linker.linkChunksToBacklog([chunk], provider);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const map = result.value;
        expect(map.itemToChunks.get('42')).toEqual(new Set(['chunk-a']));
        expect(map.chunkToItems.get('chunk-a')).toEqual(new Set(['42']));
      }
    });

    it('should link a chunk with multiple AB# references', async () => {
      const item1 = createMockItem({ id: '10', externalId: 'AB#10' });
      const item2 = createMockItem({ id: '20', externalId: 'AB#20' });
      const chunk = createMockChunk({
        id: 'chunk-multi',
        content: '// Implements AB#10 and AB#20\nexport class Auth {}',
      });
      const provider = createMockProvider([item1, item2]);
      const linker = new CodeLinker();

      const result = await linker.linkChunksToBacklog([chunk], provider);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const map = result.value;
        expect(map.itemToChunks.get('10')).toEqual(new Set(['chunk-multi']));
        expect(map.itemToChunks.get('20')).toEqual(new Set(['chunk-multi']));
        expect(map.chunkToItems.get('chunk-multi')).toEqual(
          new Set(['10', '20']),
        );
      }
    });

    it('should link multiple chunks to the same backlog item', async () => {
      const item = createMockItem({ id: '99', externalId: 'AB#99' });
      const chunk1 = createMockChunk({
        id: 'chunk-1',
        content: '// AB#99 implementation part 1',
      });
      const chunk2 = createMockChunk({
        id: 'chunk-2',
        content: '// AB#99 implementation part 2',
      });
      const provider = createMockProvider([item]);
      const linker = new CodeLinker();

      const result = await linker.linkChunksToBacklog(
        [chunk1, chunk2],
        provider,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const map = result.value;
        expect(map.itemToChunks.get('99')).toEqual(
          new Set(['chunk-1', 'chunk-2']),
        );
        expect(map.chunkToItems.get('chunk-1')).toEqual(new Set(['99']));
        expect(map.chunkToItems.get('chunk-2')).toEqual(new Set(['99']));
      }
    });

    it('should return empty maps when chunks have no references', async () => {
      const chunk = createMockChunk({
        id: 'chunk-plain',
        content: 'function add(a: number, b: number) { return a + b; }',
      });
      const provider = createMockProvider([]);
      const linker = new CodeLinker();

      const result = await linker.linkChunksToBacklog([chunk], provider);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const map = result.value;
        expect(map.itemToChunks.size).toBe(0);
        expect(map.chunkToItems.size).toBe(0);
      }
    });

    it('should return empty maps when chunks array is empty', async () => {
      const provider = createMockProvider([]);
      const linker = new CodeLinker();

      const result = await linker.linkChunksToBacklog([], provider);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const map = result.value;
        expect(map.itemToChunks.size).toBe(0);
        expect(map.chunkToItems.size).toBe(0);
      }
    });

    it('should skip references to non-existent backlog items', async () => {
      const item = createMockItem({ id: '100', externalId: 'AB#100' });
      const chunk = createMockChunk({
        id: 'chunk-mixed',
        content: '// AB#100 exists, AB#999 does not',
      });
      const provider = createMockProvider([item]);
      const linker = new CodeLinker();

      const result = await linker.linkChunksToBacklog([chunk], provider);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const map = result.value;
        // Only item 100 should be linked
        expect(map.itemToChunks.has('100')).toBe(true);
        expect(map.itemToChunks.has('999')).toBe(false);
        expect(map.chunkToItems.get('chunk-mixed')).toEqual(new Set(['100']));
      }
    });

    it('should deduplicate repeated references in same chunk', async () => {
      const item = createMockItem({ id: '55', externalId: 'AB#55' });
      const chunk = createMockChunk({
        id: 'chunk-dup',
        content: '// AB#55 first mention\n// AB#55 second mention',
      });
      const provider = createMockProvider([item]);
      const linker = new CodeLinker();

      const result = await linker.linkChunksToBacklog([chunk], provider);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const map = result.value;
        // Should only have one entry, not duplicated
        expect(map.itemToChunks.get('55')).toEqual(new Set(['chunk-dup']));
        expect(map.chunkToItems.get('chunk-dup')).toEqual(new Set(['55']));
      }
    });

    it('should handle references in code comments', async () => {
      const item = createMockItem({ id: '200', externalId: 'AB#200' });
      const chunk = createMockChunk({
        id: 'chunk-comment',
        content: `
          /*
           * Implements AB#200 — user authentication flow
           */
          export class AuthService {
            login() { return true; }
          }
        `,
      });
      const provider = createMockProvider([item]);
      const linker = new CodeLinker();

      const result = await linker.linkChunksToBacklog([chunk], provider);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const map = result.value;
        expect(map.itemToChunks.get('200')).toEqual(
          new Set(['chunk-comment']),
        );
      }
    });

    it('should validate items against the provider', async () => {
      const item = createMockItem({ id: '7', externalId: 'AB#7' });
      const chunk = createMockChunk({
        id: 'chunk-val',
        content: '// AB#7 fix',
      });
      const provider = createMockProvider([item]);
      const linker = new CodeLinker();

      await linker.linkChunksToBacklog([chunk], provider);

      expect(provider.getItem).toHaveBeenCalledWith('7');
    });
  });

  describe('getCoverageReport', () => {
    it('should report all items as linked when all have chunks', () => {
      const items = [
        createMockItem({ id: '1', title: 'Story 1' }),
        createMockItem({ id: '2', title: 'Story 2' }),
      ];
      const map: BacklogCodeMap = {
        itemToChunks: new Map([
          ['1', new Set(['chunk-a'])],
          ['2', new Set(['chunk-b'])],
        ]),
        chunkToItems: new Map([
          ['chunk-a', new Set(['1'])],
          ['chunk-b', new Set(['2'])],
        ]),
      };
      const linker = new CodeLinker();

      const report = linker.getCoverageReport(map, items);

      expect(report.linkedItems).toHaveLength(2);
      expect(report.unlinkedItems).toHaveLength(0);
      expect(report.totalItems).toBe(2);
      expect(report.linkedCount).toBe(2);
      expect(report.unlinkedCount).toBe(0);
      expect(report.coveragePercent).toBe(100);
    });

    it('should report all items as unlinked when none have chunks', () => {
      const items = [
        createMockItem({ id: '1', title: 'Story 1' }),
        createMockItem({ id: '2', title: 'Story 2' }),
      ];
      const map: BacklogCodeMap = {
        itemToChunks: new Map(),
        chunkToItems: new Map(),
      };
      const linker = new CodeLinker();

      const report = linker.getCoverageReport(map, items);

      expect(report.linkedItems).toHaveLength(0);
      expect(report.unlinkedItems).toHaveLength(2);
      expect(report.totalItems).toBe(2);
      expect(report.linkedCount).toBe(0);
      expect(report.unlinkedCount).toBe(2);
      expect(report.coveragePercent).toBe(0);
    });

    it('should correctly split linked and unlinked items', () => {
      const items = [
        createMockItem({ id: '1', title: 'Linked Story' }),
        createMockItem({ id: '2', title: 'Unlinked Story' }),
        createMockItem({ id: '3', title: 'Another Linked Story' }),
      ];
      const map: BacklogCodeMap = {
        itemToChunks: new Map([
          ['1', new Set(['chunk-a'])],
          ['3', new Set(['chunk-b', 'chunk-c'])],
        ]),
        chunkToItems: new Map([
          ['chunk-a', new Set(['1'])],
          ['chunk-b', new Set(['3'])],
          ['chunk-c', new Set(['3'])],
        ]),
      };
      const linker = new CodeLinker();

      const report = linker.getCoverageReport(map, items);

      expect(report.linkedItems).toHaveLength(2);
      expect(report.unlinkedItems).toHaveLength(1);
      expect(report.unlinkedItems[0]!.id).toBe('2');
      expect(report.totalItems).toBe(3);
      expect(report.linkedCount).toBe(2);
      expect(report.unlinkedCount).toBe(1);
      expect(report.coveragePercent).toBe(67);
    });

    it('should handle empty items array', () => {
      const map: BacklogCodeMap = {
        itemToChunks: new Map(),
        chunkToItems: new Map(),
      };
      const linker = new CodeLinker();

      const report = linker.getCoverageReport(map, []);

      expect(report.linkedItems).toHaveLength(0);
      expect(report.unlinkedItems).toHaveLength(0);
      expect(report.totalItems).toBe(0);
      expect(report.linkedCount).toBe(0);
      expect(report.unlinkedCount).toBe(0);
      expect(report.coveragePercent).toBe(0);
    });

    it('should handle items with empty chunk sets as unlinked', () => {
      const items = [
        createMockItem({ id: '1', title: 'Story with empty set' }),
      ];
      const map: BacklogCodeMap = {
        itemToChunks: new Map([['1', new Set()]]),
        chunkToItems: new Map(),
      };
      const linker = new CodeLinker();

      const report = linker.getCoverageReport(map, items);

      expect(report.linkedItems).toHaveLength(0);
      expect(report.unlinkedItems).toHaveLength(1);
      expect(report.coveragePercent).toBe(0);
    });

    it('should calculate correct percentage with rounding', () => {
      const items = [
        createMockItem({ id: '1' }),
        createMockItem({ id: '2' }),
        createMockItem({ id: '3' }),
      ];
      const map: BacklogCodeMap = {
        itemToChunks: new Map([['1', new Set(['chunk-a'])]]),
        chunkToItems: new Map([['chunk-a', new Set(['1'])]]),
      };
      const linker = new CodeLinker();

      const report = linker.getCoverageReport(map, items);

      // 1/3 = 33.33... -> rounds to 33
      expect(report.coveragePercent).toBe(33);
    });
  });
});
