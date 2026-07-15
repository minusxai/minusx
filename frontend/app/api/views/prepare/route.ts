/**
 * POST /api/views/prepare — the save-time gate for a view: validates the name
 * across the whole context tree and snapshots the view's output columns/types
 * by probing the (view-resolved) SQL with a zero-row bound.
 *
 * The client calls this before storing a ViewDef on the context version; the
 * returned columns are what make a view behave like a real table everywhere.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { prepareView, ViewPrepareError } from '@/lib/views/prepare.server';
import { ViewResolutionError } from '@/lib/views/resolve';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const { path, connection, name, sql, editing } = (await request.json()) as {
      path?: string; connection?: string; name?: string; sql?: string; editing?: string;
    };
    if (!path || !connection || !name || typeof sql !== 'string') {
      return ApiErrors.badRequest('path, connection, name and sql are required');
    }
    const { columns } = await prepareView(user, { path, connection, name, sql, editing });
    return successResponse({ columns });
  } catch (error) {
    // Authoring errors (bad name, cycle, broken SQL) are the user's to fix — surface
    // the message rather than a 500.
    if (error instanceof ViewPrepareError || error instanceof ViewResolutionError) {
      return ApiErrors.badRequest(error.message);
    }
    if (error instanceof Error && /error/i.test(error.message)) {
      return ApiErrors.badRequest(error.message);
    }
    return handleApiError(error);
  }
});
