import { createHash } from 'node:crypto';
import { ok, err, type Result } from 'neverthrow';
import type { Chunker, ParsedFile } from '../types/provider.js';
import { ChunkError } from '../types/provider.js';
import type { Chunk, ChunkType } from '../types/chunk.js';

/**
 * Configuration for the ASTChunker.
 */
export interface ASTChunkerConfig {
  /** Maximum number of tokens per chunk (approximated as content.length / 4). */
  maxTokensPerChunk: number;
}

/**
 * Represents a region within a source file that maps to a top-level declaration.
 * Used internally to track which declaration name corresponds to which line range.
 */
interface DeclarationRegion {
  name: string;
  startLine: number;
  endLine: number;
}

/**
 * Approximate number of tokens in a string using the simple heuristic of
 * `content.length / 4`.
 */
function approximateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * Generate a deterministic chunk ID as a SHA-256 hash of
 * `filePath + startLine + content`.
 */
function generateChunkId(filePath: string, startLine: number, content: string): string {
  return createHash('sha256')
    .update(`${filePath}${startLine}${content}`)
    .digest('hex');
}

/**
 * Infer a ChunkType from a declaration name and surrounding content.
 * This is a best-effort heuristic since ParsedFile.declarations only gives us
 * names, not AST node types.
 */
function inferChunkType(content: string): ChunkType {
  const trimmed = content.trimStart();

  // Order matters: check more specific patterns first
  if (/^(export\s+)?(abstract\s+)?class\s+/m.test(trimmed)) return 'class';
  if (/^(export\s+)?interface\s+/m.test(trimmed)) return 'interface';
  if (/^(export\s+)?type\s+\w+/m.test(trimmed)) return 'type_alias';
  if (/^(export\s+)?(async\s+)?function\s+/m.test(trimmed)) return 'function';
  if (/^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/m.test(trimmed)) return 'function';
  if (/^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?function/m.test(trimmed)) return 'function';
  if (/^(export\s+)?(const|let|var)\s+/m.test(trimmed)) return 'module';
  if (/^import\s+/m.test(trimmed)) return 'import_block';
  if (/^(def|async\s+def)\s+/m.test(trimmed)) return 'function';
  if (/^class\s+/m.test(trimmed)) return 'class';
  if (/^(func|fn|pub\s+fn)\s+/m.test(trimmed)) return 'function';
  if (/^(struct|impl|trait|enum)\s+/m.test(trimmed)) return 'class';

  return 'module';
}

/**
 * Find the line ranges of declarations by scanning the file content
 * for lines that start with the declaration name in typical declaration patterns.
 * Returns regions sorted by startLine.
 */
