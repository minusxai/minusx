import { DbFile } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolvePath, resolveHomeFolderSync, isUnderSystemFolder } from '@/lib/mode/path-resolver';
import type { Mode } from '@/lib/mode/mode-types';
import type { AccessRulesOverride } from '@/lib/branding/whitelabel';
import { resolveAccessPredicate } from '@/lib/auth/access-resolver';
import { checkAccess } from '@/lib/auth/access-predicate';

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
    return false;
  }

  if (isAdmin(user.role)) {
    return true;
  }

  // Resolve home folder with mode
  // user.home_folder is stored as relative path (e.g., 'sales/team1')
  // Resolve to physical path (e.g., '/org/sales/team1' or '/tutorial/sales/team1')
  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
  const homeAccess =
    (file.path === resolvedHomeFolder || file.path.startsWith(resolvedHomeFolder + '/'))
    && !isUnderSystemFolder(file.path, user.mode as Mode);

  if (homeAccess) return true;

  // Check user conversation folder access (mode-aware)
  const userId = user.userId?.toString() || user.email;
  const userConversationFolder = resolvePath(user.mode, `/logs/conversations/${userId}`);
  const conversationAccess = file.path.startsWith(userConversationFolder);

  if (conversationAccess) return true;

  return false;
}

/**
 * Unified access check — combines type + path + mode checks.
 *
 * Access V2: this now delegates to the single `AccessPredicate` engine
 * (`resolveAccessPredicate` + `checkAccess`), so the in-memory decision and the
 * SQL-compiled decision (M1b) share one source of truth. Behavior is unchanged
 * — guarded by the differential battery in `lib/auth/__tests__/access-predicate.test.ts`.
 *
 * @param file - The file to check access for
 * @param user - The effective user
 * @returns true if user can access file, false otherwise
 */
export function canAccessFile(file: DbFile, user: EffectiveUser, overrides?: AccessRulesOverride): boolean {
  return checkAccess(file, resolveAccessPredicate(user, overrides), 'access');
}

/**
 * Check if user can VIEW a file in UI (search, folder browser) — `canAccessFile`
 * plus the `viewTypes` gate. Delegates to the `AccessPredicate` engine.
 *
 * Use for: search results, folder browser listings, any UI that shows files.
 * Do NOT use for: loading referenced files, ancestor contexts, or API operations
 * that need full access (use `canAccessFile` / the `embedded` variant).
 */
export function canViewFileInUI(file: DbFile, user: EffectiveUser, overrides?: AccessRulesOverride): boolean {
  return checkAccess(file, resolveAccessPredicate(user, overrides), 'ui');
}
