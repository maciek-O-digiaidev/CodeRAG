import { ok, err, type Result } from 'neverthrow';
import { BacklogError } from './backlog-provider.js';
import type { BacklogProvider } from './backlog-provider.js';
import type { BacklogItem, BacklogItemType, BacklogQuery } from './types.js';

/**
 * Configuration for the Jira backlog provider.
 */
export interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  project?: string;
}

/**
 * Maps Jira issue type names to BacklogItemType values.
 */
const JIRA_TYPE_MAP: Record<string, BacklogItemType> = {
  Epic: 'epic',
  Story: 'story',
  Task: 'task',
  Bug: 'bug',
  'Sub-task': 'task',
  Subtask: 'task',
  Feature: 'feature',
};

/**
 * Maps BacklogItemType values back to Jira issue type names.
 */
const BACKLOG_TYPE_TO_JIRA: Record<BacklogItemType, string[]> = {
  epic: ['Epic'],
  story: ['Story'],
  task: ['Task', 'Sub-task'],
  bug: ['Bug'],
  feature: ['Feature'],
};

/** Shape of a single issue returned by the Jira REST API. */
interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: string | null;
    issuetype: { name: string };
    status: { name: string };
    assignee?: { displayName?: string; emailAddress?: string } | null;
    labels?: string[];
    issuelinks?: Array<{
      type: { name: string; inward: string; outward: string };
      inwardIssue?: { key: string; fields?: { summary?: string } };
      outwardIssue?: { key: string; fields?: { summary?: string } };
    }>;
    [key: string]: unknown;
  };
}

/** Shape of the Jira search response. */
interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
}

/**
 * Jira backlog provider.
 *
 * Implements the BacklogProvider interface to index and query Jira
 * issues (Epics, Stories, Tasks, Bugs, Sub-tasks) via the Jira REST API v3.
 */
export class JiraProvider implements BacklogProvider {
  readonly name = 'jira';

  private config: JiraConfig | null = null;
  private baseUrl = '';
  private authHeader = '';

