'use client';

import { useMemo } from 'react';
import { FileType, UserRole } from '@/lib/types';
import rulesConfig from '@/rules.json';
import type { AccessRulesOverride } from '@/lib/branding/whitelabel';
import { useAppSelector } from '@/store/hooks';
import { selectConfig } from '@/store/configsSlice';

/**
 * Get the effective rule for a role, applying config-based overrides.
 * Each override field completely replaces the corresponding rules.json default.
 */
function getEffectiveRule(role: UserRole, overrides?: AccessRulesOverride) {
  const rule = rulesConfig.rules.find(
    (r: any) => r.type === 'fileTypeAccess' && r.role === role
  );

  if (!rule || !overrides?.[role]) {
    return rule;
  }

  const roleOverride = overrides[role];
  return {
    ...rule,
    ...(roleOverride.allowedTypes !== undefined && { allowedTypes: roleOverride.allowedTypes }),
    ...(roleOverride.createTypes !== undefined && { createTypes: roleOverride.createTypes }),
    ...(roleOverride.viewTypes !== undefined && { viewTypes: roleOverride.viewTypes }),
  };
}

/**
 * Check if a user can access a specific file type (client-side)
 * @param role - User's role
 * @param fileType - The file type to check
 * @param overrides - Optional per-company access rules overrides
 * @returns true if user can access the file type
 */
export function canAccessFileType(role: UserRole, fileType: FileType, overrides?: AccessRulesOverride): boolean {
  const rule = getEffectiveRule(role, overrides);

  if (!rule) return false;
  if (rule.allowedTypes === '*') return true;
  return (rule.allowedTypes as FileType[]).includes(fileType);
}

export function canViewFileType(role: UserRole, fileType: FileType, overrides?: AccessRulesOverride): boolean {
  const rule = getEffectiveRule(role, overrides);

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
 * @param overrides - Optional per-company access rules overrides
 */
export function canShowInCreateMenu(role: UserRole, type: FileType, overrides?: AccessRulesOverride): boolean {
  const rule = getEffectiveRule(role, overrides);

  if (!rule) return false;
  if (!rule.createTypes) return false;

  const createTypes = rule.createTypes;
  if (typeof createTypes === 'string' && createTypes === '*') return true;
  if (Array.isArray(createTypes)) {
    return (createTypes as FileType[]).includes(type);
  }

  return false;
}

/**
 * Hook that returns access rule functions bound to the current company's config overrides.
 * Reads accessRules from the Redux config store.
 */
export function useAccessRules() {
  const config = useAppSelector(selectConfig);
  const overrides = config.accessRules;

  return useMemo(() => ({
    canAccessFileType: (role: UserRole, fileType: FileType) =>
      canAccessFileType(role, fileType, overrides),
    canViewFileType: (role: UserRole, fileType: FileType) =>
      canViewFileType(role, fileType, overrides),
    canShowInCreateMenu: (role: UserRole, type: FileType) =>
      canShowInCreateMenu(role, type, overrides),
    canDeleteFileType,
    canCreateFileType,
  }), [overrides]);
}
