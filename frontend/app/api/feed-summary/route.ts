import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { handleApiError } from '@/lib/api/api-responses';

/**
 * POST /api/feed-summary
 *
 * Thin proxy to Python /api/chat with FeedSummaryAgent.
 * Client sends pre-built appState (compressed augmented files).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { appState, prompt } = await request.json();

    const response = await pythonBackendFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        log: [],
        user_message: prompt || 'Generate a feed summary.',
        agent: 'FeedSummaryAgent',
        agent_args: {
          app_state: appState,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python backend error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Extract text from last TaskResult in logDiff
    let summary = '';
    for (let i = (data.logDiff?.length ?? 0) - 1; i >= 0; i--) {
      const entry = data.logDiff[i];
      if (entry._type === 'task_result' && entry.result) {
        const result = entry.result;
        if (typeof result.content === 'string') {
          summary = result.content;
        } else if (result.content_blocks) {
          summary = result.content_blocks
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');
        }
        break;
      }
    }

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    return handleApiError(error);
  }
}
