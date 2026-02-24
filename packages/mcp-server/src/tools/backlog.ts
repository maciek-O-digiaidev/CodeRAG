import { z } from 'zod';
import type { BacklogProvider, BacklogItem, BacklogItemType } from '@code-rag/core';

const backlogItemTypes: [BacklogItemType, ...BacklogItemType[]] = [
  'epic',
  'story',
  'task',
  'bug',
  'feature',
];

export const backlogInputSchema = z.object({
  action: z.enum(['search', 'get', 'list']),
  query: z.string().optional(),
  id: z.string().optional(),
  types: z.array(z.enum(backlogItemTypes)).optional(),
  states: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional().default(10),
});

export type BacklogInput = z.infer<typeof backlogInputSchema>;

interface BacklogItemResult {
  id: string;
  externalId: string;
  title: string;
  type: BacklogItemType;
  state: string;
  tags: string[];
  url?: string;
  linkedCodePaths?: string[];
}

function formatItem(item: BacklogItem, includeCodePaths = false): BacklogItemResult {
  const result: BacklogItemResult = {
    id: item.id,
    externalId: item.externalId,
    title: item.title,
    type: item.type,
    state: item.state,
    tags: item.tags,
    url: item.url,
  };

  if (includeCodePaths && item.linkedCodePaths.length > 0) {
    result.linkedCodePaths = item.linkedCodePaths;
  }

  return result;
}

export async function handleBacklog(
  args: Record<string, unknown>,
  backlogProvider: BacklogProvider | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = backlogInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Invalid input',
            details: parsed.error.issues,
          }),
        },
      ],
    };
  }

  if (!backlogProvider) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            items: [],
            message: 'Backlog provider not initialized.',
          }),
        },
      ],
    };
  }

  const { action, query, id, types, states, tags, limit } = parsed.data;

  try {
    switch (action) {
      case 'search': {
        if (!query) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Invalid input',
                  message: 'query is required for search action',
                }),
              },
            ],
          };
        }

        const searchResult = await backlogProvider.searchItems(query, limit);

        if (searchResult.isErr()) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Backlog search failed',
                  message: searchResult.error.message,
                }),
              },
            ],
          };
        }

        const items = searchResult.value.map((item) => formatItem(item));

        return {
          content: [{ type: 'text', text: JSON.stringify({ items }) }],
        };
      }

      case 'get': {
        if (!id) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Invalid input',
                  message: 'id is required for get action',
                }),
              },
            ],
          };
        }

        const getResult = await backlogProvider.getItem(id);

        if (getResult.isErr()) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Backlog get failed',
                  message: getResult.error.message,
                }),
              },
            ],
          };
        }

        const item = formatItem(getResult.value, true);

        return {
          content: [{ type: 'text', text: JSON.stringify({ item }) }],
        };
      }

      case 'list': {
        const listResult = await backlogProvider.getItems({
          types,
          states,
          tags,
          limit,
        });

        if (listResult.isErr()) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Backlog list failed',
                  message: listResult.error.message,
                }),
              },
            ],
          };
        }

        const items = listResult.value.map((item) => formatItem(item));

        return {
          content: [{ type: 'text', text: JSON.stringify({ items }) }],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Unknown action',
                message: `Unknown action: ${action as string}`,
              }),
            },
          ],
        };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'Backlog operation failed', message }),
        },
      ],
    };
  }
}
