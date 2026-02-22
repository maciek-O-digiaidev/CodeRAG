import { ok, err, type Result } from 'neverthrow';
import { BacklogError } from './backlog-provider.js';
import type { BacklogProvider } from './backlog-provider.js';
import type { BacklogItem, BacklogItemType, BacklogQuery } from './types.js';

/**
 * Configuration for the ClickUp backlog provider.
 */
export interface ClickUpConfig {
  apiKey: string;
  teamId: string;
  spaceIds?: string[];
}

/**
 * Maps ClickUp task type names to BacklogItemType values.
 */
const CLICKUP_TYPE_MAP: Record<string, BacklogItemType> = {
  task: 'task',
  milestone: 'epic',
  epic: 'epic',
  bug: 'bug',
  feature: 'feature',
  story: 'story',
};

/**
 * Maps BacklogItemType values to ClickUp task type names.
 */
const BACKLOG_TYPE_TO_CLICKUP: Record<BacklogItemType, string> = {
  epic: 'epic',
  story: 'story',
  task: 'task',
  bug: 'bug',
  feature: 'feature',
};

const CLICKUP_BASE_URL = 'https://api.clickup.com';

/** Shape of a single task returned by the ClickUp API. */
interface ClickUpTask {
  id: string;
  custom_id?: string | null;
  name: string;
  description?: string;
  status: {
    status: string;
    type: string;
  };
  assignees: Array<{
    id: number;
    username: string;
    email?: string;
  }>;
  tags: Array<{
    name: string;
  }>;
  custom_fields?: Array<{
    id: string;
    name: string;
    type: string;
    value?: unknown;
  }>;
  url: string;
  list?: {
    id: string;
    name: string;
  };
  space?: {
    id: string;
  };
  folder?: {
    id: string;
    name: string;
  };
  type?: string;
}

/** Shape of the ClickUp tasks response. */
interface ClickUpTasksResponse {
  tasks: ClickUpTask[];
}

/**
 * ClickUp backlog provider.
 *
 * Implements the BacklogProvider interface to index and query ClickUp
 * tasks, lists, and spaces via the ClickUp REST API v2.
 */
export class ClickUpProvider implements BacklogProvider {
  readonly name = 'clickup';

  private config: ClickUpConfig | null = null;
  private authHeader = '';

