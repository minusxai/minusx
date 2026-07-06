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

