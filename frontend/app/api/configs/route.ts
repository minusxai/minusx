import { NextRequest } from 'next/server';
import { getConfigs, validateCompanyConfig, mergePartialConfigs } from '@/lib/data/configs.server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { DocumentDB } from '@/lib/database/documents-db';
import { revalidateTag } from 'next/cache';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { CompanyConfig } from '@/lib/branding/whitelabel';

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

    // Load existing stored content for partial merge support
    let existingContent: Partial<CompanyConfig> = {};
    if (existing?.content && validateCompanyConfig(existing.content)) {
      existingContent = existing.content as Partial<CompanyConfig>;
    }

    // Deep-merge incoming partial body onto existing stored content
    const mergedContent = mergePartialConfigs(existingContent, body);

    let id: number;
    if (existing) {
      await DocumentDB.update(existing.id, 'config.json', configPath, mergedContent as any, [], user.companyId);
      id = existing.id;
    } else {
      id = await DocumentDB.create('config.json', configPath, 'config', mergedContent as any, [], user.companyId);
    }

    // Invalidate cache
    revalidateTag('configs', 'default');

    // Return full merged config so client can update Redux without a second round-trip
    const { config } = await getConfigs(user);
    return successResponse({
      message: 'Config saved successfully',
      id,
      config,
    });
  } catch (error) {
    return handleApiError(error);
  }
});
