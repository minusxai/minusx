/**
 * GET /api/orgs/seed-status?mode=tutorial
 *
 * Reports whether a mode's mxfood sample-data copy has finished. Registration
 * kicks that copy off fire-and-forget (lib/modules/auth/index.ts), so the tutorial
 * is briefly data-less right after a company is created. The data-prep progress UI
 * (and QA setup) poll this until `ready`.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { getMxfoodSeedStatus } from '@/lib/object-store';
import { MXFOOD_TABLES } from '@/lib/object-store/mxfood-tables';
import { isValidMode } from '@/lib/mode/mode-types';

export const GET = withAuth(async (request: NextRequest, user) => {
  try {
    const modeParam = new URL(request.url).searchParams.get('mode');
    const mode = modeParam && isValidMode(modeParam) ? modeParam : (user.mode || 'tutorial');
    const status = await getMxfoodSeedStatus(mode, MXFOOD_TABLES);
    return successResponse(status);
  } catch (error) {
    return handleApiError(error);
  }
});
