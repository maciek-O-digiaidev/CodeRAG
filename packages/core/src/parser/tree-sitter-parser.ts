import TSParser from 'web-tree-sitter';
type TSNode = TSParser.SyntaxNode;
import { ok, err, type Result } from 'neverthrow';
import type { Parser, ParsedFile } from '../types/provider.js';
import { ParseError } from '../types/provider.js';
import { LanguageRegistry } from './language-registry.js';

/**
 * Extract a human-readable name from a tree-sitter AST node.
 *
 * Tries the following strategies in order:
 * 1. `childForFieldName('name')` — works for most declarations
 * 2. `childForFieldName('declaration')` then its 'name' child — for export wrappers
 * 3. `childForFieldName('declarator')` then its 'name' child — for C/C++ style declarations
 *
 * Returns undefined if no name can be extracted.
 */
function extractNodeName(node: TSNode): string | undefined {
  // Strategy 1: direct 'name' field
  const nameNode = node.childForFieldName('name');
  if (nameNode) {
    return nameNode.text;
  }

  // Strategy 2: 'declaration' field with a 'name' sub-field
  const declarationNode = node.childForFieldName('declaration');
  if (declarationNode) {
    const declName = declarationNode.childForFieldName('name');
    if (declName) {
      return declName.text;
    }
  }

  // Strategy 3: 'declarator' field with a 'name' sub-field
  const declaratorNode = node.childForFieldName('declarator');
  if (declaratorNode) {
    const declrName = declaratorNode.childForFieldName('name');
    if (declrName) {
      return declrName.text;
    }
    // Some declarators (e.g. simple variable declarators) have the name directly as text
    if (declaratorNode.type === 'identifier') {
      return declaratorNode.text;
    }
  }

  return undefined;
}

/**
 * Walk the top-level children of a root AST node and extract declaration names.
 *
 * Only nodes whose type is in the provided `declarationTypes` set are considered.
 */
function extractDeclarations(
  rootNode: TSNode,
  declarationTypes: ReadonlySet<string>,
): string[] {
  const declarations: string[] = [];

  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
    if (!child) continue;

    if (!declarationTypes.has(child.type)) continue;

    const name = extractNodeName(child);
    if (name) {
      declarations.push(name);
    }
  }

  return declarations;
}

/**
 * A Parser implementation that uses tree-sitter WASM bindings
 * to parse source files and extract top-level declarations.
 */
export class TreeSitterParser implements Parser {
  private parser: TSParser | null = null;
  private registry: LanguageRegistry | null = null;
  private initialized = false;

  /**
   * Initialize the tree-sitter WASM runtime and create internal instances.
   * Must be called before `parse()`.
   */
  async initialize(): Promise<Result<void, ParseError>> {
    try {
      await TSParser.init();
      this.parser = new TSParser();
      this.registry = new LanguageRegistry();
      this.initialized = true;
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new ParseError(`Failed to initialize tree-sitter: ${message}`));
    }
  }

  /**
   * Parse a source file and extract its top-level declarations.
   *
   * Detects the language from the file path, loads the corresponding WASM grammar,
   * parses the content into an AST, and extracts declaration names.
   */
  async parse(filePath: string, content: string): Promise<Result<ParsedFile, ParseError>> {
    if (!this.initialized || !this.parser || !this.registry) {
      return err(new ParseError('TreeSitterParser not initialized. Call initialize() first.'));
    }

    const language = this.registry.detectLanguage(filePath);
    if (!language) {
      return err(new ParseError(`Unsupported file type: ${filePath}`));
    }

    try {
      const tsLanguage = await this.registry.loadLanguage(language);
      this.parser.setLanguage(tsLanguage);

      const tree = this.parser.parse(content);
      if (!tree) {
        return err(new ParseError(`Failed to parse file: ${filePath}`));
      }

      const declarationTypes = this.registry.getDeclarationNodeTypes(language);
      const declarations = extractDeclarations(tree.rootNode, declarationTypes);

      tree.delete();

      return ok({
        filePath,
        language,
        content,
        declarations,
      });
    } catch (error: unknown) {
      const message = error instanceof Error
        ? (error.message || error.constructor.name)
        : String(error);
      return err(new ParseError(`Error parsing ${filePath}: ${message}`));
    }
  }

  /**
   * Get the list of all file extensions / languages this parser supports.
   */
  supportedLanguages(): string[] {
    if (!this.registry) {
      return [];
    }
    return this.registry.supportedLanguages();
  }

  /**
   * Clean up parser resources.
   */
  dispose(): void {
    if (this.parser) {
      this.parser.delete();
      this.parser = null;
    }
    this.registry = null;
    this.initialized = false;
  }
}
