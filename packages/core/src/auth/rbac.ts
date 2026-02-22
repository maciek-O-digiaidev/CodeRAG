import type { Action, Role, User } from './types.js';
import type { SearchResult } from '../types/search.js';
import { ROLE_HIERARCHY } from './types.js';

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------

/**
 * Maps each role to the set of actions it may perform.
 *
 * Role hierarchy is **additive** — a higher role inherits all permissions of
 * lower roles.  The matrix is kept explicit so callers can inspect it without
 * understanding hierarchy logic.
 */
const ROLE_ACTIONS: Readonly<Record<Role, ReadonlySet<Action>>> = {
  viewer: new Set<Action>(['search', 'context', 'status']),
  developer: new Set<Action>(['search', 'context', 'status', 'explain', 'docs']),
  admin: new Set<Action>(['search', 'context', 'status', 'explain', 'docs', 'index', 'configure']),
};

// ---------------------------------------------------------------------------
// RBACManager
// ---------------------------------------------------------------------------

export class RBACManager {
  /**
   * Returns `true` when at least one of the user's roles permits `action`.
   */
  hasPermission(user: User, action: Action): boolean {
    return user.roles.some((role) => {
      const allowed = ROLE_ACTIONS[role];
      return allowed !== undefined && allowed.has(action);
    });
  }

  /**
   * Returns `true` when the user's `allowedRepos` list contains `repoName`.
   *
   * Admin users with an empty `allowedRepos` list are granted access to every
   * repository (convention: empty list = unrestricted for admins).
   */
  canAccessRepo(user: User, repoName: string): boolean {
    // Admins with an empty allowedRepos list have unrestricted access.
    if (user.roles.includes('admin') && user.allowedRepos.length === 0) {
      return true;
    }
    return user.allowedRepos.includes(repoName);
  }

  /**
   * Filters search results so the user only sees chunks from repos they can
   * access.  Results without a `repoName` in metadata are kept (they belong
   * to the default / single-repo setup).
   */
  filterResultsByAccess(user: User, results: readonly SearchResult[]): readonly SearchResult[] {
    return results.filter((result) => {
      const repoName = result.metadata.repoName;
      if (repoName === undefined) {
        return true; // single-repo mode — no filtering needed
      }
      return this.canAccessRepo(user, repoName);
    });
  }

  /**
   * Returns the effective privilege level of a role (higher = more access).
   */
  getRoleLevel(role: Role): number {
    return ROLE_HIERARCHY.indexOf(role);
  }

  /**
   * Returns the highest-privilege role the user holds.
   */
  getHighestRole(user: User): Role {
    let highest: Role = 'viewer';
    for (const role of user.roles) {
      if (this.getRoleLevel(role) > this.getRoleLevel(highest)) {
        highest = role;
      }
    }
    return highest;
  }
}
