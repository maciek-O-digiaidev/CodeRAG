import type { Result } from 'neverthrow';
import type { BacklogItem, BacklogQuery } from './types.js';

export class BacklogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BacklogError';
  }
}

export interface BacklogProvider {
  readonly name: string; // e.g., 'azure-devops', 'jira', 'clickup'
  initialize(config: Record<string, unknown>): Promise<Result<void, BacklogError>>;
  getItems(query: BacklogQuery): Promise<Result<BacklogItem[], BacklogError>>;
  getItem(id: string): Promise<Result<BacklogItem, BacklogError>>;
  searchItems(text: string, limit?: number): Promise<Result<BacklogItem[], BacklogError>>;
  getLinkedCode(itemId: string): Promise<Result<string[], BacklogError>>;
}
