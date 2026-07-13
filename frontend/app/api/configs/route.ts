import { NextRequest } from 'next/server';
import { getConfigs, validateOrgConfig, saveConfig } from '@/lib/data/configs.server';
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

    // Validate config structure
    if (!validateOrgConfig(body)) {
      return ApiErrors.validationError('Invalid config structure. Required fields: branding.{logoLight, logoDark, displayName, agentName, favicon}');
    }

    const { id, config } = await saveConfig(body, user);
    revalidateTag('configs', 'default');
    return successResponse({ message: 'Config saved successfully', id, config: redactRawConfigSecrets(config) });
  } catch (error) {
    return handleApiError(error);
  }
});