function findDeclarationRegions(
  content: string,
  declarations: readonly string[],
): DeclarationRegion[] {
  if (declarations.length === 0) return [];

  const lines = content.split('\n');
  const regions: DeclarationRegion[] = [];

  // For each declaration name, find its start line and compute its end line.
  // We track found lines to handle ordering.
  const foundStarts: { name: string; startLine: number }[] = [];

  for (const declName of declarations) {
    // Search for the line that declares this name.
    // Look for patterns like: function name, class name, const name, def name, etc.
    const escapedName = declName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(?:^|\\s|export\\s+(?:default\\s+)?|async\\s+)(?:function\\*?|class|interface|type|const|let|var|enum|def|async\\s+def|fn|pub\\s+fn|func|struct|impl|trait|mod)\\s+${escapedName}\\b` +
        `|(?:^|\\s)${escapedName}\\s*(?:=|\\(|<|:)`,
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && pattern.test(line)) {
        // Avoid duplicating a start line already assigned
        const alreadyUsed = foundStarts.some((f) => f.startLine === i);
        if (!alreadyUsed) {
          foundStarts.push({ name: declName, startLine: i });
          break;
        }
      }
    }
  }

  // Sort by start line
  foundStarts.sort((a, b) => a.startLine - b.startLine);

  // Compute end lines: each declaration extends until the line before the next,
  // or to the end of the file for the last one.
  for (let i = 0; i < foundStarts.length; i++) {
    const current = foundStarts[i];
    if (!current) continue;

    const next = foundStarts[i + 1];
    const endLine = next ? next.startLine - 1 : lines.length - 1;

    regions.push({
      name: current.name,
      startLine: current.startLine,
      endLine,
    });
  }

  return regions;
}

/**
 * Extract lines from content by 0-based line indices (inclusive).
 */
function extractLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n');
  return lines.slice(startLine, endLine + 1).join('\n');
}

/**
 * Split a large content block at logical points (blank lines, closing braces)
 * into sub-blocks that each fit within the token limit.
 */
function splitAtLogicalPoints(
  content: string,
  maxTokens: number,
): string[] {
  const lines = content.split('\n');
  const chunks: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    currentLines.push(line);
    const currentContent = currentLines.join('\n');

    if (approximateTokens(currentContent) >= maxTokens) {
      // Try to split at the last blank line or closing brace in currentLines
      let splitIndex = -1;

      // Walk backwards to find a good split point
      for (let i = currentLines.length - 2; i >= 0; i--) {
        const candidate = currentLines[i];
        if (candidate !== undefined && (candidate.trim() === '' || candidate.trim() === '}' || candidate.trim() === '};')) {
          splitIndex = i;
          break;
        }
      }

      if (splitIndex > 0) {
        // Split at the found point
        const firstPart = currentLines.slice(0, splitIndex + 1).join('\n');
        if (firstPart.trim().length > 0) {
          chunks.push(firstPart);
        }
        currentLines = currentLines.slice(splitIndex + 1);
      } else {
        // No good split point found; force split at current position
        const forcedContent = currentLines.join('\n');
        if (forcedContent.trim().length > 0) {
          chunks.push(forcedContent);
        }
        currentLines = [];
      }
    }
  }

  // Remaining lines
  if (currentLines.length > 0) {
    const remaining = currentLines.join('\n');
    if (remaining.trim().length > 0) {
      chunks.push(remaining);
    }
  }

  return chunks;
}

/**
 * AST-aware chunking engine that splits parsed source files into semantically
 * meaningful chunks based on top-level declarations extracted by tree-sitter.
 *
 * Strategy:
 * 1. Walk top-level declarations from ParsedFile.declarations
 * 2. Map each declaration to its line range in the source
 * 3. Group consecutive non-declaration lines with adjacent declarations
 * 4. If a single declaration exceeds maxTokensPerChunk, split it at logical
 *    points (blank lines, closing braces)
 * 5. Generate deterministic chunk IDs as SHA-256 hashes
 */
export class ASTChunker implements Chunker {
  private readonly maxTokensPerChunk: number;

  constructor(config: ASTChunkerConfig) {
    this.maxTokensPerChunk = config.maxTokensPerChunk;
  }

  async chunk(parsed: ParsedFile): Promise<Result<Chunk[], ChunkError>> {
    try {
      const chunks = this.createChunks(parsed);
      return ok(chunks);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new ChunkError(`Failed to chunk ${parsed.filePath}: ${message}`));
    }
  }

  /**
   * Core chunking logic. Separated from `chunk()` for cleaner error handling.
   */
  private createChunks(parsed: ParsedFile): Chunk[] {
    const { filePath, language, content, declarations } = parsed;

    // Empty file produces no chunks
    if (content.trim().length === 0) {
      return [];
    }

    // No declarations: wrap entire file as a single "module" chunk
    if (declarations.length === 0) {
      return this.createModuleChunks(filePath, language, content);
    }

    // Find declaration regions in the source
    const regions = findDeclarationRegions(content, declarations);

    // If no regions were matched (declarations listed but not found in source),
    // treat as a module chunk
    if (regions.length === 0) {
      return this.createModuleChunks(filePath, language, content);
    }

    const lines = content.split('\n');
    const chunks: Chunk[] = [];

    // Handle any preamble (lines before the first declaration)
    const firstRegion = regions[0];
    if (firstRegion && firstRegion.startLine > 0) {
      const preambleContent = extractLines(content, 0, firstRegion.startLine - 1);
      if (preambleContent.trim().length > 0) {
        const preambleChunks = this.buildChunks(
          filePath,
          language,
          preambleContent,
          0,
          [],
          'import_block',
        );
        chunks.push(...preambleChunks);
      }
    }

    // Process each declaration region
    for (const region of regions) {
      const regionContent = extractLines(content, region.startLine, region.endLine);

      // Trim trailing empty lines from the region content
      const trimmedContent = regionContent.replace(/\n+$/, '');

      if (trimmedContent.trim().length === 0) continue;

      const chunkType = inferChunkType(trimmedContent);

      const regionChunks = this.buildChunks(
        filePath,
        language,
        trimmedContent,
        region.startLine,
        [region.name],
        chunkType,
      );
      chunks.push(...regionChunks);
    }

    // Handle any trailing content after the last declaration region
    const lastRegion = regions[regions.length - 1];
    if (lastRegion && lastRegion.endLine < lines.length - 1) {
      const trailingContent = extractLines(content, lastRegion.endLine + 1, lines.length - 1);
      if (trailingContent.trim().length > 0) {
        const trailingChunks = this.buildChunks(
          filePath,
          language,
          trailingContent,
          lastRegion.endLine + 1,
          [],
          'module',
        );
        chunks.push(...trailingChunks);
      }
    }

    return chunks;
  }

  /**
   * Wrap the entire file content as one or more "module" chunks.
   */
  private createModuleChunks(
    filePath: string,
    language: string,
    content: string,
  ): Chunk[] {
    return this.buildChunks(filePath, language, content, 0, [], 'module');
  }

  /**
   * Build one or more Chunk objects from a content block.
   * If the content exceeds maxTokensPerChunk, split it at logical points.
   */
  private buildChunks(
    filePath: string,
    language: string,
    content: string,
    baseStartLine: number,
    declarations: string[],
    chunkType: ChunkType,
  ): Chunk[] {
    const tokens = approximateTokens(content);

    if (tokens <= this.maxTokensPerChunk) {
      const lineCount = content.split('\n').length;
      return [
        this.makeChunk(
          filePath,
          language,
          content,
          baseStartLine,
          baseStartLine + lineCount - 1,
          declarations,
          chunkType,
        ),
      ];
    }

    // Content exceeds limit: split at logical points
    const parts = splitAtLogicalPoints(content, this.maxTokensPerChunk);
    const chunks: Chunk[] = [];
    let currentLine = baseStartLine;

    for (const part of parts) {
      const lineCount = part.split('\n').length;
      const endLine = currentLine + lineCount - 1;

      chunks.push(
        this.makeChunk(
          filePath,
          language,
          part,
          currentLine,
          endLine,
          declarations,
          chunkType,
        ),
      );

      currentLine = endLine + 1;
    }

    return chunks;
  }

  /**
   * Construct a single Chunk object with a deterministic ID.
   */
  private makeChunk(
    filePath: string,
    language: string,
    content: string,
    startLine: number,
    endLine: number,
    declarations: string[],
    chunkType: ChunkType,
  ): Chunk {
    const id = generateChunkId(filePath, startLine, content);
    const name = declarations.length > 0 ? declarations.join(', ') : '(module)';

    return {
      id,
      content,
      nlSummary: '',
      filePath,
      startLine,
      endLine,
      language,
      metadata: {
        chunkType,
        name,
        declarations,
        imports: [],
        exports: [],
      },
    };
  }
}
