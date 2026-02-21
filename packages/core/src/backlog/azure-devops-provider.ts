import { ok, err, type Result } from 'neverthrow';
import { BacklogError } from './backlog-provider.js';
import type { BacklogProvider } from './backlog-provider.js';
import type { BacklogItem, BacklogItemType, BacklogQuery } from './types.js';

/**
 * Configuration for the Azure DevOps backlog provider.
 */
export interface AzureDevOpsConfig {
  organization: string;
  project: string;
  pat: string;
}

/**
 * Maps Azure DevOps work item type names to BacklogItemType values.
 */
const ADO_TYPE_MAP: Record<string, BacklogItemType> = {
  Epic: 'epic',
  'User Story': 'story',
  Task: 'task',
  Bug: 'bug',
  Feature: 'feature',
};

/**
 * Maps BacklogItemType values back to Azure DevOps work item type names.
 */
const BACKLOG_TYPE_TO_ADO: Record<BacklogItemType, string> = {
  epic: 'Epic',
  story: 'User Story',
  task: 'Task',
  bug: 'Bug',
  feature: 'Feature',
};

/** Shape of a single work item returned by the ADO REST API. */
interface AdoWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: Array<{
    rel: string;
    url: string;
    attributes?: Record<string, unknown>;
  }>;
  url: string;
  _links?: Record<string, { href: string }>;
}

/** Shape of the WIQL query response. */
interface WiqlResponse {
  workItems: Array<{ id: number; url: string }>;
}

/**
 * Azure DevOps backlog provider.
 *
 * Implements the BacklogProvider interface to index and query Azure DevOps
 * work items (Epics, User Stories, Tasks, Bugs, Features) via the ADO REST API.
 */
export class AzureDevOpsProvider implements BacklogProvider {
  readonly name = 'azure-devops';

  private config: AzureDevOpsConfig | null = null;
  private baseUrl = '';
  private authHeader = '';

