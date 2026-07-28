import { NextRequest, NextResponse } from 'next/server';
import { withCronAuth } from '@/lib/http/with-auth';
import { handleApiError } from '@/lib/http/api-responses';
import { getModules } from '@/lib/modules/registry';

/**
 * GET /api/admin/fleet-version → { min }
 *
 * The oldest data version this deployment is serving.
 *
 * A build declares the range it can read; raising the bottom of that range is only safe
 * once everything it serves has been migrated past it. Without this, that check happens
 * implicitly at deploy time — a lagging workspace gets served by code that misreads its
 * data, and the symptom is corrupted content rather than an error.
 *
 * Returns ONLY the minimum. Anything richer is a direct database query away for whoever
 * legitimately needs it, and this endpoint is reachable with a shared secret.
 */
export const GET = withCronAuth(async (_request: NextRequest) => {
  try {
    return NextResponse.json({ min: await getModules().namespace.minDataVersion() });
  } catch (error) {
    return handleApiError(error);
  }
});
