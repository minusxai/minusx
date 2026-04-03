import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors, handleApiError, successResponse } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getRawConfigByCompanyId, saveConfigByCompanyId } from '@/lib/data/configs.server';
import type { McpSettings } from '@/lib/types';

function getBaseUrl(request: NextRequest): string {
  const protoHeader = request.headers.get('x-forwarded-proto') || 'http';
  const proto = protoHeader.split(',')[0].trim();
  const host = request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export const GET = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can view MCP settings');
  }

  try {
    const rawConfig = await getRawConfigByCompanyId(user.companyId, user.mode);
    const settings: McpSettings = rawConfig.mcp ?? {};
    const endpointUrl = `${getBaseUrl(request)}/api/mcp`;
    return successResponse({ settings, endpointUrl });
  } catch (error) {
    return handleApiError(error);
  }
});

export const POST = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage MCP settings');
  }

  let body: { enabled?: boolean } | undefined;
  try {
    body = await request.json() as { enabled?: boolean };
  } catch {
    return ApiErrors.validationError('Invalid request body');
  }

  if (typeof body?.enabled !== 'boolean') {
    return ApiErrors.validationError('enabled must be a boolean');
  }

  try {
    const rawConfig = await getRawConfigByCompanyId(user.companyId, user.mode);
    const updatedConfig = { ...rawConfig, mcp: { ...rawConfig.mcp, enabled: body.enabled } };
    await saveConfigByCompanyId(user.companyId, user.mode, updatedConfig);
    return successResponse({ settings: updatedConfig.mcp });
  } catch (error) {
    return handleApiError(error);
  }
});
