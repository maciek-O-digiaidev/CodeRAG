import type { SearchFilters, ChunkType } from '../types/index.js';

export type QueryIntent =
  | 'find_definition'
  | 'find_usage'
  | 'understand_module'
  | 'find_similar'
  | 'general';

export interface QueryEntity {
  type: 'function' | 'class' | 'module' | 'file' | 'concept';
  value: string;
}

export interface AnalyzedQuery {
  originalQuery: string;
  intent: QueryIntent;
  entities: QueryEntity[];
  suggestedFilters: SearchFilters;
  expandedTerms: string[];
}

const MAX_QUERY_LENGTH = 2000;

/** Pattern-based definitions for intent detection. */
const INTENT_PATTERNS: ReadonlyArray<{
  intent: QueryIntent;
  patterns: RegExp[];
}> = [
  {
    intent: 'find_definition',
    patterns: [
      /where\s+is\s+\S+\s+defined/i,
      /definition\s+of/i,
      /find\s+definition/i,
      /define[ds]?\s/i,
      /declaration\s+of/i,
      /where\s+is\s+\S+\s+declared/i,
      /show\s+(me\s+)?(the\s+)?definition/i,
    ],
  },
  {
    intent: 'find_usage',
    patterns: [
      /who\s+calls/i,
      /usage\s+of/i,
      /used\s+by/i,
      /references?\s+to/i,
      /callers?\s+of/i,
      /where\s+is\s+\S+\s+used/i,
      /find\s+usage/i,
      /consumers?\s+of/i,
    ],
  },
  {
    intent: 'understand_module',
    patterns: [
      /how\s+does\s+\S+\s+work/i,
      /explain\s/i,
      /what\s+does\s+\S+\s+do/i,
      /understand\s/i,
      /overview\s+of/i,
      /describe\s/i,
      /how\s+is\s+\S+\s+implemented/i,
    ],
  },
  {
    intent: 'find_similar',
    patterns: [
      /similar\s+to/i,
      /like\s+\S+/i,
      /resembl/i,
      /alternatives?\s+(to|for)/i,
      /related\s+to/i,
    ],
  },
];

/** Well-known term expansion map. */
const TERM_EXPANSIONS: ReadonlyMap<string, string[]> = new Map([
  ['test', ['test', 'spec', 'describe', 'it', 'expect', 'assert']],
  ['error', ['error', 'exception', 'throw', 'catch', 'fail']],
  ['config', ['config', 'configuration', 'settings', 'options', 'preferences']],
  ['auth', ['auth', 'authentication', 'authorization', 'login', 'session', 'token']],
  ['api', ['api', 'endpoint', 'route', 'handler', 'controller']],
  ['database', ['database', 'db', 'query', 'schema', 'migration', 'model']],
  ['log', ['log', 'logger', 'logging', 'debug', 'trace']],
  ['import', ['import', 'require', 'dependency', 'module']],
  ['export', ['export', 'module', 'public']],
  ['type', ['type', 'interface', 'typedef', 'schema']],
  ['async', ['async', 'await', 'promise', 'callback']],
  ['render', ['render', 'component', 'template', 'view']],
]);

/** Known language keywords for filter detection. */
const LANGUAGE_KEYWORDS: ReadonlyMap<string, string> = new Map([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['javascript', 'javascript'],
  ['js', 'javascript'],
  ['python', 'python'],
  ['py', 'python'],
  ['rust', 'rust'],
  ['go', 'go'],
  ['java', 'java'],
  ['c#', 'csharp'],
  ['csharp', 'csharp'],
]);

/** Known chunk type keywords for filter detection. */
const CHUNK_TYPE_KEYWORDS: ReadonlyMap<string, ChunkType> = new Map([
  ['function', 'function'],
  ['functions', 'function'],
  ['method', 'method'],
  ['methods', 'method'],
  ['class', 'class'],
  ['classes', 'class'],
  ['interface', 'interface'],
  ['interfaces', 'interface'],
  ['type', 'type_alias'],
  ['types', 'type_alias'],
  ['module', 'module'],
  ['modules', 'module'],
]);

/** Regex to detect PascalCase or camelCase identifiers (no /g — use findAll). */
const IDENTIFIER_RE = /\b([A-Z][a-zA-Z0-9]*(?:[A-Z][a-z0-9]*)*|[a-z][a-zA-Z0-9]*(?:[A-Z][a-z0-9]*)+)\b/;

/** Regex to detect file paths (no /g — use findAll). */
const FILE_PATH_RE = /(?:[\w./-]+\/[\w.-]+\.[\w]+)/;

