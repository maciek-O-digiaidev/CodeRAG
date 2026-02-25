import { describe, it, expect } from 'vitest';
import { extractKeywords } from './extract-keywords.js';

describe('extractKeywords', () => {
  it('should prefer PascalCase identifiers', () => {
    const result = extractKeywords('Where is the HybridSearch class defined?');
    expect(result).toBe('HybridSearch');
  });

  it('should join multiple identifiers with grep OR', () => {
    const result = extractKeywords('How does HybridSearch use LanceDBStore?');
    expect(result).toBe('HybridSearch\\|LanceDBStore');
  });

  it('should fall back to top keywords when no identifiers', () => {
    const result = extractKeywords('how does embedding work internally?');
    expect(result).toBe('embedding\\|internally');
  });

  it('should remove stop words', () => {
    const result = extractKeywords('what is the config for search?');
    expect(result).toBe('config\\|search');
  });

  it('should filter words shorter than 3 chars', () => {
    const result = extractKeywords('a an is the to by ok at');
    expect(result).toBe('');
  });

  it('should handle camelCase identifiers', () => {
    const result = extractKeywords('find the parseIndexRows function');
    expect(result).toBe('parseIndexRows');
  });

  it('should limit to 3 keywords when no identifiers', () => {
    const result = extractKeywords('embedding vector search index store provider');
    expect(result).toBe('embedding\\|vector\\|search');
  });

  it('should strip punctuation', () => {
    const result = extractKeywords('What does HybridSearch do?');
    expect(result).toBe('HybridSearch');
  });
});
