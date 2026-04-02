import { NextRequest } from 'next/server';
import { getConfigs, validateCompanyConfig, saveConfig } from '@/lib/data/configs.server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { revalidateTag } from 'next/cache';

/**
 * GET /api/configs
 * Get configs for the authenticated user's company
 */
export const GET = withAuth(async (request: NextRequest, user) => {
  try {
    const result = await getConfigs(user);
    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * POST /api/configs
 * Save configs for the authenticated user's company
 * Validates config structure before saving
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();

    // Validate config structure
    if (!validateCompanyConfig(body)) {
      return ApiErrors.validationError('Invalid config structure. Required fields: branding.{logoLight, logoDark, displayName, agentName, favicon}');
    }

    const { id, config } = await saveConfig(body, user);
    revalidateTag('configs', 'default');
    return successResponse({ message: 'Config saved successfully', id, config });
  } catch (error) {
    return handleApiError(error);
  }
});
