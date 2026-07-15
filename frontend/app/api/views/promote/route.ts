/**
 * POST /api/views/promote — turn a saved question into a view on its nearest
 * context. Explore in a question, validate the numbers, then curate.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { promoteQuestionToView, ViewPrepareError } from '@/lib/views/prepare.server';
import { ViewResolutionError } from '@/lib/views/resolve';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const { questionId, name, description } = (await request.json()) as {
      questionId?: number; name?: string; description?: string;
    };
    if (typeof questionId !== 'number' || !name) {
      return ApiErrors.badRequest('questionId and name are required');
    }
    const view = await promoteQuestionToView(user, { questionId, name, description });
    return successResponse({ view });
  } catch (error) {
    if (error instanceof ViewPrepareError || error instanceof ViewResolutionError) {
      return ApiErrors.badRequest(error.message);
    }
    return handleApiError(error);
  }
});
