import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ok, err, type Result } from 'neverthrow';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BacklogError } from './backlog-provider.js';
import type { BacklogProvider } from './backlog-provider.js';
import type { BacklogItem, BacklogQuery, BacklogItemType } from './types.js';
import { loadConfig } from '../config/config-parser.js';

// --- BacklogError tests ---

describe('BacklogError', () => {
  it('should have name set to BacklogError', () => {
    const error = new BacklogError('something went wrong');
    expect(error.name).toBe('BacklogError');
  });

  it('should preserve the error message', () => {
    const error = new BacklogError('connection failed');
    expect(error.message).toBe('connection failed');
  });

  it('should be an instance of Error', () => {
    const error = new BacklogError('test');
    expect(error).toBeInstanceOf(Error);
  });

  it('should be an instance of BacklogError', () => {
    const error = new BacklogError('test');
    expect(error).toBeInstanceOf(BacklogError);
  });
});

// --- Mock BacklogProvider ---

function createMockItem(overrides?: Partial<BacklogItem>): BacklogItem {
  return {
    id: 'item-1',
    externalId: 'AB#123',
    title: 'Fix login bug',
    description: 'Users cannot log in when using SSO',
    type: 'bug',
    state: 'Active',
    assignedTo: 'dev@example.com',
    tags: ['auth', 'sso'],
    linkedCodePaths: ['src/auth/login.ts', 'src/auth/sso.ts'],
    url: 'https://devops.example.com/workitem/123',
    metadata: { priority: 1, iteration: 'Sprint 5' },
    ...overrides,
  };
}

class MockBacklogProvider implements BacklogProvider {
  readonly name = 'mock-provider';

  private items: BacklogItem[] = [];

  constructor(items?: BacklogItem[]) {
    this.items = items ?? [createMockItem()];
  }

  async initialize(
    _config: Record<string, unknown>,
  ): Promise<Result<void, BacklogError>> {
    return ok(undefined);
  }

  async getItems(
    query: BacklogQuery,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    let results = [...this.items];

    if (query.types && query.types.length > 0) {
      results = results.filter((item) => query.types!.includes(item.type));
    }
    if (query.states && query.states.length > 0) {
      results = results.filter((item) => query.states!.includes(item.state));
    }
    if (query.assignedTo) {
      results = results.filter(
        (item) => item.assignedTo === query.assignedTo,
      );
    }
    if (query.tags && query.tags.length > 0) {
      results = results.filter((item) =>
        query.tags!.some((tag) => item.tags.includes(tag)),
      );
    }
    if (query.text) {
      const text = query.text.toLowerCase();
      results = results.filter(
        (item) =>
          item.title.toLowerCase().includes(text) ||
          item.description.toLowerCase().includes(text),
      );
    }
    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }

    return ok(results);
  }

  async getItem(id: string): Promise<Result<BacklogItem, BacklogError>> {
    const item = this.items.find((i) => i.id === id);
    if (!item) {
      return err(new BacklogError(`Item not found: ${id}`));
    }
    return ok(item);
  }

  async searchItems(
    text: string,
    limit?: number,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    const lowerText = text.toLowerCase();
    let results = this.items.filter(
      (item) =>
        item.title.toLowerCase().includes(lowerText) ||
        item.description.toLowerCase().includes(lowerText),
    );
    if (limit !== undefined) {
      results = results.slice(0, limit);
    }
    return ok(results);
  }

  async getLinkedCode(
    itemId: string,
  ): Promise<Result<string[], BacklogError>> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item) {
      return err(new BacklogError(`Item not found: ${itemId}`));
    }
    return ok(item.linkedCodePaths);
  }
}

// --- MockBacklogProvider satisfies BacklogProvider ---

