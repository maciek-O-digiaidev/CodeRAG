import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClickUpProvider } from './clickup-provider.js';
import { BacklogError } from './backlog-provider.js';

// Mock the global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createClickUpTask(overrides?: Record<string, unknown>) {
  return {
    id: 'task123',
    custom_id: null,
    name: 'Fix login bug',
    description: 'Users cannot log in when using SSO',
    status: {
      status: 'in progress',
      type: 'custom',
    },
    assignees: [
      {
        id: 1,
        username: 'john.doe',
        email: 'john@example.com',
      },
    ],
    tags: [
      { name: 'auth' },
      { name: 'sso' },
    ],
    custom_fields: [],
    url: 'https://app.clickup.com/t/task123',
    list: { id: 'list1', name: 'Sprint 5' },
    space: { id: 'space1' },
    folder: { id: 'folder1', name: 'Backend' },
    type: 'task',
    ...overrides,
  };
}

function createOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  };
}

function createErrorResponse(status: number, statusText: string) {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  };
}

describe('ClickUpProvider', () => {
  let provider: ClickUpProvider;

  beforeEach(() => {
    provider = new ClickUpProvider();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have name set to clickup', () => {
    expect(provider.name).toBe('clickup');
  });

  describe('initialize', () => {
    it('should return err when apiKey is missing', async () => {
      const result = await provider.initialize({ teamId: 'team1' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(BacklogError);
        expect(result.error.message).toContain('apiKey');
      }
    });

    it('should return err when teamId is missing', async () => {
      const result = await provider.initialize({ apiKey: 'pk_test' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(BacklogError);
        expect(result.error.message).toContain('teamId');
      }
    });

    it('should return err when apiKey is not a string', async () => {
      const result = await provider.initialize({ apiKey: 123, teamId: 'team1' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('apiKey');
      }
    });

    it('should return err when teamId is not a string', async () => {
      const result = await provider.initialize({ apiKey: 'pk_test', teamId: 123 });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('teamId');
      }
    });

    it('should return ok when connection succeeds', async () => {
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ team: { id: 'team1', name: 'My Team' } }),
      );

      const result = await provider.initialize({
        apiKey: 'pk_test',
        teamId: 'team1',
      });

      expect(result.isOk()).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.clickup.com/api/v2/team/team1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'pk_test',
          }),
        }),
      );
    });

    it('should return err when connection fails with HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(401, 'Unauthorized'),
      );

      const result = await provider.initialize({
        apiKey: 'bad-key',
        teamId: 'team1',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('401');
        expect(result.error.message).toContain('Unauthorized');
      }
    });

    it('should return err when fetch throws a network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.initialize({
        apiKey: 'pk_test',
        teamId: 'team1',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Network error');
      }
    });
  });

  describe('getItems', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ team: { id: 'team1', name: 'My Team' } }),
      );
      await provider.initialize({ apiKey: 'pk_test', teamId: 'team1' });
    });

    it('should fetch tasks and map them to BacklogItems', async () => {
      const task = createClickUpTask();
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [task] }),
      );

      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        const item = result.value[0]!;
        expect(item.id).toBe('task123');
        expect(item.externalId).toBe('CU-task123');
        expect(item.title).toBe('Fix login bug');
        expect(item.description).toBe('Users cannot log in when using SSO');
        expect(item.state).toBe('in progress');
        expect(item.type).toBe('task');
        expect(item.assignedTo).toBe('john.doe');
        expect(item.tags).toEqual(['auth', 'sso']);
        expect(item.url).toBe('https://app.clickup.com/t/task123');
      }
    });

    it('should use custom_id for externalId when available', async () => {
      const task = createClickUpTask({ custom_id: 'PROJ-42' });
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [task] }),
      );

      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.externalId).toBe('PROJ-42');
      }
    });

    it('should pass query filters as URL parameters', async () => {
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [] }),
      );

      await provider.getItems({
        states: ['active', 'open'],
        tags: ['urgent'],
        text: 'login',
        assignedTo: 'user1',
        limit: 10,
      });

      const fetchUrl = mockFetch.mock.calls[1]![0] as string;
      expect(fetchUrl).toContain('statuses%5B%5D=active');
      expect(fetchUrl).toContain('statuses%5B%5D=open');
      expect(fetchUrl).toContain('tags%5B%5D=urgent');
      expect(fetchUrl).toContain('name=login');
      expect(fetchUrl).toContain('assignees%5B%5D=user1');
      expect(fetchUrl).toContain('page_size=10');
    });

    it('should apply limit to results', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createClickUpTask({ id: `task-${i}`, name: `Task ${i}` }),
      );
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks }),
      );

      const result = await provider.getItems({ limit: 2 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('should return err on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(500, 'Internal Server Error'),
      );

      const result = await provider.getItems({});

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('500');
      }
    });

    it('should return err on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await provider.getItems({});

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('should map bug type correctly', async () => {
      const task = createClickUpTask({ type: 'bug' });
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [task] }),
      );

      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.type).toBe('bug');
      }
    });

    it('should map milestone type to epic', async () => {
      const task = createClickUpTask({ type: 'milestone' });
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [task] }),
      );

      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.type).toBe('epic');
      }
    });

    it('should default unknown types to task', async () => {
      const task = createClickUpTask({ type: 'unknown_type' });
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [task] }),
      );

      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.type).toBe('task');
      }
    });

    it('should handle tasks with no assignees', async () => {
      const task = createClickUpTask({ assignees: [] });
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [task] }),
      );

      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.assignedTo).toBeUndefined();
      }
    });

    it('should include metadata fields', async () => {
      const task = createClickUpTask();
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [task] }),
      );

      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const item = result.value[0]!;
        expect(item.metadata).toHaveProperty('listId', 'list1');
        expect(item.metadata).toHaveProperty('listName', 'Sprint 5');
        expect(item.metadata).toHaveProperty('spaceId', 'space1');
        expect(item.metadata).toHaveProperty('folderId', 'folder1');
        expect(item.metadata).toHaveProperty('folderName', 'Backend');
      }
    });
  });

  describe('getItem', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ team: { id: 'team1', name: 'My Team' } }),
      );
      await provider.initialize({ apiKey: 'pk_test', teamId: 'team1' });
    });

    it('should fetch a single task and return a BacklogItem', async () => {
      const task = createClickUpTask();
      mockFetch.mockResolvedValueOnce(createOkResponse(task));

      const result = await provider.getItem('task123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('task123');
        expect(result.value.title).toBe('Fix login bug');
      }

      const fetchUrl = mockFetch.mock.calls[1]![0] as string;
      expect(fetchUrl).toBe('https://api.clickup.com/api/v2/task/task123');
    });

    it('should return err when task is not found (404)', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(404, 'Not Found'),
      );

      const result = await provider.getItem('nonexistent');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(BacklogError);
        expect(result.error.message).toContain('not found');
        expect(result.error.message).toContain('nonexistent');
      }
    });

    it('should return err on other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(500, 'Internal Server Error'),
      );

      const result = await provider.getItem('task123');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('500');
      }
    });

    it('should return err on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));

      const result = await provider.getItem('task123');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Timeout');
      }
    });
  });

  describe('searchItems', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ team: { id: 'team1', name: 'My Team' } }),
      );
      await provider.initialize({ apiKey: 'pk_test', teamId: 'team1' });
    });

    it('should search tasks by name', async () => {
      const task = createClickUpTask({ name: 'Login fix' });
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [task] }),
      );

      const result = await provider.searchItems('login');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.title).toBe('Login fix');
      }

      const fetchUrl = mockFetch.mock.calls[1]![0] as string;
      expect(fetchUrl).toContain('name=login');
    });

    it('should respect the limit parameter', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createClickUpTask({ id: `task-${i}`, name: `Task ${i}` }),
      );
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks }),
      );

      const result = await provider.searchItems('Task', 2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('should return empty array when nothing matches', async () => {
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ tasks: [] }),
      );

      const result = await provider.searchItems('nonexistent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return err on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(403, 'Forbidden'),
      );

      const result = await provider.searchItems('test');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('403');
      }
    });
  });

  describe('getLinkedCode', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(
        createOkResponse({ team: { id: 'team1', name: 'My Team' } }),
      );
      await provider.initialize({ apiKey: 'pk_test', teamId: 'team1' });
    });

    it('should extract code paths from git-related custom fields', async () => {
      const task = createClickUpTask({
        custom_fields: [
          { id: 'cf1', name: 'GitHub', type: 'url', value: 'https://github.com/org/repo/pull/42' },
          { id: 'cf2', name: 'Branch', type: 'text', value: 'feature/login-fix' },
          { id: 'cf3', name: 'Priority', type: 'number', value: 1 },
        ],
      });
      mockFetch.mockResolvedValueOnce(createOkResponse(task));

      const result = await provider.getLinkedCode('task123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('https://github.com/org/repo/pull/42');
        expect(result.value).toContain('feature/login-fix');
        // Priority should not be included (not a git field name)
        expect(result.value).not.toContain('1');
      }
    });

    it('should extract git URLs from task description', async () => {
      const task = createClickUpTask({
        description: 'Fix this issue. See https://github.com/org/repo/blob/main/src/login.ts for details.',
        custom_fields: [],
      });
      mockFetch.mockResolvedValueOnce(createOkResponse(task));

      const result = await provider.getLinkedCode('task123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain(
          'https://github.com/org/repo/blob/main/src/login.ts',
        );
      }
    });

    it('should return empty array when no code links found', async () => {
      const task = createClickUpTask({
        description: 'No code links here',
        custom_fields: [],
      });
      mockFetch.mockResolvedValueOnce(createOkResponse(task));

      const result = await provider.getLinkedCode('task123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return err when task is not found', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(404, 'Not Found'),
      );

      const result = await provider.getLinkedCode('missing');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(BacklogError);
        expect(result.error.message).toContain('missing');
      }
    });

    it('should return err on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection reset'));

      const result = await provider.getLinkedCode('task123');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Connection reset');
      }
    });
  });

  describe('uninitialized provider', () => {
    it('should throw BacklogError when calling getItems without initialization', async () => {
      await expect(provider.getItems({})).rejects.toThrow(BacklogError);
    });

    it('should throw BacklogError when calling getItem without initialization', async () => {
      await expect(provider.getItem('123')).rejects.toThrow(BacklogError);
    });

    it('should throw BacklogError when calling searchItems without initialization', async () => {
      await expect(provider.searchItems('test')).rejects.toThrow(BacklogError);
    });

    it('should throw BacklogError when calling getLinkedCode without initialization', async () => {
      await expect(provider.getLinkedCode('123')).rejects.toThrow(BacklogError);
    });
  });
});
