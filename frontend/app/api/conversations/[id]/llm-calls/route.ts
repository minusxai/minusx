import { NextRequest, NextResponse } from 'next/server';
import { getLlmCallsForConversation } from '@/lib/analytics/file-analytics.db';
import { getModelCatalog, getModelRatesFromCatalog } from '@/lib/llm/model-catalog.server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { isAdmin } from '@/lib/auth/role-helpers';
import { handleApiError, ApiErrors } from '@/lib/http/api-responses';

/**
 * /debug visualization batch data source: every recorded LLM call of one
 * conversation ({@link getLlmCallsForConversation}: per-call stats + raw
 * pi-format request blob), plus $/token catalog rates for the models seen
 * (null entries → the client falls back to usage-derived rates). Admin only —
 * the blobs contain the full system prompt and conversation content.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getEffectiveUser();
    if (!user || !isAdmin(user.role)) return ApiErrors.forbidden('Admin only');

    const { id } = await params;
    const conversationId = Number(id);
    if (!Number.isInteger(conversationId)) return ApiErrors.badRequest('Invalid conversation id');

    const calls = await getLlmCallsForConversation(conversationId);
    const models = [...new Set(calls.map((c) => String(c.stats.model ?? '')).filter(Boolean))];
    const rates = getModelRatesFromCatalog(models, await getModelCatalog());
    return NextResponse.json({ calls, rates });
  } catch (error) {
    return handleApiError(error);
  }
}
