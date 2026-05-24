import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { runFeedSummaryV2 } from '@/lib/chat/run-feed-summary-v2.server';
import { handleApiError } from '@/lib/api/api-responses';

/**
 * POST /api/feed-summary
 *
 * Generates a home-feed summary via the in-process v2 FeedSummaryAgent (no
 * Client sends pre-built appState (compressed augmented files).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { appState } = await request.json();

    const summary = await runFeedSummaryV2(appState, user);

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    return handleApiError(error);
  }
}
