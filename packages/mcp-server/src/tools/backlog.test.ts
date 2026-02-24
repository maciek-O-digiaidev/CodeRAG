import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';
import { handleBacklog, backlogInputSchema } from './backlog.js';
import type { BacklogProvider, BacklogItem } from '@code-rag/core';
import { BacklogError } from '@code-rag/core';

// --- Helpers ---

function makeBacklogItem(overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: 'item-1',
    externalId: 'AB#123',
    title: 'Implement search feature',
    description: 'Add full-text search to the API',
    type: 'story',
    state: 'Active',
    assignedTo: 'dev@example.com',
    tags: ['search', 'api'],
    linkedCodePaths: ['src/search/index.ts', 'src/api/search.ts'],
    url: 'https://dev.azure.com/project/_workitems/edit/123',
    metadata: {},
    ...overrides,
  };
}

function parseResponse(response: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(response.content[0]!.text);
}

// --- Input Validation Tests ---

describe('backlogInputSchema', () => {
  it('should accept valid search action', () => {
    const result = backlogInputSchema.safeParse({ action: 'search', query: 'auth' });
    expect(result.success).toBe(true);
  });

  it('should accept valid get action', () => {
    const result = backlogInputSchema.safeParse({ action: 'get', id: 'item-1' });
    expect(result.success).toBe(true);
  });

  it('should accept valid list action', () => {
    const result = backlogInputSchema.safeParse({ action: 'list' });
    expect(result.success).toBe(true);
  });

  it('should accept list action with filters', () => {
    const result = backlogInputSchema.safeParse({
      action: 'list',
      types: ['bug', 'story'],
      states: ['Active', 'New'],
      tags: ['search'],
      limit: 20,
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing action', () => {
    const result = backlogInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject invalid action', () => {
    const result = backlogInputSchema.safeParse({ action: 'delete' });
    expect(result.success).toBe(false);
  });

  it('should apply default limit of 10', () => {
    const result = backlogInputSchema.parse({ action: 'list' });
    expect(result.limit).toBe(10);
  });

  it('should reject limit above 50', () => {
    const result = backlogInputSchema.safeParse({ action: 'list', limit: 51 });
    expect(result.success).toBe(false);
  });

  it('should accept limit at 50', () => {
    const result = backlogInputSchema.safeParse({ action: 'list', limit: 50 });
    expect(result.success).toBe(true);
  });

  it('should reject non-positive limit', () => {
    const result = backlogInputSchema.safeParse({ action: 'list', limit: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject invalid types', () => {
    const result = backlogInputSchema.safeParse({ action: 'list', types: ['invalid'] });
    expect(result.success).toBe(false);
  });

  it('should accept valid types', () => {
    const result = backlogInputSchema.safeParse({ action: 'list', types: ['epic', 'story', 'task', 'bug', 'feature'] });
    expect(result.success).toBe(true);
  });
});

// --- Handler Tests ---

describe('handleBacklog', () => {
  let mockProvider: BacklogProvider;

  beforeEach(() => {
    mockProvider = {
      name: 'mock-provider',
      initialize: vi.fn(),
      getItems: vi.fn(),
      getItem: vi.fn(),
      searchItems: vi.fn(),
      getLinkedCode: vi.fn(),
    } as unknown as BacklogProvider;
  });

  // --- Validation errors ---

  it('should return validation error when action is missing', async () => {
    const response = await handleBacklog({}, mockProvider);
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should return validation error for invalid action', async () => {
    const response = await handleBacklog({ action: 'delete' }, mockProvider);
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  // --- Null provider ---

  it('should return graceful message when backlogProvider is null', async () => {
    const response = await handleBacklog({ action: 'list' }, null);
    const parsed = parseResponse(response) as { items: unknown[]; message: string };

    expect(parsed.items).toEqual([]);
    expect(parsed.message).toContain('Backlog provider not initialized');
  });

  // --- Search action ---

  it('should search items with query', async () => {
    const items = [makeBacklogItem()];
    vi.mocked(mockProvider.searchItems).mockResolvedValue(ok(items));

    const response = await handleBacklog(
      { action: 'search', query: 'search feature' },
      mockProvider,
    );
    const parsed = parseResponse(response) as { items: Array<{ id: string; title: string }> };

    expect(mockProvider.searchItems).toHaveBeenCalledWith('search feature', 10);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.id).toBe('item-1');
    expect(parsed.items[0]!.title).toBe('Implement search feature');
  });

  it('should pass custom limit to searchItems', async () => {
    vi.mocked(mockProvider.searchItems).mockResolvedValue(ok([]));

    await handleBacklog(
      { action: 'search', query: 'test', limit: 25 },
      mockProvider,
    );

    expect(mockProvider.searchItems).toHaveBeenCalledWith('test', 25);
  });

  it('should return error when search action has no query', async () => {
    const response = await handleBacklog({ action: 'search' }, mockProvider);
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Invalid input');
    expect(parsed.message).toContain('query is required');
  });

  it('should handle search provider errors', async () => {
    vi.mocked(mockProvider.searchItems).mockResolvedValue(
      err(new BacklogError('API rate limited')),
    );

    const response = await handleBacklog(
      { action: 'search', query: 'test' },
      mockProvider,
    );
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Backlog search failed');
    expect(parsed.message).toContain('API rate limited');
  });

  it('should format search results with correct fields', async () => {
    const items = [makeBacklogItem()];
    vi.mocked(mockProvider.searchItems).mockResolvedValue(ok(items));

    const response = await handleBacklog(
      { action: 'search', query: 'search' },
      mockProvider,
    );
    const parsed = parseResponse(response) as { items: Array<Record<string, unknown>> };

    const item = parsed.items[0]!;
    expect(item.id).toBe('item-1');
    expect(item.externalId).toBe('AB#123');
    expect(item.title).toBe('Implement search feature');
    expect(item.type).toBe('story');
    expect(item.state).toBe('Active');
    expect(item.tags).toEqual(['search', 'api']);
    expect(item.url).toBe('https://dev.azure.com/project/_workitems/edit/123');
    // Search results should not include linkedCodePaths
    expect(item.linkedCodePaths).toBeUndefined();
  });

  // --- Get action ---

  it('should get a single item by ID', async () => {
    const item = makeBacklogItem();
    vi.mocked(mockProvider.getItem).mockResolvedValue(ok(item));

    const response = await handleBacklog(
      { action: 'get', id: 'item-1' },
      mockProvider,
    );
    const parsed = parseResponse(response) as { item: { id: string; linkedCodePaths: string[] } };

    expect(mockProvider.getItem).toHaveBeenCalledWith('item-1');
    expect(parsed.item.id).toBe('item-1');
    // Get action should include linkedCodePaths
    expect(parsed.item.linkedCodePaths).toEqual(['src/search/index.ts', 'src/api/search.ts']);
  });

  it('should return error when get action has no id', async () => {
    const response = await handleBacklog({ action: 'get' }, mockProvider);
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Invalid input');
    expect(parsed.message).toContain('id is required');
  });

  it('should handle get provider errors', async () => {
    vi.mocked(mockProvider.getItem).mockResolvedValue(
      err(new BacklogError('Item not found')),
    );

    const response = await handleBacklog(
      { action: 'get', id: 'nonexistent' },
      mockProvider,
    );
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Backlog get failed');
    expect(parsed.message).toContain('Item not found');
  });

  it('should not include linkedCodePaths in get when empty', async () => {
    const item = makeBacklogItem({ linkedCodePaths: [] });
    vi.mocked(mockProvider.getItem).mockResolvedValue(ok(item));

    const response = await handleBacklog(
      { action: 'get', id: 'item-1' },
      mockProvider,
    );
    const parsed = parseResponse(response) as { item: Record<string, unknown> };

    expect(parsed.item.linkedCodePaths).toBeUndefined();
  });

  // --- List action ---

  it('should list items with default filters', async () => {
    const items = [makeBacklogItem(), makeBacklogItem({ id: 'item-2', externalId: 'AB#124', title: 'Fix bug' })];
    vi.mocked(mockProvider.getItems).mockResolvedValue(ok(items));

    const response = await handleBacklog({ action: 'list' }, mockProvider);
    const parsed = parseResponse(response) as { items: Array<{ id: string }> };

    expect(mockProvider.getItems).toHaveBeenCalledWith({
      types: undefined,
      states: undefined,
      tags: undefined,
      limit: 10,
    });
    expect(parsed.items).toHaveLength(2);
  });

  it('should list items with type filter', async () => {
    vi.mocked(mockProvider.getItems).mockResolvedValue(ok([]));

    await handleBacklog(
      { action: 'list', types: ['bug', 'task'] },
      mockProvider,
    );

    expect(mockProvider.getItems).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['bug', 'task'] }),
    );
  });

  it('should list items with state filter', async () => {
    vi.mocked(mockProvider.getItems).mockResolvedValue(ok([]));

    await handleBacklog(
      { action: 'list', states: ['Active', 'New'] },
      mockProvider,
    );

    expect(mockProvider.getItems).toHaveBeenCalledWith(
      expect.objectContaining({ states: ['Active', 'New'] }),
    );
  });

  it('should list items with tags filter', async () => {
    vi.mocked(mockProvider.getItems).mockResolvedValue(ok([]));

    await handleBacklog(
      { action: 'list', tags: ['search', 'api'] },
      mockProvider,
    );

    expect(mockProvider.getItems).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['search', 'api'] }),
    );
  });

  it('should list items with all filters combined', async () => {
    vi.mocked(mockProvider.getItems).mockResolvedValue(ok([]));

    await handleBacklog(
      {
        action: 'list',
        types: ['story'],
        states: ['Active'],
        tags: ['search'],
        limit: 5,
      },
      mockProvider,
    );

    expect(mockProvider.getItems).toHaveBeenCalledWith({
      types: ['story'],
      states: ['Active'],
      tags: ['search'],
      limit: 5,
    });
  });

  it('should handle list provider errors', async () => {
    vi.mocked(mockProvider.getItems).mockResolvedValue(
      err(new BacklogError('Connection timeout')),
    );

    const response = await handleBacklog({ action: 'list' }, mockProvider);
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Backlog list failed');
    expect(parsed.message).toContain('Connection timeout');
  });

  // --- Exception handling ---

  it('should handle thrown exceptions', async () => {
    vi.mocked(mockProvider.searchItems).mockRejectedValue(new Error('Unexpected crash'));

    const response = await handleBacklog(
      { action: 'search', query: 'test' },
      mockProvider,
    );
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Backlog operation failed');
    expect(parsed.message).toBe('Unexpected crash');
  });

  it('should handle thrown non-Error exceptions', async () => {
    vi.mocked(mockProvider.getItems).mockRejectedValue('string error');

    const response = await handleBacklog({ action: 'list' }, mockProvider);
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Backlog operation failed');
    expect(parsed.message).toBe('Unknown error');
  });

  // --- Limit validation ---

  it('should reject limit above 50', async () => {
    const response = await handleBacklog(
      { action: 'list', limit: 51 },
      mockProvider,
    );
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should accept limit at max 50', async () => {
    vi.mocked(mockProvider.getItems).mockResolvedValue(ok([]));

    const response = await handleBacklog(
      { action: 'list', limit: 50 },
      mockProvider,
    );
    const parsed = parseResponse(response) as { items: unknown[] };

    expect(parsed.items).toBeDefined();
  });
});
