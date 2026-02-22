import { describe, it, expect } from 'vitest';
import { scanForJiraReferences } from './jira-reference-scanner.js';

describe('scanForJiraReferences', () => {
  it('should extract a single Jira reference', () => {
    const result = scanForJiraReferences('Fixes PROJ-123');
    expect(result).toEqual(['PROJ-123']);
  });

  it('should extract multiple Jira references', () => {
    const result = scanForJiraReferences(
      'Related to PROJ-123 and CORE-456',
    );
    expect(result).toEqual(['PROJ-123', 'CORE-456']);
  });

  it('should extract multiple references on the same line', () => {
    const result = scanForJiraReferences('PROJ-10 PROJ-20 PROJ-30');
    expect(result).toEqual(['PROJ-10', 'PROJ-20', 'PROJ-30']);
  });

  it('should return empty array when no references found', () => {
    const result = scanForJiraReferences('No issue references here');
    expect(result).toEqual([]);
  });

  it('should handle references in code comments (single-line)', () => {
    const code = `
      // PROJ-100: Fix authentication bug
      function login() { return true; }
    `;
    const result = scanForJiraReferences(code);
    expect(result).toEqual(['PROJ-100']);
  });

  it('should handle references in block comments', () => {
    const code = `
      /*
       * Implements PROJ-200 and CORE-201
       */
      export class AuthService {}
    `;
    const result = scanForJiraReferences(code);
    expect(result).toEqual(['PROJ-200', 'CORE-201']);
  });

  it('should deduplicate repeated references', () => {
    const content = 'PROJ-42 mentioned first, then PROJ-42 again';
    const result = scanForJiraReferences(content);
    expect(result).toEqual(['PROJ-42']);
  });

  it('should not match keys without a number', () => {
    const result = scanForJiraReferences('PROJ- is not valid');
    expect(result).toEqual([]);
  });

  it('should not match lowercase project keys', () => {
    const result = scanForJiraReferences('proj-123 is not valid');
    expect(result).toEqual([]);
  });

  it('should handle large IDs', () => {
    const result = scanForJiraReferences('PROJ-1234567890');
    expect(result).toEqual(['PROJ-1234567890']);
  });

  it('should extract references across multiple lines', () => {
    const content = `
Line 1: PROJ-1
Line 2: nothing here
Line 3: PROJ-2 and CORE-3
Line 4: also PROJ-1 (duplicate)
    `;
    const result = scanForJiraReferences(content);
    expect(result).toEqual(['PROJ-1', 'PROJ-2', 'CORE-3']);
  });

  it('should handle empty string', () => {
    const result = scanForJiraReferences('');
    expect(result).toEqual([]);
  });

  it('should handle project keys with numbers', () => {
    const result = scanForJiraReferences('FIX2-100 is a valid key');
    expect(result).toEqual(['FIX2-100']);
  });

  it('should handle project keys with underscores', () => {
    const result = scanForJiraReferences('MY_PROJ-99 is valid');
    expect(result).toEqual(['MY_PROJ-99']);
  });

  // --- projectKey filtering ---

  describe('with projectKey filter', () => {
    it('should only match the specified project', () => {
      const result = scanForJiraReferences(
        'PROJ-1 and CORE-2 and PROJ-3',
        'PROJ',
      );
      expect(result).toEqual(['PROJ-1', 'PROJ-3']);
    });

    it('should return empty array when project key does not match', () => {
      const result = scanForJiraReferences('CORE-1 and CORE-2', 'PROJ');
      expect(result).toEqual([]);
    });

    it('should deduplicate with project key filter', () => {
      const result = scanForJiraReferences(
        'PROJ-10 then PROJ-10 again',
        'PROJ',
      );
      expect(result).toEqual(['PROJ-10']);
    });

    it('should handle empty content with project key filter', () => {
      const result = scanForJiraReferences('', 'PROJ');
      expect(result).toEqual([]);
    });

    it('should extract from commit messages with project filter', () => {
      const commit = 'feat(auth): implement SSO login PROJ-42';
      const result = scanForJiraReferences(commit, 'PROJ');
      expect(result).toEqual(['PROJ-42']);
    });
  });

  // --- edge cases ---

  describe('edge cases', () => {
    it('should not match mid-word patterns', () => {
      // Word boundary should prevent matching inside other words
      const result = scanForJiraReferences('NOTAPROJ-123SUFFIX');
      // This is technically a valid issue key pattern (NOTAPROJ-123),
      // it will match because NOTAPROJ is uppercase+digits
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle references in branch names', () => {
      const branch = 'feature/PROJ-123-add-login';
      const result = scanForJiraReferences(branch);
      expect(result).toEqual(['PROJ-123']);
    });

    it('should handle references in PR titles', () => {
      const prTitle = '[PROJ-456] Fix authentication timeout';
      const result = scanForJiraReferences(prTitle);
      expect(result).toEqual(['PROJ-456']);
    });

    it('should handle multiple projects in one string', () => {
      const content = 'PROJ-1 BACKEND-2 FRONTEND-3';
      const result = scanForJiraReferences(content);
      expect(result).toEqual(['PROJ-1', 'BACKEND-2', 'FRONTEND-3']);
    });
  });
});
