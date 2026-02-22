import { createHash } from 'node:crypto';
import { ok, err, type Result } from 'neverthrow';
import type { Chunk, ChunkType } from '../types/chunk.js';
import { ParseError } from '../types/provider.js';

/**
 * Parsed frontmatter from a Markdown file.
 */
export interface MarkdownFrontmatter {
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly aliases?: readonly string[];
  readonly raw: Readonly<Record<string, unknown>>;
}

/**
 * A structured section extracted from a Markdown document.
 */
interface MarkdownSection {
  readonly heading: string;
  readonly headingLevel: number;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly codeBlocks: readonly CodeBlock[];
  readonly wikilinks: readonly string[];
  readonly tags: readonly string[];
}

/**
 * A fenced code block extracted from Markdown content.
 */
interface CodeBlock {
  readonly language: string;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Result of parsing a Markdown file.
 */
export interface ParsedMarkdown {
  readonly filePath: string;
  readonly frontmatter: MarkdownFrontmatter;
  readonly sections: readonly MarkdownSection[];
  readonly chunks: readonly Chunk[];
}

/**
 * Configuration for the MarkdownParser.
 */
export interface MarkdownParserConfig {
  /** Maximum number of tokens per chunk (approximated as content.length / 4). */
  readonly maxTokensPerChunk: number;
}

const DEFAULT_CONFIG: MarkdownParserConfig = {
  maxTokensPerChunk: 1024,
};

/**
 * Generate a deterministic chunk ID from file path, start line, and content.
 */
function generateChunkId(filePath: string, startLine: number, content: string): string {
  return createHash('sha256')
    .update(`${filePath}${startLine}${content}`)
    .digest('hex');
}

/**
 * Approximate token count using the heuristic content.length / 4.
 */
function approximateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * Extract YAML frontmatter from the beginning of a Markdown file.
 *
 * Frontmatter is delimited by `---` at the very start of the file.
 * We parse it manually (no YAML library dependency) to extract
 * simple key-value pairs, arrays, and tags.
 */
export function parseFrontmatter(content: string): {
  frontmatter: MarkdownFrontmatter;
  bodyStartLine: number;
} {
  const lines = content.split('\n');

  if (lines[0]?.trim() !== '---') {
    return {
      frontmatter: { raw: {} },
      bodyStartLine: 0,
    };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return {
      frontmatter: { raw: {} },
      bodyStartLine: 0,
    };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const raw: Record<string, unknown> = {};
  let currentKey = '';
  let currentArray: string[] | null = null;

  for (const line of frontmatterLines) {
    // Array item continuation
    if (currentArray !== null && /^\s+-\s+/.test(line)) {
      const value = line.replace(/^\s+-\s+/, '').trim();
      currentArray.push(stripQuotes(value));
      continue;
    }

    // If we were building an array, finalize it
    if (currentArray !== null) {
      raw[currentKey] = currentArray;
      currentArray = null;
    }

    // Key: value pair
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1] as string;
      const value = (kvMatch[2] as string).trim();

      if (value === '') {
        // Could be start of an array
        currentKey = key;
        currentArray = [];
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array: [item1, item2]
        const items = value
          .slice(1, -1)
          .split(',')
          .map((s) => stripQuotes(s.trim()))
          .filter((s) => s.length > 0);
        raw[key] = items;
      } else {
        raw[key] = stripQuotes(value);
      }
    }
  }

  // Finalize any trailing array
  if (currentArray !== null) {
    raw[currentKey] = currentArray;
  }

  const title = typeof raw['title'] === 'string' ? raw['title'] : undefined;
  const tags = extractStringArray(raw['tags']);
  const aliases = extractStringArray(raw['aliases']);

  return {
    frontmatter: { title, tags, aliases, raw },
    bodyStartLine: endIndex + 1,
  };
}

/**
 * Strip surrounding quotes from a string value.
 */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Safely extract a string array from a frontmatter value.
 */
function extractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      result.push(item);
    }
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Extract all [[wikilinks]] from Markdown content.
 * Supports [[link]] and [[link|display text]] syntax.
 */
export function extractWikilinks(content: string): string[] {
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const link = match[1];
    if (link) {
      links.push(link.trim());
    }
  }

  return [...new Set(links)];
}

/**
 * Extract all #tags from Markdown content.
 * Tags must start with # followed by word characters (and may contain /).
 * Excludes headings (# at line start followed by space) and code blocks.
 */
export function extractTags(content: string): string[] {
  // Remove code blocks to avoid false matches
  const withoutCode = content.replace(/```[\s\S]*?```/g, '');
  const withoutInlineCode = withoutCode.replace(/`[^`]+`/g, '');

  const pattern = /(?:^|[\s,(])#([\w][\w/.-]*[\w]|[\w])/gm;
  const tags: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(withoutInlineCode)) !== null) {
    const tag = match[1];
    if (tag) {
      tags.push(tag);
    }
  }

  return [...new Set(tags)];
}

/**
 * Extract fenced code blocks from Markdown content.
 */
function extractCodeBlocks(
  lines: readonly string[],
  baseLineOffset: number,
): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inCodeBlock = false;
  let codeStartLine = 0;
  let codeLanguage = '';
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    if (!inCodeBlock && line.trimStart().startsWith('```')) {
      inCodeBlock = true;
      codeStartLine = i;
      codeLanguage = line.trimStart().slice(3).trim();
      codeLines = [];
    } else if (inCodeBlock && line.trimStart().startsWith('```')) {
      blocks.push({
        language: codeLanguage,
        content: codeLines.join('\n'),
        startLine: baseLineOffset + codeStartLine,
        endLine: baseLineOffset + i,
      });
      inCodeBlock = false;
      codeLines = [];
    } else if (inCodeBlock) {
      codeLines.push(line);
    }
  }

  return blocks;
}

/**
 * Split Markdown content into sections based on heading hierarchy.
 */
function splitIntoSections(
  lines: readonly string[],
  bodyStartLine: number,
): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentStartLine = bodyStartLine;
  let sectionLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headingMatch) {
      // Save previous section if it has content
      if (sectionLines.length > 0 || currentHeading !== '') {
        const content = sectionLines.join('\n');
        const sectionContent = currentHeading
          ? `${'#'.repeat(currentLevel)} ${currentHeading}\n${content}`
          : content;

        if (sectionContent.trim().length > 0) {
          const sectionAllLines = sectionContent.split('\n');
          const codeBlocks = extractCodeBlocks(sectionAllLines, currentStartLine);
          const wikilinks = extractWikilinks(sectionContent);
          const tags = extractTags(sectionContent);

          sections.push({
            heading: currentHeading,
            headingLevel: currentLevel,
            content: sectionContent,
            startLine: currentStartLine,
            endLine: bodyStartLine + i - 1,
            codeBlocks,
            wikilinks,
            tags,
          });
        }
      }

      currentHeading = (headingMatch[2] as string).trim();
      currentLevel = (headingMatch[1] as string).length;
      currentStartLine = bodyStartLine + i;
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }

  // Final section
  if (sectionLines.length > 0 || currentHeading !== '') {
    const content = sectionLines.join('\n');
    const sectionContent = currentHeading
      ? `${'#'.repeat(currentLevel)} ${currentHeading}\n${content}`
      : content;

    if (sectionContent.trim().length > 0) {
      const sectionAllLines = sectionContent.split('\n');
      const codeBlocks = extractCodeBlocks(sectionAllLines, currentStartLine);
      const wikilinks = extractWikilinks(sectionContent);
      const tags = extractTags(sectionContent);

      sections.push({
        heading: currentHeading,
        headingLevel: currentLevel,
        content: sectionContent,
        startLine: currentStartLine,
        endLine: bodyStartLine + lines.length - 1,
        codeBlocks,
        wikilinks,
        tags,
      });
    }
  }

  return sections;
}