  /**
   * Validates the config and tests the connection by fetching the team info.
   */
  async initialize(
    config: Record<string, unknown>,
  ): Promise<Result<void, BacklogError>> {
    const { apiKey, teamId, spaceIds } = config as Record<string, unknown>;

    if (!apiKey || typeof apiKey !== 'string') {
      return err(
        new BacklogError('ClickUp config missing required field: apiKey'),
      );
    }
    if (!teamId || typeof teamId !== 'string') {
      return err(
        new BacklogError('ClickUp config missing required field: teamId'),
      );
    }

    this.config = {
      apiKey: apiKey as string,
      teamId: teamId as string,
      spaceIds: spaceIds as string[] | undefined,
    };
    this.authHeader = apiKey as string;

    // Test connection by fetching team info
    try {
      const response = await fetch(
        `${CLICKUP_BASE_URL}/api/v2/team/${encodeURIComponent(this.config.teamId)}`,
        {
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        return err(
          new BacklogError(
            `ClickUp connection failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      return ok(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new BacklogError(`ClickUp connection failed: ${message}`),
      );
    }
  }

  /**
   * Lists tasks matching the given query using the ClickUp API.
   */
  async getItems(
    query: BacklogQuery,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    this.ensureInitialized();

    try {
      const params = new URLSearchParams();

      if (query.types && query.types.length > 0) {
        const clickUpTypes = query.types
          .map((t) => BACKLOG_TYPE_TO_CLICKUP[t])
          .filter(Boolean);
        if (clickUpTypes.length > 0) {
          for (const type of clickUpTypes) {
            params.append('type', type);
          }
        }
      }

      if (query.states && query.states.length > 0) {
        for (const state of query.states) {
          params.append('statuses[]', state);
        }
      }

      if (query.assignedTo) {
        params.append('assignees[]', query.assignedTo);
      }

      if (query.tags && query.tags.length > 0) {
        for (const tag of query.tags) {
          params.append('tags[]', tag);
        }
      }

      if (query.text) {
        params.append('name', query.text);
      }

      if (query.limit !== undefined && query.limit > 0) {
        params.append('page_size', String(query.limit));
      }

      const queryString = params.toString();
      const url = `${CLICKUP_BASE_URL}/api/v2/team/${encodeURIComponent(this.config!.teamId)}/task${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return err(
          new BacklogError(
            `ClickUp query failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const result = (await response.json()) as ClickUpTasksResponse;
      let items = result.tasks.map((task) => this.mapTask(task));

      // Apply limit if page_size was not enough
      if (query.limit !== undefined && query.limit > 0) {
        items = items.slice(0, query.limit);
      }

      return ok(items);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new BacklogError(`ClickUp query failed: ${message}`));
    }
  }

  /**
   * Fetches a single task by its ID.
   */
  async getItem(id: string): Promise<Result<BacklogItem, BacklogError>> {
    this.ensureInitialized();

    try {
      const response = await fetch(
        `${CLICKUP_BASE_URL}/api/v2/task/${encodeURIComponent(id)}`,
        {
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          return err(new BacklogError(`Task not found: ${id}`));
        }
        return err(
          new BacklogError(
            `Failed to fetch task ${id}: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const task = (await response.json()) as ClickUpTask;
      return ok(this.mapTask(task));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new BacklogError(`Failed to fetch task ${id}: ${message}`),
      );
    }
  }

  /**
   * Searches tasks by name using the ClickUp API.
   */
  async searchItems(
    text: string,
    limit?: number,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    this.ensureInitialized();

    try {
      const params = new URLSearchParams();
      params.append('name', text);

      if (limit !== undefined && limit > 0) {
        params.append('page_size', String(limit));
      }

      const response = await fetch(
        `${CLICKUP_BASE_URL}/api/v2/team/${encodeURIComponent(this.config!.teamId)}/task?${params.toString()}`,
        {
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        return err(
          new BacklogError(
            `ClickUp search failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const result = (await response.json()) as ClickUpTasksResponse;
      let items = result.tasks.map((task) => this.mapTask(task));

      if (limit !== undefined && limit > 0) {
        items = items.slice(0, limit);
      }

      return ok(items);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new BacklogError(`ClickUp search failed: ${message}`));
    }
  }

  /**
   * Returns code file paths linked to the specified task via custom fields
   * or task description links.
   */
  async getLinkedCode(
    itemId: string,
  ): Promise<Result<string[], BacklogError>> {
    this.ensureInitialized();

    try {
      const response = await fetch(
        `${CLICKUP_BASE_URL}/api/v2/task/${encodeURIComponent(itemId)}`,
        {
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          return err(new BacklogError(`Task not found: ${itemId}`));
        }
        return err(
          new BacklogError(
            `Failed to fetch task ${itemId}: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const task = (await response.json()) as ClickUpTask;
      const codePaths = this.extractCodePaths(task);

      return ok(codePaths);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new BacklogError(
          `Failed to fetch linked code for ${itemId}: ${message}`,
        ),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.config) {
      throw new BacklogError(
        'ClickUpProvider has not been initialized. Call initialize() first.',
      );
    }
  }

  /**
   * Maps a raw ClickUp task to a BacklogItem.
   */
  private mapTask(task: ClickUpTask): BacklogItem {
    const statusType = task.status?.type ?? '';
    const taskType = task.type ?? statusType;
    const mappedType: BacklogItemType =
      CLICKUP_TYPE_MAP[taskType.toLowerCase()] ?? 'task';

    const tags = task.tags.map((t) => t.name);

    const assignedTo =
      task.assignees.length > 0
        ? task.assignees[0]!.username
        : undefined;

    return {
      id: task.id,
      externalId: task.custom_id ?? `CU-${task.id}`,
      title: task.name,
      description: task.description ?? '',
      type: mappedType,
      state: task.status?.status ?? '',
      assignedTo,
      tags,
      linkedCodePaths: this.extractCodePaths(task),
      url: task.url,
      metadata: {
        listId: task.list?.id,
        listName: task.list?.name,
        spaceId: task.space?.id,
        folderId: task.folder?.id,
        folderName: task.folder?.name,
        customFields: task.custom_fields,
        statusType: task.status?.type,
      },
    };
  }

  /**
   * Extracts code paths from task custom fields and description.
   * Looks for custom fields with git-related names or URL values
   * pointing to code repositories.
   */
  private extractCodePaths(task: ClickUpTask): string[] {
    const paths: string[] = [];

    // Extract from custom fields that contain git/code references
    if (task.custom_fields) {
      const gitFieldNames = new Set([
        'git',
        'github',
        'gitlab',
        'bitbucket',
        'repository',
        'repo',
        'branch',
        'commit',
        'pull request',
        'pr',
        'code',
        'file',
        'path',
      ]);

      for (const field of task.custom_fields) {
        const fieldNameLower = field.name.toLowerCase();
        if (gitFieldNames.has(fieldNameLower) && field.value) {
          const value = String(field.value);
          if (value.trim().length > 0) {
            paths.push(value);
          }
        }
      }
    }

    // Extract git URLs from description
    if (task.description) {
      const gitUrlPattern =
        /https?:\/\/(?:github|gitlab|bitbucket)\.(?:com|org)\/[^\s)]+/g;
      let match: RegExpExecArray | null;

      while ((match = gitUrlPattern.exec(task.description)) !== null) {
        paths.push(match[0]!);
      }
    }

    return paths;
  }
}