  /**
   * Validates the config and tests the connection by fetching the project info.
   */
  async initialize(
    config: Record<string, unknown>,
  ): Promise<Result<void, BacklogError>> {
    const { organization, project, pat } = config as Record<string, string>;

    if (!organization || typeof organization !== 'string') {
      return err(
        new BacklogError('Azure DevOps config missing required field: organization'),
      );
    }
    if (!project || typeof project !== 'string') {
      return err(
        new BacklogError('Azure DevOps config missing required field: project'),
      );
    }
    if (!pat || typeof pat !== 'string') {
      return err(
        new BacklogError('Azure DevOps config missing required field: pat'),
      );
    }

    this.config = { organization, project, pat };
    this.baseUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}`;
    this.authHeader = `Basic ${btoa(`:${pat}`)}`;

    // Test connection by fetching project info
    try {
      const response = await fetch(
        `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`,
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
            `Azure DevOps connection failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      return ok(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new BacklogError(`Azure DevOps connection failed: ${message}`),
      );
    }
  }

  /**
   * Lists work items matching the given query using WIQL.
   */
  async getItems(
    query: BacklogQuery,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    this.ensureInitialized();

    const conditions: string[] = [];

    if (query.types && query.types.length > 0) {
      const adoTypes = query.types
        .map((t) => BACKLOG_TYPE_TO_ADO[t])
        .filter(Boolean)
        .map((t) => `'${t}'`);
      if (adoTypes.length > 0) {
        conditions.push(
          `[System.WorkItemType] IN (${adoTypes.join(', ')})`,
        );
      }
    }

    if (query.states && query.states.length > 0) {
      const stateValues = query.states.map((s) => `'${s}'`);
      conditions.push(
        `[System.State] IN (${stateValues.join(', ')})`,
      );
    }

    if (query.assignedTo) {
      conditions.push(
        `[System.AssignedTo] = '${query.assignedTo}'`,
      );
    }

    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        conditions.push(`[System.Tags] CONTAINS '${tag}'`);
      }
    }

    if (query.text) {
      conditions.push(
        `[System.Title] CONTAINS '${query.text}'`,
      );
    }

    const whereClause =
      conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const wiql = `SELECT [System.Id] FROM WorkItems${whereClause} ORDER BY [System.ChangedDate] DESC`;

    return this.executeWiqlAndFetchItems(wiql, query.limit);
  }

  /**
   * Fetches a single work item by its numeric ID.
   */
  async getItem(id: string): Promise<Result<BacklogItem, BacklogError>> {
    this.ensureInitialized();

    try {
      const response = await fetch(
        `${this.baseUrl}/_apis/wit/workitems/${encodeURIComponent(id)}?$expand=relations&api-version=7.1`,
        {
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          return err(new BacklogError(`Work item not found: ${id}`));
        }
        return err(
          new BacklogError(
            `Failed to fetch work item ${id}: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const workItem = (await response.json()) as AdoWorkItem;
      return ok(this.mapWorkItem(workItem));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new BacklogError(`Failed to fetch work item ${id}: ${message}`),
      );
    }
  }

  /**
   * Searches work items by title and description using WIQL.
   */
  async searchItems(
    text: string,
    limit?: number,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    this.ensureInitialized();

    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '${text}' OR [System.Description] CONTAINS '${text}' ORDER BY [System.ChangedDate] DESC`;

    return this.executeWiqlAndFetchItems(wiql, limit);
  }

  /**
   * Returns code file paths linked to the specified work item via relations
   * (commits, pull requests, versioned items, etc.).
   */
  async getLinkedCode(
    itemId: string,
  ): Promise<Result<string[], BacklogError>> {
    this.ensureInitialized();

    try {
      const response = await fetch(
        `${this.baseUrl}/_apis/wit/workitems/${encodeURIComponent(itemId)}?$expand=relations&api-version=7.1`,
        {
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          return err(new BacklogError(`Work item not found: ${itemId}`));
        }
        return err(
          new BacklogError(
            `Failed to fetch work item ${itemId}: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const workItem = (await response.json()) as AdoWorkItem;
      const codePaths = this.extractCodePaths(workItem);

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
        'AzureDevOpsProvider has not been initialized. Call initialize() first.',
      );
    }
  }

  /**
   * Executes a WIQL query and fetches the resulting work items in a batch.
   */
  private async executeWiqlAndFetchItems(
    wiql: string,
    limit?: number,
  ): Promise<Result<BacklogItem[], BacklogError>> {
    try {
      // Step 1: Execute WIQL query to get work item IDs
      const wiqlResponse = await fetch(
        `${this.baseUrl}/_apis/wit/wiql?api-version=7.1`,
        {
          method: 'POST',
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: wiql }),
        },
      );

      if (!wiqlResponse.ok) {
        return err(
          new BacklogError(
            `WIQL query failed: ${wiqlResponse.status} ${wiqlResponse.statusText}`,
          ),
        );
      }

      const wiqlResult = (await wiqlResponse.json()) as WiqlResponse;
      let ids = wiqlResult.workItems.map((wi) => wi.id);

      // Apply limit
      if (limit !== undefined && limit > 0) {
        ids = ids.slice(0, limit);
      }

      if (ids.length === 0) {
        return ok([]);
      }

      // Step 2: Batch-fetch the work items by IDs
      const batchResponse = await fetch(
        `${this.baseUrl}/_apis/wit/workitems?ids=${ids.join(',')}&$expand=relations&api-version=7.1`,
        {
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!batchResponse.ok) {
        return err(
          new BacklogError(
            `Batch fetch failed: ${batchResponse.status} ${batchResponse.statusText}`,
          ),
        );
      }

      const batchResult = (await batchResponse.json()) as {
        value: AdoWorkItem[];
      };
      const items = batchResult.value.map((wi) => this.mapWorkItem(wi));

      return ok(items);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new BacklogError(`Azure DevOps query failed: ${message}`));
    }
  }

  /**
   * Maps a raw Azure DevOps work item to a BacklogItem.
   */
  private mapWorkItem(workItem: AdoWorkItem): BacklogItem {
    const fields = workItem.fields;
    const typeName = (fields['System.WorkItemType'] as string) ?? '';
    const mappedType: BacklogItemType = ADO_TYPE_MAP[typeName] ?? 'task';

    const tags = (fields['System.Tags'] as string | undefined)
      ?.split(';')
      .map((t) => t.trim())
      .filter(Boolean) ?? [];

    const assignedTo =
      (fields['System.AssignedTo'] as { displayName?: string; uniqueName?: string } | undefined)
        ?.displayName ??
      (fields['System.AssignedTo'] as string | undefined) ??
      undefined;

    const organization = this.config!.organization;
    const project = this.config!.project;

    return {
      id: String(workItem.id),
      externalId: `AB#${workItem.id}`,
      title: (fields['System.Title'] as string) ?? '',
      description: (fields['System.Description'] as string) ?? '',
      type: mappedType,
      state: (fields['System.State'] as string) ?? '',
      assignedTo,
      tags,
      linkedCodePaths: this.extractCodePaths(workItem),
      url: `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_workitems/edit/${workItem.id}`,
      metadata: {
        iterationPath: fields['System.IterationPath'],
        areaPath: fields['System.AreaPath'],
        priority: fields['Microsoft.VSTS.Common.Priority'],
        workItemType: typeName,
      },
    };
  }

  /**
   * Extracts file paths from work item relations that point to code
   * (commits, versioned items, pull requests).
   */
  private extractCodePaths(workItem: AdoWorkItem): string[] {
    if (!workItem.relations || workItem.relations.length === 0) {
      return [];
    }

    const codeRelTypes = new Set([
      'ArtifactLink',
      'Fixed in Commit',
      'Fixed in Changeset',
    ]);

    const paths: string[] = [];

    for (const relation of workItem.relations) {
      // Include versioned item links and artifact links that point to code
      if (
        codeRelTypes.has(relation.rel) ||
        relation.url.includes('/git/') ||
        relation.url.includes('/commits/') ||
        relation.url.includes('/pullRequests/')
      ) {
        // Extract meaningful path from the relation URL
        const name =
          (relation.attributes?.['name'] as string) ??
          (relation.attributes?.['comment'] as string) ??
          relation.url;
        paths.push(name);
      }
    }

    return paths;
  }
}
