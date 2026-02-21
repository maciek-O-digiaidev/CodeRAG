import { createRequire } from 'node:module';
import path from 'node:path';
import TSParser from 'web-tree-sitter';

type Language = TSParser.Language;

/**
 * All languages supported by the tree-sitter parser module.
 */
export type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'c_sharp'
  | 'c'
  | 'cpp'
  | 'ruby'
  | 'php';

/**
 * Maps file extensions to their corresponding supported language.
 */
export const EXTENSION_TO_LANGUAGE: ReadonlyMap<string, SupportedLanguage> = new Map<
  string,
  SupportedLanguage
>([
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.ts', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.tsx', 'tsx'],
  ['.py', 'python'],
  ['.pyw', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.java', 'java'],
  ['.cs', 'c_sharp'],
  ['.c', 'c'],
  ['.h', 'c'],
  ['.cpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.cxx', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hxx', 'cpp'],
  ['.rb', 'ruby'],
  ['.php', 'php'],
]);

/**
 * Maps each supported language to its WASM grammar filename.
 */
export const LANGUAGE_TO_WASM: ReadonlyMap<SupportedLanguage, string> = new Map<
  SupportedLanguage,
  string
>([
  ['javascript', 'tree-sitter-javascript.wasm'],
  ['typescript', 'tree-sitter-typescript.wasm'],
  ['tsx', 'tree-sitter-tsx.wasm'],
  ['python', 'tree-sitter-python.wasm'],
  ['go', 'tree-sitter-go.wasm'],
  ['rust', 'tree-sitter-rust.wasm'],
  ['java', 'tree-sitter-java.wasm'],
  ['c_sharp', 'tree-sitter-c_sharp.wasm'],
  ['c', 'tree-sitter-c.wasm'],
  ['cpp', 'tree-sitter-cpp.wasm'],
  ['ruby', 'tree-sitter-ruby.wasm'],
  ['php', 'tree-sitter-php.wasm'],
]);

/**
 * Maps each supported language to the set of AST node types that represent
 * top-level declarations (functions, classes, interfaces, etc.).
 */
export const DECLARATION_NODE_TYPES: ReadonlyMap<SupportedLanguage, ReadonlySet<string>> = new Map<
  SupportedLanguage,
  ReadonlySet<string>
>([
  [
    'javascript',
    new Set([
      'function_declaration',
      'class_declaration',
      'variable_declaration',
      'lexical_declaration',
      'export_statement',
    ]),
  ],
  [
    'typescript',
    new Set([
      'function_declaration',
      'class_declaration',
      'interface_declaration',
      'type_alias_declaration',
      'enum_declaration',
      'variable_declaration',
      'lexical_declaration',
      'export_statement',
    ]),
  ],
  [
    'tsx',
    new Set([
      'function_declaration',
      'class_declaration',
      'interface_declaration',
      'type_alias_declaration',
      'enum_declaration',
      'variable_declaration',
      'lexical_declaration',
      'export_statement',
    ]),
  ],
  [
    'python',
    new Set(['function_definition', 'class_definition', 'decorated_definition']),
  ],
  [
    'go',
    new Set([
      'function_declaration',
      'method_declaration',
      'type_declaration',
      'var_declaration',
      'const_declaration',
    ]),
  ],
  [
    'rust',
    new Set([
      'function_item',
      'struct_item',
      'enum_item',
      'impl_item',
      'trait_item',
      'type_item',
      'const_item',
      'static_item',
      'mod_item',
    ]),
  ],
  [
    'java',
    new Set([
      'class_declaration',
      'interface_declaration',
      'enum_declaration',
      'method_declaration',
      'constructor_declaration',
      'annotation_type_declaration',
    ]),
  ],
  [
    'c_sharp',
    new Set([
      'class_declaration',
      'interface_declaration',
      'enum_declaration',
      'struct_declaration',
      'method_declaration',
      'namespace_declaration',
    ]),
  ],
  [
    'c',
    new Set(['function_definition', 'declaration', 'struct_specifier', 'enum_specifier']),
  ],
  [
    'cpp',
    new Set([
      'function_definition',
      'declaration',
      'class_specifier',
      'struct_specifier',
      'enum_specifier',
      'namespace_definition',
      'template_declaration',
    ]),
  ],
  [
    'ruby',
    new Set(['method', 'singleton_method', 'class', 'module']),
  ],
  [
    'php',
    new Set([
      'function_definition',
      'class_declaration',
      'interface_declaration',
      'trait_declaration',
      'method_declaration',
    ]),
  ],
]);

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * Manages language detection from file paths, loading of WASM grammars,
 * and access to declaration node types per language.
 */
export class LanguageRegistry {
  private readonly languageCache = new Map<SupportedLanguage, Language>();

  /**
   * Detect the language of a file based on its extension.
   * Returns undefined if the extension is not recognized.
   */
  detectLanguage(filePath: string): SupportedLanguage | undefined {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE.get(ext);
  }

  /**
   * Load a tree-sitter Language from its WASM binary.
   * Languages are cached after the first load.
   */
  async loadLanguage(language: SupportedLanguage): Promise<Language> {
    const cached = this.languageCache.get(language);
    if (cached) {
      return cached;
    }

    const wasmFile = LANGUAGE_TO_WASM.get(language);
    if (!wasmFile) {
      throw new Error(`No WASM mapping for language: ${language}`);
    }

    const require = createRequire(import.meta.url);
    const wasmsDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
    const wasmPath = path.join(wasmsDir, 'out', wasmFile);

    const loaded = await TSParser.Language.load(wasmPath);
    this.languageCache.set(language, loaded);
    return loaded;
  }

  /**
   * Get the set of AST node types considered "declarations" for a given language.
   * Returns an empty set for unrecognized languages.
   */
  getDeclarationNodeTypes(language: SupportedLanguage): ReadonlySet<string> {
    return DECLARATION_NODE_TYPES.get(language) ?? EMPTY_SET;
  }

  /**
   * Get the list of all supported languages.
   */
  supportedLanguages(): SupportedLanguage[] {
    return [...LANGUAGE_TO_WASM.keys()];
  }
}
