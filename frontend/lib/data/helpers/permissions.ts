import { DbFile } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { canAccessFileType, canViewFileType } from '@/lib/auth/access-rules';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolvePath, resolveHomeFolderSync } from '@/lib/mode/path-resolver';

/**
 * Check if a user has access to a specific file (path-based, mode-aware)
 * Admin users have access to all files WITHIN THEIR CURRENT MODE
 * Non-admin users (editor/viewer) have access to:
 * - Files in their home folder (resolved with mode)
 * - Files in their user conversation folder (resolved with mode)
 */
export function checkFileAccess(file: DbFile, user: EffectiveUser): boolean {
  // CRITICAL: Enforce mode isolation for ALL users (including admins)
  // Admins in tutorial mode should only see /tutorial/* files
  const modePrefix = `/${user.mode}`;
  const isInCorrectMode = file.path === modePrefix || file.path.startsWith(modePrefix + '/');

  if (!isInCorrectMode) {
    console.log('[Permissions] Access DENIED - file not in current mode:', {
      filePath: file.path,
      currentMode: user.mode,
      expectedPrefix: modePrefix
    });
    return false;
  }

  if (isAdmin(user.role)) {
    return true;
  }

  // Resolve home folder with mode
  // user.home_folder is stored as relative path (e.g., 'sales/team1')
  // Resolve to physical path (e.g., '/org/sales/team1' or '/tutorial/sales/team1')
  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
  const homeAccess = file.path === resolvedHomeFolder || file.path.startsWith(resolvedHomeFolder + '/');

  if (homeAccess) return true;

  // Check user conversation folder access (mode-aware)
  const userId = user.userId?.toString() || user.email;
  const userConversationFolder = resolvePath(user.mode, `/logs/conversations/${userId}`);
  const conversationAccess = file.path.startsWith(userConversationFolder);

  if (conversationAccess) return true;

  console.log('[Permissions] Access DENIED - file not in allowed paths');
  return false;
}

/**
 * Check if user has access to a file type (type-based)
 */
export function checkFileTypeAccess(file: DbFile, user: EffectiveUser): boolean {
  return canAccessFileType(user.role, file.type);
}

/**
 * Check full file access (both path and type)
 */
export function checkFullFileAccess(file: DbFile, user: EffectiveUser): boolean {
  return checkFileAccess(file, user) && checkFileTypeAccess(file, user);
}

/**
 * Filter files by user permissions (path-based)
 * Returns only files the user is authorized to access
 */
export function filterByPermissions(files: DbFile[], user: EffectiveUser): DbFile[] {
  return files.filter(file => checkFileAccess(file, user));
}

/**
 * Filter files by type permissions (type-based)
 */
export function filterByTypePermissions(files: DbFile[], user: EffectiveUser): DbFile[] {
  return files.filter(file => checkFileTypeAccess(file, user));
}

/**
 * Check if path is a system path that non-admins can access
 * System paths: /database/* (connections), /logs/conversations/{userId}/* (user conversations)
 *
 * @param path - File path to check
 * @param user - Effective user
 * @returns true if path is accessible system path, false otherwise
 */
function isAccessibleSystemPath(path: string, user: EffectiveUser): boolean {
  // Database connections (read-only access for all users)
  const databaseFolder = resolvePath(user.mode, '/database');
  if (path === databaseFolder || path.startsWith(databaseFolder + '/')) {
    return true;
  }

  // User's conversation folder (already implemented)
  const userId = user.userId?.toString() || user.email;
  const userConversationFolder = resolvePath(user.mode, `/logs/conversations/${userId}`);
  if (path.startsWith(userConversationFolder)) {
    return true;
  }

  return false;
}

/**
 * Check if a context file is an ancestor of the user's home folder
 * Non-admins need access to ancestor contexts for hierarchical schema filtering
 *
 * Example: User with home_folder=/org/sales needs access to /org/context
 *
 * @param file - The file to check
 * @param user - Effective user
 * @returns true if file is an ancestor context, false otherwise
 */
function isAncestorContext(file: DbFile, user: EffectiveUser): boolean {
  // Only applies to context files
  if (file.type !== 'context') {
    return false;
  }

  // Only for non-admins with home folder
  if (!user.home_folder) {
    return false;
  }

  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);

  // Check if context path is an ancestor of home folder
  // e.g., /org/context is ancestor of /org/sales
  // The home folder must start with the context's directory
  const contextDir = file.path.substring(0, file.path.lastIndexOf('/'));

  // Check if home folder is at or under the context's directory
  // e.g., /org/sales starts with /org/ (ancestor), or /org equals /org (at root)
  return resolvedHomeFolder === contextDir || resolvedHomeFolder.startsWith(contextDir + '/');
}

/**
 * Unified access check - combines type + path + mode checks (Phase 4)
 * Replaces: canAccessFileType() + checkFileAccess()
 *
 * Checks in order:
 * 1. Type access (role-based)
 * 2. Mode isolation (all users)
 * 3. Path access (admin = full in mode, non-admin = home folder)
 *
 * @param file - The file to check access for
 * @param user - The effective user
 * @returns true if user can access file, false otherwise
 */
export function canAccessFile(file: DbFile, user: EffectiveUser): boolean {
  // Step 1: Type check (role-based)
  if (!canAccessFileType(user.role, file.type)) {
    console.log('[Permissions] Access DENIED - user role cannot access file type:', {
      role: user.role,
      fileType: file.type
    });
    return false;
  }

  // Step 2: Mode isolation (all users)
  const modePrefix = `/${user.mode}`;
  if (!file.path.startsWith(modePrefix + '/') && file.path !== modePrefix) {
    console.log('[Permissions] Access DENIED - file not in current mode:', {
      filePath: file.path,
      currentMode: user.mode,
      expectedPrefix: modePrefix
    });
    return false;
  }

  // Step 3: Path check (admins = full access in mode, non-admins = home folder)
  if (isAdmin(user.role)) {
    return true;
  }

  // Non-admin: Check home folder access
  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
  const homeAccess = file.path === resolvedHomeFolder || file.path.startsWith(resolvedHomeFolder + '/');

  if (homeAccess) {
    return true;
  }

  // Non-admin: Check system path access (database, user conversations)
  if (isAccessibleSystemPath(file.path, user)) {
    return true;
  }

  // Non-admin: Check ancestor context access (for hierarchical filtering)
  if (isAncestorContext(file, user)) {
    return true;
  }

  console.log('[Permissions] Access DENIED - file not in allowed paths');
  return false;
}

/**
 * Check if user can VIEW a file in UI (search, folder browser)
 * Same as canAccessFile() but also checks viewTypes for UI filtering
 *
 * Use this for:
 * - Search results
 * - Folder browser listings  
 * - Any UI that shows files to users
 *
 * Do NOT use for:
 * - Loading referenced files (dashboard → questions)
 * - Loading ancestor contexts
 * - API operations that need full access
 */
export function canViewFileInUI(file: DbFile, user: EffectiveUser): boolean {
  // First check full access permissions
  if (!canAccessFile(file, user)) {
    return false;
  }

  // Then check UI visibility (viewTypes)
  if (!canViewFileType(user.role, file.type)) {
    console.log('[Permissions] View DENIED - user role cannot view file type in UI:', {
      role: user.role,
      fileType: file.type
    });
    return false;
  }

  return true;
}