  /**
   * Validates the config and tests the connection by fetching /rest/api/3/myself.
   */
  async initialize(
    config: Record<string, unknown>,
  ): Promise<Result<void, BacklogError>> {
    const { host, email, apiToken, project } = config as Record<
      string,
      string | undefined
    >;

    if (!host || typeof host !== 'string') {
      return err(
        new BacklogError('Jira config missing required field: host'),
      );
    }
    if (!email || typeof email !== 'string') {
      return err(
        new BacklogError('Jira config missing required field: email'),
      );
    }
    if (!apiToken || typeof apiToken !== 'string') {
      return err(
        new BacklogError('Jira config missing required field: apiToken'),
      );
    }

    // Normalize host: strip trailing slash, ensure https://
    let normalizedHost = host.replace(/\/+$/, '');
    if (
      !normalizedHost.startsWith('https://') &&
      !normalizedHost.startsWith('http://')
    ) {
      normalizedHost = `https://${normalizedHost}`;
    }

    this.config = {
      host: normalizedHost,
      email,
      apiToken,
      project: project ?? undefined,
    };
    this.baseUrl = `${normalizedHost}/rest/api/3`;
    this.authHeader = `Basic ${btoa(`${email}:${apiToken}`)}`;

    // Test connection by fetching current user
    try {
      const response = await fetch(`${this.baseUrl}/myself`, {
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return err(
          new BacklogError(
            `Jira connection failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      return ok(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new BacklogError(`Jira connection failed: ${message}`),
      );
    }
  }

  /**
   * Lists issues matching the given query using JQL search.
   */
  async getItems(
    query: BacklogQuery,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    this.ensureInitialized();

    const conditions: string[] = [];

    // Scope to project if configured
    if (this.config!.project) {
      conditions.push(`project = "${this.config!.project}"`);
    }

    if (query.types && query.types.length > 0) {
      const jiraTypes = query.types
        .flatMap((t) => BACKLOG_TYPE_TO_JIRA[t] ?? [])
        .filter(Boolean)
        .map((t) => `"${t}"`);
      if (jiraTypes.length > 0) {
        conditions.push(`issuetype IN (${jiraTypes.join(', ')})`);
      }
    }

    if (query.states && query.states.length > 0) {
      const stateValues = query.states.map((s) => `"${s}"`);
      conditions.push(`status IN (${stateValues.join(', ')})`);
    }

    if (query.assignedTo) {
      conditions.push(`assignee = "${query.assignedTo}"`);
    }

    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        conditions.push(`labels = "${tag}"`);
      }
    }

    if (query.text) {
      conditions.push(
        `(summary ~ "${query.text}" OR description ~ "${query.text}")`,
      );
    }

    const jql =
      conditions.length > 0
        ? conditions.join(' AND ')
        : 'ORDER BY updated DESC';
    const orderSuffix = conditions.length > 0 ? ' ORDER BY updated DESC' : '';

    return this.executeJqlSearch(`${jql}${orderSuffix}`, query.limit);
  }

  /**
   * Fetches a single issue by its key or ID.
   */
  async getItem(id: string): Promise<Result<BacklogItem, BacklogError>> {
    this.ensureInitialized();

    try {
      const response = await fetch(
        `${this.baseUrl}/issue/${encodeURIComponent(id)}`,
        {
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          return err(new BacklogError(`Jira issue not found: ${id}`));
        }
        return err(
          new BacklogError(
            `Failed to fetch Jira issue ${id}: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const issue = (await response.json()) as JiraIssue;
      return ok(this.mapIssue(issue));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new BacklogError(`Failed to fetch Jira issue ${id}: ${message}`),
      );
    }
  }

  /**
   * Searches issues by summary and description using JQL.
   */
  async searchItems(
    text: string,
    limit?: number,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    this.ensureInitialized();

    const conditions: string[] = [];

    if (this.config!.project) {
      conditions.push(`project = "${this.config!.project}"`);
    }

    conditions.push(
      `(summary ~ "${text}" OR description ~ "${text}")`,
    );

    const jql = `${conditions.join(' AND ')} ORDER BY updated DESC`;

    return this.executeJqlSearch(jql, limit);
  }

  /**
   * Returns code references linked to the specified Jira issue
   * (via issue links, development information, etc.).
   */
  async getLinkedCode(
    itemId: string,
  ): Promise<Result<string[], BacklogError>> {
    this.ensureInitialized();

    try {
      const response = await fetch(
        `${this.baseUrl}/issue/${encodeURIComponent(itemId)}`,
        {
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          return err(new BacklogError(`Jira issue not found: ${itemId}`));
        }
        return err(
          new BacklogError(
            `Failed to fetch Jira issue ${itemId}: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const issue = (await response.json()) as JiraIssue;
      const codeRefs = this.extractCodeReferences(issue);

      return ok(codeRefs);
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
        'JiraProvider has not been initialized. Call initialize() first.',
      );
    }
  }

  /**
   * Executes a JQL search query and returns the resulting issues mapped to BacklogItems.
   */
  private async executeJqlSearch(
    jql: string,
    limit?: number,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    try {
      const maxResults = limit !== undefined && limit > 0 ? limit : 50;
      const params = new URLSearchParams({
        jql,
        maxResults: String(maxResults),
        fields:
          'summary,description,issuetype,status,assignee,labels,issuelinks',
      });

      const response = await fetch(
        `${this.baseUrl}/search?${params.toString()}`,
        {
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        return err(
          new BacklogError(
            `JQL query failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const searchResult = (await response.json()) as JiraSearchResponse;
      const items = searchResult.issues.map((issue) => this.mapIssue(issue));

      return ok(items);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new BacklogError(`Jira query failed: ${message}`));
    }
  }

  /**
   * Maps a raw Jira issue to a BacklogItem.
   */
  private mapIssue(issue: JiraIssue): BacklogItem {
    const fields = issue.fields;
    const typeName = fields.issuetype.name;
    const mappedType: BacklogItemType = JIRA_TYPE_MAP[typeName] ?? 'task';

    const tags = fields.labels ?? [];

    const assignedTo =
      fields.assignee?.displayName ??
      fields.assignee?.emailAddress ??
      undefined;

    return {
      id: issue.id,
      externalId: issue.key,
      title: fields.summary,
      description: fields.description ?? '',
      type: mappedType,
      state: fields.status.name,
      assignedTo,
      tags,
      linkedCodePaths: this.extractCodeReferences(issue),
      url: `${this.config!.host}/browse/${issue.key}`,
      metadata: {
        issueType: typeName,
        self: issue.self,
      },
    };
  }

  /**
   * Extracts code references from Jira issue links.
   * Looks for issue links that may reference branches, commits, or pull requests.
   */
  private extractCodeReferences(issue: JiraIssue): string[] {
    const refs: string[] = [];

    if (!issue.fields.issuelinks || issue.fields.issuelinks.length === 0) {
      return refs;
    }

    for (const link of issue.fields.issuelinks) {
      // Include linked issue keys as potential code references
      const linkedKey =
        link.outwardIssue?.key ?? link.inwardIssue?.key;
      if (linkedKey) {
        refs.push(linkedKey);
      }
    }

    return refs;
  }
}
