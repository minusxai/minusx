import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getEffectiveRule } from '@/lib/auth/access-rules';
import { getConfigs, saveConfig } from '@/lib/data/configs.server';
import type { AccessRulesOverride } from '@/lib/branding/whitelabel';
import type { UserRole, FileType } from '@/lib/types';

const ROLES: UserRole[] = ['admin', 'editor', 'viewer'];

/**
 * GET /api/access-rules — the EFFECTIVE per-role capability matrix (rules.json
 * with the org config's `accessRules` overrides applied), plus which roles are
 * overridden. Powers the built-in-roles editor in Settings → Groups.
 */
export const GET = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) return ApiErrors.forbidden('Only admins can view access rules');
  try {
    const { config } = await getConfigs(user);
    const overrides = config.accessRules;
    const roles = ROLES.map(role => {
      const rule = getEffectiveRule(role, overrides);
      return {
        role,
        // Admin is immutable (lockout guard in getEffectiveRule).
        locked: role === 'admin',
        overridden: role !== 'admin' && !!overrides?.[role],
        allowedTypes: rule?.allowedTypes ?? [],
        createTypes: rule?.createTypes ?? [],
        viewTypes: rule?.viewTypes ?? [],
      };
    });
    return successResponse({ roles });
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * PUT /api/access-rules — set per-role overrides (editor/viewer only) into the
 * org config's `accessRules`. Admin capabilities cannot be changed. The config
 * validator re-checks the structure on save.
 */
export const PUT = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) return ApiErrors.forbidden('Only admins can edit access rules');
  try {
    const body = await request.json().catch(() => null) as { accessRules?: AccessRulesOverride } | null;
    const incoming = body?.accessRules;
    if (!incoming || typeof incoming !== 'object') {
      return ApiErrors.validationError('accessRules object is required');
    }
    if ('admin' in incoming) {
      return ApiErrors.validationError('Admin capabilities cannot be modified');
    }
    const asTypeSet = (v: unknown): v is '*' | FileType[] =>
      v === undefined || v === '*' || (Array.isArray(v) && v.every(x => typeof x === 'string'));
    for (const [role, o] of Object.entries(incoming)) {
      if (role !== 'editor' && role !== 'viewer') return ApiErrors.validationError(`Unknown role: ${role}`);
      if (!o || typeof o !== 'object') return ApiErrors.validationError(`Override for ${role} must be an object`);
      if (!asTypeSet(o.allowedTypes) || !asTypeSet(o.createTypes) || !asTypeSet(o.viewTypes)) {
        return ApiErrors.validationError(`Override for ${role} must use "*" or arrays of file types`);
      }
    }
    await saveConfig({ accessRules: incoming }, user);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});
