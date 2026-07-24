import { NextRequest } from 'next/server';
import { getConfigs, saveConfig } from '@/lib/data/configs.server';
import { sanitizeOrgConfig } from '@/lib/validation/config-sanitizer';
import { redactRawConfigSecrets } from '@/lib/secrets/config-secret-specs';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { revalidateTag } from 'next/cache';

/**
 * GET /api/configs
 * Get configs for the authenticated user.
 * Secret fields are masked (legacy raw values) or @SECRETS/… refs — never raw.
 */
export const GET = withAuth(async (request: NextRequest, user) => {
  try {
    const result = await getConfigs(user);
    return successResponse({ ...result, config: redactRawConfigSecrets(result.config) });
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * POST /api/configs
 * Save configs for the authenticated user
 * Validates config structure before saving
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();

    // Heal inert schema-drift (retired file/viz types, the old `llm.assignments`),
    // then validate what remains. Drift we ourselves retired is cleaned silently
    // (reported via `warnings`); a genuinely malformed section is REJECTED — never
    // saved — with its SPECIFIC reason, not a canned message.
    const { config: healed, warnings, errors } = sanitizeOrgConfig(body, { dropInvalidSections: false });
    if (errors.length > 0) {
      return ApiErrors.validationError(errors.join('; '));
    }

    const { id, config } = await saveConfig(healed, user);
    revalidateTag('configs', 'default');
    return successResponse({ message: 'Config saved successfully', id, config: redactRawConfigSecrets(config), warnings });
  } catch (error) {
    return handleApiError(error);
  }
});
