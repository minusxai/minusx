/**
 * POST /api/semantic-models — derive semantic models ON DEMAND, scoped to the
 * requested tables. Models are never stored on the context content (multi-MB
 * on large workspaces); this endpoint is the only way clients obtain full
 * model vocabulary. See lib/semantic/models.server.ts.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { getScopedSemanticModels, searchSemanticFields } from '@/lib/semantic/models.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const { path, connection, tables, q } = (await request.json()) as {
      path?: string; connection?: string; tables?: string[]; q?: string;
    };
    if (!path || !connection) {
      return ApiErrors.badRequest('path and connection are required');
    }
    // Search mode: metrics-first typeahead over every whitelisted table's fields.
    if (typeof q === 'string') {
      const fields = await searchSemanticFields(user, { path, connection, q });
      return successResponse({ fields });
    }
    if (!Array.isArray(tables)) {
      return ApiErrors.badRequest('tables (or q) is required');
    }
    const models = await getScopedSemanticModels(user, {
      path,
      connection,
      tables: tables.filter((t): t is string => typeof t === 'string').slice(0, 32),
    });
    return successResponse({ models });
  } catch (error) {
    return handleApiError(error);
  }
});