/**
 * MarkdownParser parses Markdown and Obsidian vault files into structured
 * chunks suitable for indexing by CodeRAG.
 *
 * Features:
 * - YAML frontmatter extraction (title, tags, aliases)
 * - Heading-based section splitting (h1-h6)
 * - [[wikilink]] extraction (Obsidian syntax)
 * - #tag extraction
 * - Fenced code block extraction
 * - Chunk type 'doc' for all documentation chunks
 */
export class MarkdownParser {
  private readonly config: MarkdownParserConfig;

  constructor(config?: Partial<MarkdownParserConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Parse a Markdown file into structured chunks.
   *
   * Returns a Result containing the parsed chunks or a ParseError.
   */
  parse(filePath: string, content: string): Result<ParsedMarkdown, ParseError> {
    try {
      const result = this.parseInternal(filePath, content);
      return ok(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new ParseError(`Failed to parse markdown ${filePath}: ${message}`));
    }
  }

  /**
   * Check if a file path is a Markdown file.
   */
  static isMarkdownFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.markdown');
  }

  /**
   * Internal parsing logic.
   */
  private parseInternal(filePath: string, content: string): ParsedMarkdown {
    if (content.trim().length === 0) {
      return {
        filePath,
        frontmatter: { raw: {} },
        sections: [],
        chunks: [],
      };
    }

    const { frontmatter, bodyStartLine } = parseFrontmatter(content);
    const allLines = content.split('\n');
    const bodyLines = allLines.slice(bodyStartLine);
    const sections = splitIntoSections(bodyLines, bodyStartLine);

    // If no sections were found (no headings), treat the whole body as one section
    const effectiveSections = sections.length > 0
      ? sections
      : this.createSingleSection(bodyLines, bodyStartLine);

    const chunks = this.sectionsToChunks(filePath, frontmatter, effectiveSections);

    return {
      filePath,
      frontmatter,
      sections: effectiveSections,
      chunks,
    };
  }

  /**
   * Create a single section from the entire body when no headings are present.
   */
  private createSingleSection(
    bodyLines: readonly string[],
    bodyStartLine: number,
  ): MarkdownSection[] {
    const content = bodyLines.join('\n');
    if (content.trim().length === 0) return [];

    const codeBlocks = extractCodeBlocks(bodyLines, bodyStartLine);
    const wikilinks = extractWikilinks(content);
    const tags = extractTags(content);

    return [
      {
        heading: '',
        headingLevel: 0,
        content,
        startLine: bodyStartLine,
        endLine: bodyStartLine + bodyLines.length - 1,
        codeBlocks,
        wikilinks,
        tags,
      },
    ];
  }

  /**
   * Convert parsed sections into Chunk objects.
   */
  private sectionsToChunks(
    filePath: string,
    frontmatter: MarkdownFrontmatter,
    sections: readonly MarkdownSection[],
  ): Chunk[] {
    const chunks: Chunk[] = [];

    for (const section of sections) {
      const sectionChunks = this.sectionToChunks(filePath, frontmatter, section);
      chunks.push(...sectionChunks);
    }

    return chunks;
  }

  /**
   * Convert a single section into one or more chunks,
   * splitting if the section exceeds the token budget.
   */
  private sectionToChunks(
    filePath: string,
    frontmatter: MarkdownFrontmatter,
    section: MarkdownSection,
  ): Chunk[] {
    const content = section.content;
    const tokens = approximateTokens(content);

    // Merge frontmatter tags with section tags
    const allTags = mergeStringArrays(
      frontmatter.tags as string[] | undefined,
      section.tags as string[],
    );

    const chunkType: ChunkType = 'doc';
    const name = section.heading || frontmatter.title || '(document)';

    // Build doc-specific metadata fields
    const docLinks = section.wikilinks.length > 0
      ? [...section.wikilinks]
      : undefined;
    const docTags = allTags.length > 0
      ? allTags
      : undefined;
    const docAliases = frontmatter.aliases && frontmatter.aliases.length > 0
      ? [...frontmatter.aliases]
      : undefined;
    const docTitle = frontmatter.title ?? undefined;

    if (tokens <= this.config.maxTokensPerChunk) {
      return [
        this.makeChunk(
          filePath, content, section.startLine, section.endLine,
          name, chunkType, docLinks, docTags, docAliases, docTitle,
        ),
      ];
    }

    // Split oversized sections at paragraph boundaries
    return this.splitSection(
      filePath, content, section.startLine,
      name, chunkType, docLinks, docTags, docAliases, docTitle,
    );
  }

