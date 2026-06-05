import { NextRequest, NextResponse } from 'next/server';
import { clearLlmLogsBefore } from '@/lib/analytics/file-analytics.db';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { isAdmin } from '@/lib/auth/role-helpers';

/**
 * Clear raw LLM logs (the `llm_logs` blob table only — never the stats in
 * `llm_call_events`). `?before=<ISO-date>` deletes logs created strictly before
 * that date; with no param, clears all (everything before now). Admin only.
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user || !isAdmin(user.role)) return ApiErrors.forbidden('Admin only');

    const beforeParam = request.nextUrl.searchParams.get('before');
    const before = beforeParam ? new Date(beforeParam) : new Date();
    if (Number.isNaN(before.getTime())) return ApiErrors.badRequest('Invalid `before` date');

    const removed = await clearLlmLogsBefore(before);
    return NextResponse.json({ removed });
  } catch (error) {
    return handleApiError(error);
  }
}
