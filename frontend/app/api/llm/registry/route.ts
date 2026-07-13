import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { listProviders } from '@/orchestrator/llm';
import { getModelCatalog, mergedListModels } from '@/lib/llm/model-catalog.server';

/**
 * GET /api/llm/registry — the searchable provider/model registry for the LLM
 * settings pickers (admin-only). Baked pi-ai registry overlaid with the live
 * models.dev catalog (so just-released models appear without a dependency
 * bump). Pure metadata: slugs, model ids/names, capability flags — never
 * credentials.
 */
export const GET = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can browse the LLM registry');
  }
  try {
    const catalog = await getModelCatalog();
    const providers = listProviders().map(slug => ({ slug, models: mergedListModels(slug, catalog) }));
    return successResponse({ providers });
  } catch (error) {
    return handleApiError(error);
  }
});
