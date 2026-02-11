import fs from 'fs';
import path from 'path';
import { FileType, UserRole } from '@/lib/types';
import { Mode } from '@/lib/mode/mode-types';
import { resolvePath } from '@/lib/mode/path-resolver';

// Base rule type for extensibility
interface AccessRule {
  type: string;
}

// File type access rule
interface FileTypeAccessRule extends AccessRule {
  type: 'fileTypeAccess';
  role: UserRole;
  allowedTypes: '*' | FileType[];
  createTypes?: '*' | FileType[];
  viewTypes?: '*' | FileType[];
}

// Create location restriction interface
interface CreateLocationRestriction {
  fileTypes: FileType[];
  requiredPathPrefix: string;
  description: string;
}

// Create location restrictions rule
interface CreateLocationRestrictionsRule extends AccessRule {
  type: 'createLocationRestrictions';
  role: '*';
  restrictions: CreateLocationRestriction[];
}

// Creation blocklist rule
interface CreationBlocklistRule extends AccessRule {
  type: 'creationBlocklist';
  role: '*';
  blockedTypes: FileType[];
  reason: string;
}

// Deletion blocklist rule
interface DeletionBlocklistRule extends AccessRule {
  type: 'deletionBlocklist';
  role: '*';
  blockedTypes: FileType[];
  reason: string;
}

// Union of all rule types
type Rule =
  | FileTypeAccessRule
  | CreateLocationRestrictionsRule
  | CreationBlocklistRule
  | DeletionBlocklistRule;

// Rules file structure
interface RulesConfig {
  version: number;
  rules: Rule[];
}

let cachedRules: RulesConfig | null = null;

/**
 * Load access rules from rules.json
 * Rules are cached in production for performance
 * In development mode, rules are reloaded on every call (no cache)
 * Falls back to safe defaults if file is missing
 */
export function loadAccessRules(): RulesConfig {
  // In development, always reload (no cache) for instant updates
  // In production, use cache for performance
  if (cachedRules && process.env.NODE_ENV === 'production') {
    return cachedRules;
  }

  const rulesPath = path.join(process.cwd(), 'rules.json');

  try {
    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
    cachedRules = JSON.parse(rulesContent);
    return cachedRules!;
  } catch (error) {
    console.error('Failed to load access rules, using defaults:', error);
    // Safe defaults if file missing
    const defaultRules: RulesConfig = {
      version: 2,
      rules: [
        { type: 'fileTypeAccess', role: 'admin', allowedTypes: '*' } as FileTypeAccessRule,
        { type: 'fileTypeAccess', role: 'editor', allowedTypes: ['question', 'dashboard', 'folder'] } as FileTypeAccessRule,
        { type: 'fileTypeAccess', role: 'viewer', allowedTypes: ['question', 'dashboard', 'folder'] } as FileTypeAccessRule
      ]
    };
    cachedRules = defaultRules;
    return defaultRules;
  }
}

/**
 * Check if a user can access a specific file type
 * @param role - User's role
 * @param fileType - The file type to check
 * @returns true if user can access the file type
 */
export function canAccessFileType(role: UserRole, fileType: FileType): boolean {
  const config = loadAccessRules();

  // Find the fileTypeAccess rule for this role
  const rule = config.rules.find(
    (r): r is FileTypeAccessRule => r.type === 'fileTypeAccess' && (r as FileTypeAccessRule).role === role
  ) as FileTypeAccessRule | undefined;

  if (!rule) {
    console.log(`[Access Rules] No rule found for role: ${role}`);
    return false;
  }

  if (rule.allowedTypes === '*') {
    return true;
  }

  const hasAccess = rule.allowedTypes.includes(fileType);
  return hasAccess;
}

/**
 * Check if a user can VIEW a specific file type in UI (server-side)
 * Uses viewTypes instead of allowedTypes for UI filtering
 * @param role - User's role
 * @param fileType - The file type to check
 * @returns true if user can view the file type in UI
 */
export function canViewFileType(role: UserRole, fileType: FileType): boolean {
  const config = loadAccessRules();

  // Find the fileTypeAccess rule for this role
  const rule = config.rules.find(
    (r): r is FileTypeAccessRule => r.type === 'fileTypeAccess' && (r as FileTypeAccessRule).role === role
  ) as FileTypeAccessRule | undefined;

  if (!rule) {
    console.log(`[Access Rules] No rule found for role: ${role}`);
    return false;
  }

  if (rule.viewTypes === '*') {
    return true;
  }

  if (!rule.viewTypes) {
    return false;
  }

  return rule.viewTypes.includes(fileType);
}

/**
 * Get creation location restrictions from rules
 */
export function getCreateLocationRestrictions(): CreateLocationRestriction[] {
  const config = loadAccessRules();
  const rule = config.rules.find((r): r is CreateLocationRestrictionsRule =>
    r.type === 'createLocationRestrictions'
  );
  return rule?.restrictions || [];
}

/**
 * Get creation blocklist from rules
 */
export function getCreationBlocklist(): FileType[] {
  const config = loadAccessRules();
  const rule = config.rules.find((r): r is CreationBlocklistRule =>
    r.type === 'creationBlocklist'
  );
  return rule?.blockedTypes || [];
}

/**
 * Get deletion blocklist from rules
 */
export function getDeletionBlocklist(): FileType[] {
  const config = loadAccessRules();
  const rule = config.rules.find((r): r is DeletionBlocklistRule =>
    r.type === 'deletionBlocklist'
  );
  return rule?.blockedTypes || [];
}

/**
 * Check if a file type can be manually created (API-level check)
 * Returns false if type is in the universal creation blocklist
 */
export function canCreateFileType(type: FileType): boolean {
  const blocklist = getCreationBlocklist();
  return !blocklist.includes(type);
}

/**
 * Check if a file type can be deleted
 */
export function canDeleteFileType(type: FileType): boolean {
  const blocklist = getDeletionBlocklist();
  return !blocklist.includes(type);
}

/**
 * Validate file location for creation (mode-aware)
 * @param type - File type being created
 * @param path - Physical path (already resolved with mode)
 * @param mode - User's current mode (org, tutorial, etc.)
 * @throws Error with user-friendly message if invalid
 */
export function validateFileLocation(type: FileType, path: string, mode: Mode): void {
  const restrictions = getCreateLocationRestrictions();

  for (const restriction of restrictions) {
    if (restriction.fileTypes.includes(type)) {
      // Resolve the prefix with mode (e.g., "/org" with mode "org" → "/org")
      const prefix = resolvePath(mode, restriction.requiredPathPrefix);
      const isInRoot = path === prefix;
      const isInSubfolder = path.startsWith(prefix + '/');

      if (!isInSubfolder || isInRoot) {
        throw new Error(
          `Files of type '${type}' must be created in a subfolder of ${prefix}. ` +
          `Example: ${prefix}/my-folder`
        );
      }
    }
  }
}

/**
 * Check if a file type should show in the Create menu for a role
 * This is purely for UI filtering - API can still create types not in this list
 */
export function canShowInCreateMenu(role: UserRole, type: FileType): boolean {
  const config = loadAccessRules();

  const rule = config.rules.find(
    (r): r is FileTypeAccessRule => r.type === 'fileTypeAccess' && (r as FileTypeAccessRule).role === role
  ) as FileTypeAccessRule | undefined;

  if (!rule) return false;
  if (!rule.createTypes) return false;
  if (rule.createTypes === '*') return true;

  return rule.createTypes.includes(type);
}
