import type { SearchResult } from '../types/index.js';
import type { ExpandedContext, RelatedChunk } from './context-expander.js';

export interface TokenBudgetConfig {
  /** Maximum total tokens for assembled context. Default 8000. */
  maxTokens: number;
  /** Tokens reserved for the LLM response. Default 2000. */
  reserveForAnswer: number;
  /** Fraction of available budget for primary results. Default 0.6. */
  primaryWeight: number;
  /** Fraction of available budget for related context. Default 0.3. */
  relatedWeight: number;
  /** Fraction of available budget for graph excerpt. Default 0.1. */
  graphWeight: number;
}

export interface AssembledContext {
  /** Final assembled context string with formatted sections. */
  content: string;
  /** Primary results that fit within the budget. */
  primaryChunks: SearchResult[];
  /** Related chunks that fit within the budget. */
  relatedChunks: RelatedChunk[];
  /** Estimated total token count of the assembled content. */
  tokenCount: number;
  /** Whether results were truncated to fit the budget. */
  truncated: boolean;
}

const DEFAULT_CONFIG: TokenBudgetConfig = {
  maxTokens: 8000,
  reserveForAnswer: 2000,
  primaryWeight: 0.6,
  relatedWeight: 0.3,
  graphWeight: 0.1,
};

export class TokenBudgetOptimizer {
  private readonly config: TokenBudgetConfig;

  constructor(config?: Partial<TokenBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Assemble an ExpandedContext into a token-budgeted context string.
   *
   * Pipeline:
   * 1. Calculate available budget: maxTokens - reserveForAnswer
   * 2. Allocate budget: primary * primaryWeight, related * relatedWeight, graph * graphWeight
   * 3. Fill primary results first (highest score first)
   * 4. Fill related chunks (closest relationship first)
   * 5. Add graph excerpt if budget remains
   * 6. Build formatted context string
   */
  assemble(expanded: ExpandedContext): AssembledContext {
    const availableBudget = Math.max(0, this.config.maxTokens - this.config.reserveForAnswer);
    const primaryBudget = Math.floor(availableBudget * this.config.primaryWeight);
    const relatedBudget = Math.floor(availableBudget * this.config.relatedWeight);
    const graphBudget = Math.floor(availableBudget * this.config.graphWeight);

    // Step 1: Fill primary results (sorted by score descending)
    const sortedPrimary = [...expanded.primaryResults].sort(
      (a, b) => b.score - a.score,
    );
    const { items: includedPrimary, tokensUsed: primaryTokensUsed } =
      this.fillBudget(sortedPrimary, primaryBudget, formatPrimaryChunk);

    // Step 2: Fill related chunks (sorted by distance ascending)
    const sortedRelated = [...expanded.relatedChunks].sort(
      (a, b) => a.distance - b.distance,
    );
    const { items: includedRelated, tokensUsed: relatedTokensUsed } =
      this.fillBudget(sortedRelated, relatedBudget, formatRelatedChunk);

    // Step 3: Build graph excerpt string
    const graphString = this.formatGraphExcerpt(expanded.graphExcerpt);
    const graphTokens = this.estimateTokens(graphString);
    const includedGraph = graphTokens <= graphBudget ? graphString : '';
    const graphTokensUsed = includedGraph ? graphTokens : 0;

    // Step 4: Build formatted context string
    const sections: string[] = [];

    if (includedPrimary.length > 0) {
      sections.push('## Primary Results\n');
      for (const chunk of includedPrimary) {
        sections.push(formatPrimaryChunk(chunk));
      }
    }

    if (includedRelated.length > 0) {
      sections.push('## Related Context\n');
      for (const related of includedRelated) {
        sections.push(formatRelatedChunk(related));
      }
    }

    if (includedGraph) {
      sections.push('## Dependency Graph\n');
      sections.push(includedGraph);
    }

    const content = sections.join('\n');
    const totalTokens = primaryTokensUsed + relatedTokensUsed + graphTokensUsed;

    const truncated =
      includedPrimary.length < expanded.primaryResults.length ||
      includedRelated.length < expanded.relatedChunks.length ||
      (!includedGraph &&
        expanded.graphExcerpt.nodes.length > 0 &&
        graphTokens > graphBudget);

    return {
      content,
      primaryChunks: includedPrimary,
      relatedChunks: includedRelated,
      tokenCount: totalTokens,
      truncated,
    };
  }

  /** Estimate token count using the text.length / 4 approximation. */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Fill a budget with items, returning what fits.
   * Uses the formatted version of each item to estimate tokens.
   */
  private fillBudget<T>(
    items: T[],
    budget: number,
    formatter: (item: T) => string,
  ): { items: T[]; tokensUsed: number } {
    const included: T[] = [];
    let tokensUsed = 0;

    for (const item of items) {
      const formatted = formatter(item);
      const tokens = this.estimateTokens(formatted);

      if (tokensUsed + tokens > budget) {
        break;
      }

      included.push(item);
      tokensUsed += tokens;
    }

    return { items: included, tokensUsed };
  }

  /** Format the graph excerpt as a simplified text representation. */
  private formatGraphExcerpt(excerpt: {
    nodes: string[];
    edges: Array<{ from: string; to: string; type: string }>;
  }): string {
    if (excerpt.nodes.length === 0) return '';

    const lines: string[] = [];
    lines.push(`Nodes: ${excerpt.nodes.join(', ')}`);

    for (const edge of excerpt.edges) {
      lines.push(`${edge.from} --[${edge.type}]--> ${edge.to}`);
    }

    return lines.join('\n');
  }
}

/** Format a primary search result chunk for context output. */
function formatPrimaryChunk(result: SearchResult): string {
  const header = result.metadata?.name
    ? `### ${result.metadata.name} (${result.metadata.chunkType})`
    : '### (unnamed chunk)';

  const filePath = result.chunk?.filePath ?? '';
  const lines =
    result.chunk?.startLine !== undefined && result.chunk?.endLine !== undefined
      ? ` [L${result.chunk.startLine}-${result.chunk.endLine}]`
      : '';

  const locationLine = filePath ? `File: ${filePath}${lines}` : '';

  const parts = [header];
  if (locationLine) parts.push(locationLine);
  if (result.nlSummary) parts.push(result.nlSummary);
  parts.push('```');
  parts.push(result.content);
  parts.push('```');

  return parts.join('\n');
}

/** Format a related chunk for context output. */
function formatRelatedChunk(related: RelatedChunk): string {
  const label = `[${related.relationship}, distance=${related.distance}]`;
  const name = related.chunk.metadata?.name ?? 'unknown';
  const filePath = related.chunk.chunk?.filePath ?? '';

  const parts = [`### ${name} ${label}`];
  if (filePath) parts.push(`File: ${filePath}`);
  if (related.chunk.nlSummary) parts.push(related.chunk.nlSummary);
  parts.push('```');
  parts.push(related.chunk.content);
  parts.push('```');

  return parts.join('\n');
}
