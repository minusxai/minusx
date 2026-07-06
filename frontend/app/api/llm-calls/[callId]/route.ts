import { NextRequest, NextResponse } from 'next/server';
import { getLlmCallStats, getLlmLog } from '@/lib/analytics/file-analytics.db';
import { handleApiError } from '@/lib/http/api-responses';

/**
 * Debug UI data source for one LLM call. Reads the per-call stats
 * (`llm_call_events`) and the raw pi-format request/response blobs (`llm_logs`)
 * from the LOCAL document DB — recorded out-of-band by the chat server. Returns
 * the same `{ stats, logs }` shape the client already consumes.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const { callId } = await params;
    const [stats, logs] = await Promise.all([getLlmCallStats(callId), getLlmLog(callId)]);
    return NextResponse.json({ stats, logs });
  } catch (error) {
    return handleApiError(error);
  }
}
