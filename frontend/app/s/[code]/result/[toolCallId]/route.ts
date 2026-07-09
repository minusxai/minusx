import { NextRequest, NextResponse } from 'next/server';
import { withRemoteSessionAuth } from '@/lib/http/with-remote-session-auth';
import {
  getRemoteToolResult,
  REMOTE_TOOL_POLL_AFTER_MS,
} from '@/lib/chat/remote-session-engine.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /s/<code>/result/<toolCallId>[?waitMs=N] — poll (short long-poll) a previously-dispatched
 * remote tool call. 200 completed / 202 pending / 404 unknown id. A pending response may carry
 * `browserMaybeUnreachable: true` (no browser completed the call in time — possibly an unanswered
 * user confirmation); polling never force-closes a pending call.
 */
export const GET = withRemoteSessionAuth(async (request: NextRequest, { conversation, params }) => {
  const toolCallId = params.toolCallId ?? '';
  const waitMs = new URL(request.url).searchParams.get('waitMs') ?? undefined;

  const outcome = await getRemoteToolResult(conversation, toolCallId, { waitMs });
  switch (outcome.kind) {
    case 'completed':
      return NextResponse.json({
        status: 'completed', toolCallId: outcome.toolCallId, isError: outcome.isError, content: outcome.content,
      });
    case 'pending':
      return NextResponse.json(
        {
          status: 'pending', toolCallId: outcome.toolCallId, pollAfterMs: REMOTE_TOOL_POLL_AFTER_MS,
          ...(outcome.browserMaybeUnreachable ? { browserMaybeUnreachable: true } : {}),
        },
        { status: 202 },
      );
    default:
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
});