/** Common English words that should not be extracted as entities. */
const COMMON_WORDS = new Set([
  'is', 'the', 'in', 'of', 'to', 'and', 'or', 'for', 'by',
  'it', 'be', 'do', 'an', 'as', 'at', 'if', 'on', 'no',
  'not', 'but', 'with', 'that', 'this', 'from', 'are', 'was',
  'has', 'had', 'have', 'how', 'what', 'when', 'where', 'who',
  'which', 'all', 'can', 'will', 'one', 'its', 'into', 'been',
  'like', 'does', 'used', 'find', 'show', 'get', 'set',
]);

/** Safe matchAll that creates a fresh /g regex per call, avoiding stateful lastIndex. */
function findAll(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(new RegExp(pattern.source, 'g'))].map((m) => m[0]);
}

export class QueryAnalyzer {
  /**
   * Pattern-based query understanding. Analyzes a natural language query
   * to detect intent, extract entities, suggest filters, and expand terms.
   * This is a pure function (no LLM needed).
   */
  analyze(query: string): AnalyzedQuery {
    const trimmed = query.trim();

    if (trimmed.length === 0 || trimmed.length > MAX_QUERY_LENGTH) {
      return {
        originalQuery: query,
        intent: 'general',
        entities: [],
        suggestedFilters: {},
        expandedTerms: [],
      };
    }

    const intent = this.detectIntent(trimmed);
    const entities = this.extractEntities(trimmed);
    const suggestedFilters = this.suggestFilters(trimmed);
    const expandedTerms = this.expandTerms(trimmed);

    return {
      originalQuery: query,
      intent,
      entities,
      suggestedFilters,
      expandedTerms,
    };
  }

  /** Detect the user's intent based on pattern matching. */
  private detectIntent(query: string): QueryIntent {
    for (const { intent, patterns } of INTENT_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(query)) {
          return intent;
        }
      }
    }
    return 'general';
  }

  /** Extract named entities (functions, classes, files, modules, concepts) from the query. */
  private extractEntities(query: string): QueryEntity[] {
    const entities: QueryEntity[] = [];
    const seen = new Set<string>();

    // Extract file paths
    const filePaths = findAll(query, FILE_PATH_RE);
    for (const fp of filePaths) {
      if (!seen.has(fp)) {
        seen.add(fp);
        entities.push({ type: 'file', value: fp });
      }
    }

    // Extract PascalCase / camelCase identifiers
    const identifiers = findAll(query, IDENTIFIER_RE);
    for (const id of identifiers) {
      if (seen.has(id)) continue;

      // Skip common English words that happen to match the regex
      if (isCommonWord(id)) continue;

      seen.add(id);

      // PascalCase starting with uppercase = likely class
      if (/^[A-Z]/.test(id)) {
        entities.push({ type: 'class', value: id });
      } else {
        // camelCase starting with lowercase = likely function
        entities.push({ type: 'function', value: id });
      }
    }

    return entities;
  }

  /** Suggest search filters based on language/chunk type mentions in the query. */
  private suggestFilters(query: string): SearchFilters {
    const filters: SearchFilters = {};
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(/\s+/);

    // Detect language mentions
    const languages: string[] = [];
    for (const word of words) {
      const lang = LANGUAGE_KEYWORDS.get(word);
      if (lang && !languages.includes(lang)) {
        languages.push(lang);
      }
    }
    if (languages.length > 0) {
      filters.languages = languages;
    }

    // Detect chunk type mentions
    const chunkTypes: ChunkType[] = [];
    for (const word of words) {
      const ct = CHUNK_TYPE_KEYWORDS.get(word);
      if (ct && !chunkTypes.includes(ct)) {
        chunkTypes.push(ct);
      }
    }
    if (chunkTypes.length > 0) {
      filters.chunkTypes = chunkTypes;
    }

    // Detect file paths
    const filePaths = findAll(query, FILE_PATH_RE);
    if (filePaths.length > 0) {
      filters.filePaths = [...new Set(filePaths)];
    }

    return filters;
  }

  /** Expand query terms with related synonyms / domain terms. */
  private expandTerms(query: string): string[] {
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(/\s+/).filter((w) => w.length > 0);
    const expanded = new Set<string>(words);

    for (const word of words) {
      const expansions = TERM_EXPANSIONS.get(word);
      if (expansions) {
        for (const term of expansions) {
          expanded.add(term);
        }
      }
    }

    return [...expanded];
  }
}

/** Check if a word is a common English word that should not be an entity. */
function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase());
}
