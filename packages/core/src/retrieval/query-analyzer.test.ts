import { describe, it, expect } from 'vitest';
import { QueryAnalyzer } from './query-analyzer.js';
import type { QueryIntent } from './query-analyzer.js';

describe('QueryAnalyzer', () => {
  const analyzer = new QueryAnalyzer();

  describe('analyze returns correct structure', () => {
    it('should return all required fields', () => {
      const result = analyzer.analyze('hello world');

      expect(result).toHaveProperty('originalQuery', 'hello world');
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('suggestedFilters');
      expect(result).toHaveProperty('expandedTerms');
      expect(Array.isArray(result.entities)).toBe(true);
      expect(Array.isArray(result.expandedTerms)).toBe(true);
    });

    it('should preserve the original query string', () => {
      const query = 'where is MyClass defined';
      const result = analyzer.analyze(query);
      expect(result.originalQuery).toBe(query);
    });
  });

  describe('intent detection', () => {
    const intentCases: Array<{ query: string; expected: QueryIntent }> = [
      // find_definition
      { query: 'where is MyClass defined', expected: 'find_definition' },
      { query: 'definition of parseConfig', expected: 'find_definition' },
      { query: 'find definition of HybridSearch', expected: 'find_definition' },
      { query: 'show me the definition', expected: 'find_definition' },
      { query: 'where is MyClass declared', expected: 'find_definition' },
      { query: 'declaration of SearchResult', expected: 'find_definition' },

      // find_usage
      { query: 'who calls parseConfig', expected: 'find_usage' },
      { query: 'usage of DependencyGraph', expected: 'find_usage' },
      { query: 'where is MyClass used', expected: 'find_usage' },
      { query: 'references to SearchResult', expected: 'find_usage' },
      { query: 'callers of initialize', expected: 'find_usage' },
      { query: 'consumers of the API', expected: 'find_usage' },
      { query: 'find usage of handleRequest', expected: 'find_usage' },
      { query: 'used by other modules', expected: 'find_usage' },

      // understand_module
      { query: 'how does HybridSearch work', expected: 'understand_module' },
      { query: 'explain the indexer module', expected: 'understand_module' },
      { query: 'what does parseConfig do', expected: 'understand_module' },
      { query: 'understand the graph module', expected: 'understand_module' },
      { query: 'overview of the embedding system', expected: 'understand_module' },
      { query: 'describe the chunker', expected: 'understand_module' },
      { query: 'how is BM25Index implemented', expected: 'understand_module' },

      // find_similar
      { query: 'similar to HybridSearch', expected: 'find_similar' },
      { query: 'something like parseConfig', expected: 'find_similar' },
      { query: 'alternatives to LanceDB', expected: 'find_similar' },
      { query: 'related to the search module', expected: 'find_similar' },

      // general
      { query: 'search function', expected: 'general' },
      { query: 'what are the main modules', expected: 'general' },
      { query: 'list all functions', expected: 'general' },
    ];

    for (const { query, expected } of intentCases) {
      it(`should detect "${expected}" for: "${query}"`, () => {
        const result = analyzer.analyze(query);
        expect(result.intent).toBe(expected);
      });
    }
  });

  describe('entity extraction', () => {
    it('should extract PascalCase identifiers as class entities', () => {
      const result = analyzer.analyze('find DependencyGraph');
      const classEntities = result.entities.filter((e) => e.type === 'class');
      expect(classEntities).toContainEqual({
        type: 'class',
        value: 'DependencyGraph',
      });
    });

    it('should extract camelCase identifiers as function entities', () => {
      const result = analyzer.analyze('where is parseConfig defined');
      const funcEntities = result.entities.filter((e) => e.type === 'function');
      expect(funcEntities).toContainEqual({
        type: 'function',
        value: 'parseConfig',
      });
    });

    it('should extract file paths as file entities', () => {
      const result = analyzer.analyze('look at src/graph/dependency-graph.ts');
      const fileEntities = result.entities.filter((e) => e.type === 'file');
      expect(fileEntities).toContainEqual({
        type: 'file',
        value: 'src/graph/dependency-graph.ts',
      });
    });

    it('should not extract common English words as entities', () => {
      const result = analyzer.analyze('find the class');
      const entities = result.entities.map((e) => e.value);
      expect(entities).not.toContain('the');
      expect(entities).not.toContain('find');
    });

    it('should deduplicate entities', () => {
      const result = analyzer.analyze('MyClass and MyClass');
      const myClassEntities = result.entities.filter(
        (e) => e.value === 'MyClass',
      );
      expect(myClassEntities).toHaveLength(1);
    });

    it('should extract multiple identifiers', () => {
      const result = analyzer.analyze('MyClass uses parseConfig from HybridSearch');
      expect(result.entities.length).toBeGreaterThanOrEqual(3);
    });

    it('should return empty entities for plain text query', () => {
      const result = analyzer.analyze('search for something');
      // "something" doesn't match PascalCase or camelCase multi-word
      expect(result.entities).toHaveLength(0);
    });
  });

  describe('filter suggestion', () => {
    it('should suggest typescript language filter', () => {
      const result = analyzer.analyze('find typescript functions');
      expect(result.suggestedFilters.languages).toContain('typescript');
    });

    it('should suggest language filter for abbreviated names', () => {
      const result = analyzer.analyze('show me ts classes');
      expect(result.suggestedFilters.languages).toContain('typescript');
    });

    it('should suggest python language filter', () => {
      const result = analyzer.analyze('find python modules');
      expect(result.suggestedFilters.languages).toContain('python');
    });

    it('should suggest chunk type filter for "function"', () => {
      const result = analyzer.analyze('list all functions');
      expect(result.suggestedFilters.chunkTypes).toContain('function');
    });

    it('should suggest chunk type filter for "class"', () => {
      const result = analyzer.analyze('find the class definition');
      expect(result.suggestedFilters.chunkTypes).toContain('class');
    });

    it('should suggest chunk type filter for "interface"', () => {
      const result = analyzer.analyze('show all interfaces');
      expect(result.suggestedFilters.chunkTypes).toContain('interface');
    });

    it('should suggest file path filter', () => {
      const result = analyzer.analyze('look at src/graph/dependency-graph.ts');
      expect(result.suggestedFilters.filePaths).toContain(
        'src/graph/dependency-graph.ts',
      );
    });

    it('should return empty filters when no language or type mentioned', () => {
      const result = analyzer.analyze('hello world');
      expect(result.suggestedFilters.languages).toBeUndefined();
      expect(result.suggestedFilters.chunkTypes).toBeUndefined();
      expect(result.suggestedFilters.filePaths).toBeUndefined();
    });

    it('should detect multiple languages', () => {
      const result = analyzer.analyze('compare typescript and python');
      expect(result.suggestedFilters.languages).toContain('typescript');
      expect(result.suggestedFilters.languages).toContain('python');
    });
  });

  describe('edge cases', () => {
    it('should return general intent for empty string', () => {
      const result = analyzer.analyze('');
      expect(result.intent).toBe('general');
      expect(result.entities).toHaveLength(0);
      expect(result.expandedTerms).toHaveLength(0);
      expect(result.originalQuery).toBe('');
    });

    it('should return general intent for whitespace-only string', () => {
      const result = analyzer.analyze('   \t\n  ');
      expect(result.intent).toBe('general');
      expect(result.entities).toHaveLength(0);
      expect(result.expandedTerms).toHaveLength(0);
    });

    it('should return general intent for oversized string', () => {
      const longQuery = 'a'.repeat(3000);
      const result = analyzer.analyze(longQuery);
      expect(result.intent).toBe('general');
      expect(result.entities).toHaveLength(0);
      expect(result.expandedTerms).toHaveLength(0);
      expect(result.originalQuery).toBe(longQuery);
    });

    it('should handle strings with special regex characters', () => {
      const result = analyzer.analyze('find [MyClass] (deprecated)');
      // Should not throw, should extract MyClass as class entity
      expect(result).toBeDefined();
      const classEntities = result.entities.filter((e) => e.type === 'class');
      expect(classEntities).toContainEqual({
        type: 'class',
        value: 'MyClass',
      });
    });
  });

  describe('term expansion', () => {
    it('should include original query terms', () => {
      const result = analyzer.analyze('search function');
      expect(result.expandedTerms).toContain('search');
      expect(result.expandedTerms).toContain('function');
    });

    it('should expand "test" with related terms', () => {
      const result = analyzer.analyze('test');
      expect(result.expandedTerms).toContain('test');
      expect(result.expandedTerms).toContain('spec');
      expect(result.expandedTerms).toContain('describe');
      expect(result.expandedTerms).toContain('it');
      expect(result.expandedTerms).toContain('expect');
    });

    it('should expand "error" with related terms', () => {
      const result = analyzer.analyze('error handling');
      expect(result.expandedTerms).toContain('error');
      expect(result.expandedTerms).toContain('exception');
      expect(result.expandedTerms).toContain('throw');
      expect(result.expandedTerms).toContain('catch');
    });

    it('should expand "config" with related terms', () => {
      const result = analyzer.analyze('config setup');
      expect(result.expandedTerms).toContain('config');
      expect(result.expandedTerms).toContain('configuration');
      expect(result.expandedTerms).toContain('settings');
    });

    it('should expand "auth" with related terms', () => {
      const result = analyzer.analyze('auth flow');
      expect(result.expandedTerms).toContain('auth');
      expect(result.expandedTerms).toContain('authentication');
      expect(result.expandedTerms).toContain('login');
    });

    it('should expand "database" with related terms', () => {
      const result = analyzer.analyze('database operations');
      expect(result.expandedTerms).toContain('database');
      expect(result.expandedTerms).toContain('db');
      expect(result.expandedTerms).toContain('query');
    });

    it('should not duplicate terms during expansion', () => {
      const result = analyzer.analyze('test spec');
      const testCount = result.expandedTerms.filter((t) => t === 'test').length;
      expect(testCount).toBe(1);
    });

    it('should preserve non-expandable terms', () => {
      const result = analyzer.analyze('foobar baz');
      expect(result.expandedTerms).toContain('foobar');
      expect(result.expandedTerms).toContain('baz');
    });
  });
});
