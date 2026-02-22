import { describe, it, expect } from 'vitest';
import { RBACManager } from './rbac.js';
import type { User, Action } from './types.js';
import type { SearchResult } from '../types/search.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createUser(overrides?: Partial<User>): User {
  return {
    id: 'user-1',
    email: 'dev@example.com',
    name: 'Test User',
    roles: ['viewer'],
    allowedRepos: ['repo-a', 'repo-b'],
    ...overrides,
  };
}

function createSearchResult(repoName?: string): SearchResult {
  return {
    chunkId: 'chunk-1',
    content: 'function foo() {}',
    nlSummary: 'A function named foo',
    score: 0.95,
    method: 'hybrid',
    metadata: {
      chunkType: 'function',
      name: 'foo',
      declarations: [],
      imports: [],
      exports: [],
      repoName,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RBACManager', () => {
  const rbac = new RBACManager();

  // -----------------------------------------------------------------------
  // hasPermission
  // -----------------------------------------------------------------------

  describe('hasPermission', () => {
    it('should allow viewer to search', () => {
      const user = createUser({ roles: ['viewer'] });
      expect(rbac.hasPermission(user, 'search')).toBe(true);
    });

    it('should allow viewer to access context', () => {
      const user = createUser({ roles: ['viewer'] });
      expect(rbac.hasPermission(user, 'context')).toBe(true);
    });

    it('should allow viewer to access status', () => {
      const user = createUser({ roles: ['viewer'] });
      expect(rbac.hasPermission(user, 'status')).toBe(true);
    });

    it('should deny viewer from explain', () => {
      const user = createUser({ roles: ['viewer'] });
      expect(rbac.hasPermission(user, 'explain')).toBe(false);
    });

    it('should deny viewer from docs', () => {
      const user = createUser({ roles: ['viewer'] });
      expect(rbac.hasPermission(user, 'docs')).toBe(false);
    });

    it('should deny viewer from index', () => {
      const user = createUser({ roles: ['viewer'] });
      expect(rbac.hasPermission(user, 'index')).toBe(false);
    });

    it('should deny viewer from configure', () => {
      const user = createUser({ roles: ['viewer'] });
      expect(rbac.hasPermission(user, 'configure')).toBe(false);
    });

    it('should allow developer to explain', () => {
      const user = createUser({ roles: ['developer'] });
      expect(rbac.hasPermission(user, 'explain')).toBe(true);
    });

    it('should allow developer to access docs', () => {
      const user = createUser({ roles: ['developer'] });
      expect(rbac.hasPermission(user, 'docs')).toBe(true);
    });

    it('should deny developer from index', () => {
      const user = createUser({ roles: ['developer'] });
      expect(rbac.hasPermission(user, 'index')).toBe(false);
    });

    it('should deny developer from configure', () => {
      const user = createUser({ roles: ['developer'] });
      expect(rbac.hasPermission(user, 'configure')).toBe(false);
    });

    it('should allow admin to perform all actions', () => {
      const user = createUser({ roles: ['admin'] });
      const allActions: Action[] = [
        'search', 'context', 'status', 'explain', 'docs', 'index', 'configure',
      ];
      for (const action of allActions) {
        expect(rbac.hasPermission(user, action)).toBe(true);
      }
    });

    it('should allow action if any role permits it', () => {
      const user = createUser({ roles: ['viewer', 'developer'] });
      expect(rbac.hasPermission(user, 'explain')).toBe(true);
    });

    it('should deny action if no role permits it', () => {
      const user = createUser({ roles: ['viewer', 'developer'] });
      expect(rbac.hasPermission(user, 'index')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // canAccessRepo
  // -----------------------------------------------------------------------

  describe('canAccessRepo', () => {
    it('should allow access when repo is in allowedRepos', () => {
      const user = createUser({ allowedRepos: ['repo-a', 'repo-b'] });
      expect(rbac.canAccessRepo(user, 'repo-a')).toBe(true);
    });

    it('should deny access when repo is not in allowedRepos', () => {
      const user = createUser({ allowedRepos: ['repo-a'] });
      expect(rbac.canAccessRepo(user, 'repo-c')).toBe(false);
    });

    it('should grant admin with empty allowedRepos access to all repos', () => {
      const user = createUser({ roles: ['admin'], allowedRepos: [] });
      expect(rbac.canAccessRepo(user, 'any-repo')).toBe(true);
    });

    it('should restrict non-admin with empty allowedRepos', () => {
      const user = createUser({ roles: ['viewer'], allowedRepos: [] });
      expect(rbac.canAccessRepo(user, 'any-repo')).toBe(false);
    });

    it('should restrict admin with explicit allowedRepos to those repos', () => {
      const user = createUser({
        roles: ['admin'],
        allowedRepos: ['repo-x'],
      });
      expect(rbac.canAccessRepo(user, 'repo-x')).toBe(true);
      expect(rbac.canAccessRepo(user, 'repo-y')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // filterResultsByAccess
  // -----------------------------------------------------------------------

  describe('filterResultsByAccess', () => {
    it('should keep results from allowed repos', () => {
      const user = createUser({ allowedRepos: ['repo-a'] });
      const results = [
        createSearchResult('repo-a'),
        createSearchResult('repo-b'),
      ];
      const filtered = rbac.filterResultsByAccess(user, results);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.metadata.repoName).toBe('repo-a');
    });

    it('should keep results without repoName (single-repo mode)', () => {
      const user = createUser({ allowedRepos: ['repo-a'] });
      const results = [
        createSearchResult(undefined),
        createSearchResult('repo-b'),
      ];
      const filtered = rbac.filterResultsByAccess(user, results);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.metadata.repoName).toBeUndefined();
    });

    it('should return all results for admin with empty allowedRepos', () => {
      const user = createUser({ roles: ['admin'], allowedRepos: [] });
      const results = [
        createSearchResult('repo-a'),
        createSearchResult('repo-b'),
        createSearchResult('repo-c'),
      ];
      const filtered = rbac.filterResultsByAccess(user, results);
      expect(filtered).toHaveLength(3);
    });

    it('should return empty array when no results match', () => {
      const user = createUser({ allowedRepos: ['repo-x'] });
      const results = [
        createSearchResult('repo-a'),
        createSearchResult('repo-b'),
      ];
      const filtered = rbac.filterResultsByAccess(user, results);
      expect(filtered).toHaveLength(0);
    });

    it('should not mutate the original results array', () => {
      const user = createUser({ allowedRepos: ['repo-a'] });
      const results = [
        createSearchResult('repo-a'),
        createSearchResult('repo-b'),
      ];
      const originalLength = results.length;
      rbac.filterResultsByAccess(user, results);
      expect(results).toHaveLength(originalLength);
    });
  });

  // -----------------------------------------------------------------------
  // getRoleLevel & getHighestRole
  // -----------------------------------------------------------------------

  describe('getRoleLevel', () => {
    it('should return 0 for viewer', () => {
      expect(rbac.getRoleLevel('viewer')).toBe(0);
    });

    it('should return 1 for developer', () => {
      expect(rbac.getRoleLevel('developer')).toBe(1);
    });

    it('should return 2 for admin', () => {
      expect(rbac.getRoleLevel('admin')).toBe(2);
    });

    it('should maintain hierarchy ordering', () => {
      expect(rbac.getRoleLevel('admin')).toBeGreaterThan(rbac.getRoleLevel('developer'));
      expect(rbac.getRoleLevel('developer')).toBeGreaterThan(rbac.getRoleLevel('viewer'));
    });
  });

  describe('getHighestRole', () => {
    it('should return admin when user has admin role', () => {
      const user = createUser({ roles: ['viewer', 'admin'] });
      expect(rbac.getHighestRole(user)).toBe('admin');
    });

    it('should return developer when user has developer but not admin', () => {
      const user = createUser({ roles: ['viewer', 'developer'] });
      expect(rbac.getHighestRole(user)).toBe('developer');
    });

    it('should return viewer when that is the only role', () => {
      const user = createUser({ roles: ['viewer'] });
      expect(rbac.getHighestRole(user)).toBe('viewer');
    });

    it('should return admin when all roles are present', () => {
      const user = createUser({ roles: ['viewer', 'developer', 'admin'] });
      expect(rbac.getHighestRole(user)).toBe('admin');
    });
  });
});
