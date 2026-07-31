import { NextRequest, NextResponse } from 'next/server';
import { getLlmCallStats, getLlmLog } from '@/lib/analytics/file-analytics.db';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { isAdmin } from '@/lib/auth/role-helpers';
import { handleApiError, ApiErrors } from '@/lib/http/api-responses';

/**
 * Debug UI data source for one LLM call. Reads the per-call stats
 * (`llm_call_events`) and the raw pi-format request/response blobs (`llm_logs`)
 * from the LOCAL document DB — recorded out-of-band by the chat server. Returns
 * the same `{ stats, logs }` shape the client already consumes.
 *
 * Admin only, for the same reason as the batch sibling
 * (`/api/conversations/[id]/llm-calls`): the blobs carry the full system prompt
 * and conversation content. A call id is the ONLY input, so without this gate any
 * logged-in role could read any other user's conversation by guessing or
 * harvesting an id — middleware requires a session but does not check the role.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const user = await getEffectiveUser();
    if (!user || !isAdmin(user.role)) return ApiErrors.forbidden('Admin only');

    const { callId } = await params;
    const [stats, logs] = await Promise.all([getLlmCallStats(callId), getLlmLog(callId)]);
    return NextResponse.json({ stats, logs });
  } catch (error) {
    return handleApiError(error);
  }
}
