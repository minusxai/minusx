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
import { resolveUserGroupGrants } from '@/lib/data/groups.server';

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

  // Base grant from the user's role (the seed group). M2 appends group grants.
  return {
    admin,
    mode: user.mode,
    grants: [{ allowedTypes, scopes }],
    viewTypes,
    homeFolder: admin ? null : homeFolder,
  };
}

/**
 * Group-aware resolution: the base (role + home) predicate plus any group
 * grants the user has. Async because group memberships are a DB read. When the
 * user is in no groups — the common case, and every guest — this equals the
 * base predicate, so behavior is unchanged until a group is populated. Admins
 * already bypass path scoping, so their group grants are moot (skipped).
 *
 * Data-layer reads that need group-aware access resolve this ONCE per request
 * and evaluate `checkAccess` per file; the sync `resolveAccessPredicate` above
 * stays for per-file helpers that must remain synchronous.
 */
export async function resolveAccessPredicateWithGroups(
  user: EffectiveUser,
  overrides?: AccessRulesOverride,
): Promise<AccessPredicate> {
  const base = resolveAccessPredicate(user, overrides);
  if (base.admin || !user.userId) return base;
  const groupGrants = await resolveUserGroupGrants(user.userId, user.mode);
  return groupGrants.length ? { ...base, grants: [...base.grants, ...groupGrants] } : base;
}
