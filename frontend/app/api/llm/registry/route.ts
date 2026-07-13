import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { listProviders, listModels } from '@/orchestrator/llm';

/**
 * GET /api/llm/registry — the searchable provider/model registry for the LLM
 * settings pickers (admin-only). Pure metadata: slugs, model ids/names,
 * capability flags — never credentials.
 */
export const GET = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can browse the LLM registry');
  }
  try {
    const providers = listProviders().map(slug => ({ slug, models: listModels(slug) }));
    return successResponse({ providers });
  } catch (error) {
    return handleApiError(error);
  }
});
