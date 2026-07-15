/**
 * Access V2 — resolve an `EffectiveUser` (+ config overrides) into an
 * `AccessPredicate`. Server-side: reads the role rules (`getEffectiveRule` →
 * `rules.json`) and resolves mode-relative paths. The pure `checkAccess`
 * evaluator (`access-predicate.ts`) consumes the result.
 *
 * M1a reproduces today's `canAccessFile`/`canViewFileInUI` inputs exactly. In
 * M2 this gains group memberships as additional scopes; nothing downstream of
 * the `AccessPredicate` changes.
 */
import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { AccessRulesOverride } from '@/lib/branding/whitelabel';
import { getEffectiveRule } from '@/lib/auth/access-rules';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolvePath, resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { AccessPredicate, AccessScope, TypeSet } from '@/lib/auth/access-predicate';

/** Resolve a principal's access snapshot. Mirrors today's `canAccessFile` inputs. */
export function resolveAccessPredicate(user: EffectiveUser, overrides?: AccessRulesOverride): AccessPredicate {
  const admin = isAdmin(user.role);
  const rule = getEffectiveRule(user.role, overrides);

  // Fallbacks match the legacy type checks exactly:
  //   canAccessFileType: no rule → false        → allowedTypes = []
  //   canViewFileType:   '*' → true, missing → false, else includes → [] when missing
  const allowedTypes: TypeSet = rule ? rule.allowedTypes : [];
  const viewTypes: TypeSet = rule?.viewTypes ?? [];

  // Legacy resolves the home folder even when home_folder is '' (→ mode root).
  const homeFolder = resolveHomeFolderSync(user.mode, user.home_folder);
  const userId = user.userId?.toString() || user.email;

  const scopes: AccessScope[] = admin ? [] : [
    { path: homeFolder, excludeSystem: true },
    { path: resolvePath(user.mode, '/database') },
    { path: resolvePath(user.mode, `/logs/conversations/${userId}`), matchRaw: true },
    { path: resolvePath(user.mode, '/logs/runs') },
  ];

  return {
    admin,
    mode: user.mode,
    allowedTypes,
    viewTypes,
    scopes,
    homeFolder: admin ? null : homeFolder,
  };
}
