'use client';

import { FileType, UserRole } from '@/lib/types';
import rulesConfig from '@/rules.json';

/**
 * Check if a user can access a specific file type (client-side)
 * Reads directly from rules.json
 * @param role - User's role
 * @param fileType - The file type to check
 * @returns true if user can access the file type
 */
export function canAccessFileType(role: UserRole, fileType: FileType): boolean {
  // Find the fileTypeAccess rule for this role
  const rule = rulesConfig.rules.find(
    (r: any) => r.type === 'fileTypeAccess' && r.role === role
  );

  if (!rule) return false;
  if (rule.allowedTypes === '*') return true;
  return (rule.allowedTypes as FileType[]).includes(fileType);
}

export function canViewFileType(role: UserRole, fileType: FileType): boolean {
  // Find the fileTypeAccess rule for this role
  const rule = rulesConfig.rules.find(
    (r: any) => r.type === 'fileTypeAccess' && r.role === role
  );

  if (!rule) return false;
  if (rule.viewTypes === '*') return true;
  return (rule.viewTypes as FileType[]).includes(fileType);
}

/**
 * Get creation blocklist from rules (client-side)
 */
export function getCreationBlocklist(): FileType[] {
  const rule = rulesConfig.rules.find(
    (r: any) => r.type === 'creationBlocklist'
  );
  return (rule?.blockedTypes as FileType[]) || [];
}

/**
 * Get deletion blocklist from rules (client-side)
 */
export function getDeletionBlocklist(): FileType[] {
  const rule = rulesConfig.rules.find(
    (r: any) => r.type === 'deletionBlocklist'
  );
  return (rule?.blockedTypes as FileType[]) || [];
}

/**
 * Check if a file type can be manually created (client-side)
 */
export function canCreateFileType(type: FileType): boolean {
  const blocklist = getCreationBlocklist();
  return !blocklist.includes(type);
}

/**
 * Check if a file type can be deleted (client-side)
 */
export function canDeleteFileType(type: FileType): boolean {
  const blocklist = getDeletionBlocklist();
  return !blocklist.includes(type);
}

/**
 * Check if a file type should show in the Create menu for a role (client-side)
 * This is purely for UI filtering - API can still create types not in this list
 */
export function canShowInCreateMenu(role: UserRole, type: FileType): boolean {
  const rule = rulesConfig.rules.find(
    (r: any) => r.type === 'fileTypeAccess' && r.role === role
  );

  if (!rule) return false;
  if (!rule.createTypes) return false;

  const createTypes = rule.createTypes;
  if (typeof createTypes === 'string' && createTypes === '*') return true;
  if (Array.isArray(createTypes)) {
    return (createTypes as FileType[]).includes(type);
  }

  return false;
}
