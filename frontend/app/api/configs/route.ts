import { NextRequest } from 'next/server';
import { getConfigs, validateCompanyConfig } from '@/lib/data/configs.server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { DocumentDB } from '@/lib/database/documents-db';
import { revalidateTag } from 'next/cache';
import { resolvePath } from '@/lib/mode/path-resolver';

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

    const configPath = resolvePath(user.mode, '/configs/config');

    // Check if config already exists
    const existing = await DocumentDB.getByPath(configPath, user.companyId);

    let id: number;
    if (existing) {
      // Update existing config (cast to any since config content structure differs from BaseFileContent)
      await DocumentDB.update(existing.id, 'config.json', configPath, body as any, [], user.companyId);  // Phase 6: Configs have no references
      id = existing.id;
    } else {
      // Create new config (cast to any since config content structure differs from BaseFileContent)
      id = await DocumentDB.create('config.json', configPath, 'config', body as any, [], user.companyId);  // Phase 6: Configs have no references
    }

    // Invalidate cache
    revalidateTag('configs', 'default');

    return successResponse({
      message: 'Config saved successfully',
      id
    });
  } catch (error) {
    return handleApiError(error);
  }
});
