import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JiraProvider } from './jira-provider.js';
import { BacklogError } from './backlog-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockResponse(
  body: unknown,
  status = 200,
  statusText = 'OK',
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: () => createMockResponse(body, status, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

function createJiraIssue(overrides?: Record<string, unknown>) {
  return {
    id: '10001',
    key: 'PROJ-123',
    self: 'https://mycompany.atlassian.net/rest/api/3/issue/10001',
    fields: {
      summary: 'Fix login bug',
      description: 'Users cannot log in when using SSO',
      issuetype: { name: 'Bug' },
      status: { name: 'In Progress' },
      assignee: {
        displayName: 'Jane Developer',
        emailAddress: 'jane@example.com',
      },
      labels: ['auth', 'sso'],
      issuelinks: [
        {
          type: {
            name: 'Relates',
            inward: 'is related to',
            outward: 'relates to',
          },
          outwardIssue: {
            key: 'PROJ-100',
            fields: { summary: 'Auth refactor' },
          },
        },
      ],
      ...(overrides ?? {}),
    },
  };
}

const VALID_CONFIG = {
  host: 'https://mycompany.atlassian.net',
  email: 'user@example.com',
  apiToken: 'test-token-123',
  project: 'PROJ',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JiraProvider', () => {
  let provider: JiraProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new JiraProvider();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- name ---

  it('should have name set to jira', () => {
    expect(provider.name).toBe('jira');
  });

  // --- initialize ---

  describe('initialize', () => {
    it('should return ok on successful connection', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ accountId: '12345', displayName: 'Test User' }),
      );

      const result = await provider.initialize(VALID_CONFIG);
      expect(result.isOk()).toBe(true);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0]![0]).toContain('/rest/api/3/myself');
    });

    it('should return err when host is missing', async () => {
      const result = await provider.initialize({
        email: 'user@example.com',
        apiToken: 'token',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(BacklogError);
        expect(result.error.message).toContain('host');
      }
    });

    it('should return err when email is missing', async () => {
      const result = await provider.initialize({
        host: 'https://mycompany.atlassian.net',
        apiToken: 'token',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('email');
      }
    });

    it('should return err when apiToken is missing', async () => {
      const result = await provider.initialize({
        host: 'https://mycompany.atlassian.net',
        email: 'user@example.com',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('apiToken');
      }
    });

    it('should return err when connection fails with HTTP error', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ message: 'Unauthorized' }, 401, 'Unauthorized'),
      );

      const result = await provider.initialize(VALID_CONFIG);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('401');
      }
    });

    it('should return err when connection throws a network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await provider.initialize(VALID_CONFIG);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('ECONNREFUSED');
      }
    });

    it('should send correct authorization header', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ accountId: '12345' }),
      );

      await provider.initialize(VALID_CONFIG);

      const callHeaders = fetchSpy.mock.calls[0]![1]?.headers as Record<
        string,
        string
      >;
      const expectedAuth = `Basic ${btoa(`${VALID_CONFIG.email}:${VALID_CONFIG.apiToken}`)}`;
      expect(callHeaders['Authorization']).toBe(expectedAuth);
    });

    it('should normalize host without protocol by prepending https', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ accountId: '12345' }),
      );

      await provider.initialize({
        ...VALID_CONFIG,
        host: 'mycompany.atlassian.net',
      });

      expect(fetchSpy.mock.calls[0]![0]).toContain(
        'https://mycompany.atlassian.net/rest/api/3/myself',
      );
    });

    it('should strip trailing slashes from host', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ accountId: '12345' }),
      );

      await provider.initialize({
        ...VALID_CONFIG,
        host: 'https://mycompany.atlassian.net/',
      });

      expect(fetchSpy.mock.calls[0]![0]).toBe(
        'https://mycompany.atlassian.net/rest/api/3/myself',
      );
    });
  });

  // --- getItems ---

  describe('getItems', () => {
    beforeEach(async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ accountId: '12345' }),
      );
      await provider.initialize(VALID_CONFIG);
    });

    it('should build JQL from query types', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      await provider.getItems({ types: ['bug', 'story'] });

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('issuetype');
      expect(url).toContain('Bug');
      expect(url).toContain('Story');
    });

    it('should build JQL from query states', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      await provider.getItems({ states: ['In Progress', 'Done'] });

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('status');
      expect(url).toContain('In+Progress');
    });

    it('should build JQL from query assignedTo', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      await provider.getItems({ assignedTo: 'jane@example.com' });

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('assignee');
    });

    it('should build JQL from query tags', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      await provider.getItems({ tags: ['auth'] });

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('labels');
      expect(url).toContain('auth');
    });

    it('should build JQL from query text', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      await provider.getItems({ text: 'login' });

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('summary');
      expect(url).toContain('description');
      expect(url).toContain('login');
    });

    it('should scope JQL to project when configured', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      await provider.getItems({});

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('project');
      expect(url).toContain('PROJ');
    });

    it('should map response issues to BacklogItems', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          issues: [createJiraIssue()],
          total: 1,
        }),
      );

      const result = await provider.getItems({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        const item = result.value[0]!;
        expect(item.id).toBe('10001');
        expect(item.externalId).toBe('PROJ-123');
        expect(item.title).toBe('Fix login bug');
        expect(item.description).toBe('Users cannot log in when using SSO');
        expect(item.type).toBe('bug');
        expect(item.state).toBe('In Progress');
        expect(item.assignedTo).toBe('Jane Developer');
        expect(item.tags).toEqual(['auth', 'sso']);
        expect(item.url).toContain('/browse/PROJ-123');
      }
    });

    it('should respect the limit parameter', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      await provider.getItems({ limit: 5 });

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('maxResults=5');
    });

    it('should return err on API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ message: 'Bad Request' }, 400, 'Bad Request'),
      );

      const result = await provider.getItems({});
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(BacklogError);
        expect(result.error.message).toContain('400');
      }
    });

    it('should return err on network failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.getItems({});
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Network error');
      }
    });

    it('should return empty array when no issues match', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      const result = await provider.getItems({ text: 'nonexistent' });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  // --- getItem ---

  describe('getItem', () => {
    beforeEach(async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ accountId: '12345' }),
      );
      await provider.initialize(VALID_CONFIG);
    });

    it('should fetch and map a single issue', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createJiraIssue()),
      );

      const result = await provider.getItem('PROJ-123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.externalId).toBe('PROJ-123');
        expect(result.value.title).toBe('Fix login bug');
        expect(result.value.type).toBe('bug');
      }
    });

    it('should return err when issue is not found (404)', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(
          { errorMessages: ['Issue does not exist'] },
          404,
          'Not Found',
        ),
      );

      const result = await provider.getItem('PROJ-999');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(BacklogError);
        expect(result.error.message).toContain('not found');
        expect(result.error.message).toContain('PROJ-999');
      }
    });

    it('should return err on non-404 HTTP error', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ message: 'Forbidden' }, 403, 'Forbidden'),
      );

      const result = await provider.getItem('PROJ-123');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('403');
      }
    });

    it('should return err on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection reset'));

      const result = await provider.getItem('PROJ-123');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Connection reset');
      }
    });

    it('should handle issue with null assignee', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createJiraIssue({ assignee: null })),
      );

      const result = await provider.getItem('PROJ-123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.assignedTo).toBeUndefined();
      }
    });

    it('should handle issue with null description', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createJiraIssue({ description: null })),
      );

      const result = await provider.getItem('PROJ-123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.description).toBe('');
      }
    });

    it('should map unknown issue type to task', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(
          createJiraIssue({ issuetype: { name: 'Custom Type' } }),
        ),
      );

      const result = await provider.getItem('PROJ-123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.type).toBe('task');
      }
    });
  });

  // --- searchItems ---

  describe('searchItems', () => {
    beforeEach(async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ accountId: '12345' }),
      );
      await provider.initialize(VALID_CONFIG);
    });

    it('should search with JQL text query', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          issues: [createJiraIssue()],
          total: 1,
        }),
      );

      const result = await provider.searchItems('login');

      expect(result.isOk()).toBe(true);
      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('summary');
      expect(url).toContain('description');
      expect(url).toContain('login');
    });

    it('should respect the limit parameter', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      await provider.searchItems('test', 3);

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('maxResults=3');
    });

    it('should scope search to project', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ issues: [], total: 0 }),
      );

      await provider.searchItems('test');

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('project');
      expect(url).toContain('PROJ');
    });

    it('should return err on API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({}, 500, 'Internal Server Error'),
      );

      const result = await provider.searchItems('test');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('500');
      }
    });
  });

  // --- getLinkedCode ---

  describe('getLinkedCode', () => {
    beforeEach(async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ accountId: '12345' }),
      );
      await provider.initialize(VALID_CONFIG);
    });

    it('should extract linked issue keys as code references', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createJiraIssue()),
      );

      const result = await provider.getLinkedCode('PROJ-123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('PROJ-100');
      }
    });

    it('should return empty array when no links exist', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createJiraIssue({ issuelinks: [] })),
      );

      const result = await provider.getLinkedCode('PROJ-123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return err when issue is not found', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({}, 404, 'Not Found'),
      );

      const result = await provider.getLinkedCode('PROJ-999');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('should return err on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Timeout'));

      const result = await provider.getLinkedCode('PROJ-123');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Timeout');
      }
    });

    it('should handle inward issue links', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(
          createJiraIssue({
            issuelinks: [
              {
                type: {
                  name: 'Blocks',
                  inward: 'is blocked by',
                  outward: 'blocks',
                },
                inwardIssue: {
                  key: 'PROJ-200',
                  fields: { summary: 'Blocking issue' },
                },
              },
            ],
          }),
        ),
      );

      const result = await provider.getLinkedCode('PROJ-123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('PROJ-200');
      }
    });
  });

  // --- Error when not initialized ---

  describe('when not initialized', () => {
    it('should throw BacklogError from getItems', async () => {
      await expect(provider.getItems({})).rejects.toThrow(BacklogError);
    });

    it('should throw BacklogError from getItem', async () => {
      await expect(provider.getItem('PROJ-1')).rejects.toThrow(BacklogError);
    });

    it('should throw BacklogError from searchItems', async () => {
      await expect(provider.searchItems('test')).rejects.toThrow(
        BacklogError,
      );
    });

    it('should throw BacklogError from getLinkedCode', async () => {
      await expect(provider.getLinkedCode('PROJ-1')).rejects.toThrow(
        BacklogError,
      );
    });
  });
});
