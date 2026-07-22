/**
 * POST /api/semantic-models — serve AUTHORED semantic models (stored on
 * context versions, inherited via fullSemanticModels), scoped to the requested
 * primaries. This endpoint is the only way clients obtain full model
 * vocabulary. See lib/semantic/models.server.ts.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { detectSemanticSql, getScopedSemanticModels, searchSemanticFields, loadNearestContextEntry } from '@/lib/semantic/models.server';
import { testSemanticModel } from '@/lib/semantic/save-gate.server';
import type { SemanticModelV2 } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const { path, connection, tables, q, sql, testModel } = (await request.json()) as {
      path?: string; connection?: string; tables?: string[]; q?: string; sql?: string;
      testModel?: SemanticModelV2;
    };
    if (!path || !connection) {
      return ApiErrors.badRequest('path and connection are required');
    }
    // Test mode: the editor's Test button — tiers 1–3 for one STAGED model,
    // against the stored context, never saving. (Malformed models come back as
    // tier-1 shape issues, not errors.)
    if (testModel && typeof testModel === 'object') {
      const nearest = await loadNearestContextEntry(user, path);
      const test = await testSemanticModel(testModel, nearest?.content ?? null, nearest?.path ?? path, user);
      return successResponse({ test });
    }
    // Detect mode: full server-side detection (parse → scope → detect).
    if (typeof sql === 'string') {
      const detected = await detectSemanticSql(user, { path, connection, sql });
      return successResponse({ detected });
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
