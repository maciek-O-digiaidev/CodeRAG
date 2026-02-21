export type BacklogItemType = 'epic' | 'story' | 'task' | 'bug' | 'feature';

export interface BacklogItem {
  id: string;
  externalId: string; // Provider-specific ID (e.g., "AB#123", "PROJ-456")
  title: string;
  description: string;
  type: BacklogItemType;
  state: string; // e.g., "New", "Active", "Resolved", "Closed"
  assignedTo?: string;
  tags: string[];
  linkedCodePaths: string[]; // File paths linked to this item
  url?: string; // Web URL to view the item
  metadata: Record<string, unknown>; // Provider-specific metadata
}

export interface BacklogQuery {
  text?: string;
  types?: BacklogItemType[];
  states?: string[];
  assignedTo?: string;
  tags?: string[];
  limit?: number;
}
