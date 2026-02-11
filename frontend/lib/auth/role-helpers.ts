import { UserRole } from '../types';

/**
 * Check if a user is an admin
 */
export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}

/**
 * Check if a user can edit (admin or editor)
 */
export function canEdit(role: UserRole): boolean {
  return role === 'admin' || role === 'editor';
}

/**
 * Check if a user can only view (viewer)
 */
export function isViewer(role: UserRole): boolean {
  return role === 'viewer';
}

/**
 * Get numeric role priority (higher = more permissions)
 * Useful for role comparisons
 */
export function getRolePriority(role: UserRole): number {
  const priorities: Record<UserRole, number> = {
    'admin': 3,
    'editor': 2,
    'viewer': 1
  };
  return priorities[role];
}

/**
 * Check if role A has equal or higher permissions than role B
 */
export function hasEqualOrHigherRole(roleA: UserRole, roleB: UserRole): boolean {
  return getRolePriority(roleA) >= getRolePriority(roleB);
}