describe('BacklogProvider interface', () => {
  it('should be satisfiable by a mock implementation', () => {
    const provider: BacklogProvider = new MockBacklogProvider();
    expect(provider.name).toBe('mock-provider');
  });

  describe('initialize', () => {
    it('should return ok on successful initialization', async () => {
      const provider = new MockBacklogProvider();
      const result = await provider.initialize({ apiKey: 'test-key' });
      expect(result.isOk()).toBe(true);
    });
  });

  describe('getItems', () => {
    it('should return all items with empty query', async () => {
      const items = [
        createMockItem({ id: '1', type: 'bug' }),
        createMockItem({ id: '2', type: 'story' }),
        createMockItem({ id: '3', type: 'task' }),
      ];
      const provider = new MockBacklogProvider(items);
      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
      }
    });

    it('should filter items by type', async () => {
      const items = [
        createMockItem({ id: '1', type: 'bug' }),
        createMockItem({ id: '2', type: 'story' }),
        createMockItem({ id: '3', type: 'bug' }),
      ];
      const provider = new MockBacklogProvider(items);
      const result = await provider.getItems({ types: ['bug'] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((item) => item.type === 'bug')).toBe(true);
      }
    });

    it('should filter items by state', async () => {
      const items = [
        createMockItem({ id: '1', state: 'Active' }),
        createMockItem({ id: '2', state: 'Closed' }),
      ];
      const provider = new MockBacklogProvider(items);
      const result = await provider.getItems({ states: ['Active'] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.state).toBe('Active');
      }
    });

    it('should respect the limit parameter', async () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        createMockItem({ id: `item-${i}` }),
      );
      const provider = new MockBacklogProvider(items);
      const result = await provider.getItems({ limit: 3 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
      }
    });

    it('should return items matching the BacklogItem shape', async () => {
      const provider = new MockBacklogProvider();
      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const item = result.value[0]!;
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('externalId');
        expect(item).toHaveProperty('title');
        expect(item).toHaveProperty('description');
        expect(item).toHaveProperty('type');
        expect(item).toHaveProperty('state');
        expect(item).toHaveProperty('tags');
        expect(item).toHaveProperty('linkedCodePaths');
        expect(item).toHaveProperty('metadata');
        expect(Array.isArray(item.tags)).toBe(true);
        expect(Array.isArray(item.linkedCodePaths)).toBe(true);
        expect(typeof item.metadata).toBe('object');
      }
    });
  });

  describe('getItem', () => {
    it('should return a single item by id', async () => {
      const provider = new MockBacklogProvider([
        createMockItem({ id: 'target', title: 'Target Item' }),
      ]);
      const result = await provider.getItem('target');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('target');
        expect(result.value.title).toBe('Target Item');
      }
    });

    it('should return BacklogError when item is not found', async () => {
      const provider = new MockBacklogProvider([]);
      const result = await provider.getItem('nonexistent');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(BacklogError);
        expect(result.error.message).toContain('nonexistent');
      }
    });
  });

  describe('searchItems', () => {
    it('should return items matching search text', async () => {
      const items = [
        createMockItem({ id: '1', title: 'Fix login bug' }),
        createMockItem({ id: '2', title: 'Add dashboard feature' }),
        createMockItem({ id: '3', title: 'Login page redesign' }),
      ];
      const provider = new MockBacklogProvider(items);
      const result = await provider.searchItems('login');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('should respect the limit parameter in search', async () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        createMockItem({ id: `item-${i}`, title: `Common title ${i}` }),
      );
      const provider = new MockBacklogProvider(items);
      const result = await provider.searchItems('Common', 2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('should return empty array when nothing matches', async () => {
      const provider = new MockBacklogProvider([
        createMockItem({ title: 'Something else' }),
      ]);
      const result = await provider.searchItems('nonexistent query');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('getLinkedCode', () => {
    it('should return linked code paths for a valid item', async () => {
      const provider = new MockBacklogProvider([
        createMockItem({
          id: 'linked-item',
          linkedCodePaths: ['src/foo.ts', 'src/bar.ts'],
        }),
      ]);
      const result = await provider.getLinkedCode('linked-item');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(['src/foo.ts', 'src/bar.ts']);
      }
    });

    it('should return BacklogError when item is not found', async () => {
      const provider = new MockBacklogProvider([]);
      const result = await provider.getLinkedCode('missing');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(BacklogError);
        expect(result.error.message).toContain('missing');
      }
    });

    it('should return empty array when item has no linked code', async () => {
      const provider = new MockBacklogProvider([
        createMockItem({ id: 'no-links', linkedCodePaths: [] }),
      ]);
      const result = await provider.getLinkedCode('no-links');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });
});

// --- BacklogItemType tests ---

describe('BacklogItemType', () => {
  it('should accept all valid item types', () => {
    const validTypes: BacklogItemType[] = [
      'epic',
      'story',
      'task',
      'bug',
      'feature',
    ];
    expect(validTypes).toHaveLength(5);

    // Each type should be a string
    for (const type of validTypes) {
      expect(typeof type).toBe('string');
    }
  });
});

// --- Config schema tests ---

describe('Config schema with backlog', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'coderag-backlog-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should accept valid backlog config', async () => {
    const configContent = `
version: "1"
project:
  name: test-project
  languages: auto
ingestion:
  maxTokensPerChunk: 512
  exclude:
    - node_modules
embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: 768
llm:
  provider: ollama
  model: "qwen2.5-coder:7b"
search:
  topK: 10
  vectorWeight: 0.7
  bm25Weight: 0.3
storage:
  path: .coderag
backlog:
  provider: azure-devops
  config:
    organization: my-org
    project: my-project
    pat: "secret-token"
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.backlog).toBeDefined();
      expect(result.value.backlog!.provider).toBe('azure-devops');
      expect(result.value.backlog!.config).toEqual({
        organization: 'my-org',
        project: 'my-project',
        pat: 'secret-token',
      });
    }
  });

  it('should accept backlog config without optional config field', async () => {
    const configContent = `
version: "1"
project:
  name: test-project
  languages: auto
ingestion:
  maxTokensPerChunk: 512
  exclude:
    - node_modules
embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: 768
llm:
  provider: ollama
  model: "qwen2.5-coder:7b"
search:
  topK: 10
  vectorWeight: 0.7
  bm25Weight: 0.3
storage:
  path: .coderag
backlog:
  provider: jira
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.backlog).toBeDefined();
      expect(result.value.backlog!.provider).toBe('jira');
      expect(result.value.backlog!.config).toEqual({});
    }
  });

  it('should accept config without backlog section (backwards compatibility)', async () => {
    const configContent = `
version: "1"
project:
  name: test-project
  languages: auto
ingestion:
  maxTokensPerChunk: 512
  exclude:
    - node_modules
embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: 768
llm:
  provider: ollama
  model: "qwen2.5-coder:7b"
search:
  topK: 10
  vectorWeight: 0.7
  bm25Weight: 0.3
storage:
  path: .coderag
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.backlog).toBeUndefined();
    }
  });

  it('should accept minimal config without backlog (defaults only)', async () => {
    const configContent = `
version: "1"
project:
  name: minimal-project
`;
    writeFileSync(join(tempDir, '.coderag.yaml'), configContent);

    const result = await loadConfig(tempDir);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.backlog).toBeUndefined();
      expect(result.value.project.name).toBe('minimal-project');
    }
  });
});