  /**
   * Split a large section into multiple chunks at paragraph boundaries.
   */
  private splitSection(
    filePath: string,
    content: string,
    baseStartLine: number,
    name: string,
    chunkType: ChunkType,
    docLinks: string[] | undefined,
    docTags: string[] | undefined,
    docAliases: string[] | undefined,
    docTitle: string | undefined,
  ): Chunk[] {
    const lines = content.split('\n');
    const chunks: Chunk[] = [];
    let currentLines: string[] = [];
    let currentStartLine = baseStartLine;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      currentLines.push(line);

      const currentContent = currentLines.join('\n');
      if (approximateTokens(currentContent) >= this.config.maxTokensPerChunk) {
        // Try to split at a blank line
        let splitIndex = -1;
        for (let j = currentLines.length - 2; j >= 0; j--) {
          if ((currentLines[j] as string).trim() === '') {
            splitIndex = j;
            break;
          }
        }

        if (splitIndex > 0) {
          const part = currentLines.slice(0, splitIndex + 1).join('\n');
          if (part.trim().length > 0) {
            const endLine = currentStartLine + splitIndex;
            chunks.push(
              this.makeChunk(filePath, part, currentStartLine, endLine, name, chunkType, docLinks, docTags, docAliases, docTitle),
            );
          }
          currentStartLine = currentStartLine + splitIndex + 1;
          currentLines = currentLines.slice(splitIndex + 1);
        } else {
          // Force split
          if (currentContent.trim().length > 0) {
            const endLine = currentStartLine + currentLines.length - 1;
            chunks.push(
              this.makeChunk(filePath, currentContent, currentStartLine, endLine, name, chunkType, docLinks, docTags, docAliases, docTitle),
            );
          }
          currentStartLine = baseStartLine + i + 1;
          currentLines = [];
        }
      }
    }

    // Remaining lines
    if (currentLines.length > 0) {
      const remaining = currentLines.join('\n');
      if (remaining.trim().length > 0) {
        const endLine = currentStartLine + currentLines.length - 1;
        chunks.push(
          this.makeChunk(filePath, remaining, currentStartLine, endLine, name, chunkType, docLinks, docTags, docAliases, docTitle),
        );
      }
    }

    return chunks;
  }

  /**
   * Construct a single Chunk with doc type and enriched metadata.
   */
  private makeChunk(
    filePath: string,
    content: string,
    startLine: number,
    endLine: number,
    name: string,
    chunkType: ChunkType,
    docLinks: string[] | undefined,
    docTags: string[] | undefined,
    docAliases: string[] | undefined,
    docTitle: string | undefined,
  ): Chunk {
    const id = generateChunkId(filePath, startLine, content);

    return {
      id,
      content,
      nlSummary: '',
      filePath,
      startLine,
      endLine,
      language: 'markdown',
      metadata: {
        chunkType,
        name,
        declarations: [],
        imports: [],
        exports: [],
        links: docLinks,
        tags: docTags,
        aliases: docAliases,
        docTitle,
      },
    };
  }
}

/**
 * Merge two optional string arrays, deduplicating.
 */
function mergeStringArrays(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): string[] {
  const set = new Set<string>();
  if (a) {
    for (const item of a) set.add(item);
  }
  if (b) {
    for (const item of b) set.add(item);
  }
  return [...set];
}
