import { NextRequest, NextResponse } from 'next/server';
import { withRemoteSessionAuth } from '@/lib/http/with-remote-session-auth';
import {
  executeRemoteToolCall,
  REMOTE_TOOL_POLL_AFTER_MS,
} from '@/lib/chat/remote-session-engine.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /s/<code>/tool — execute one externally-authored tool call (Remote Agent Sessions).
 * Body: { tool, args, callId?, waitMs? }. 200 completed / 202 pending (poll /result/<id>) /
 * 400 invalid / 409 busy. Auth = the bearer code (withRemoteSessionAuth); see /s/<code> for docs.
 */
export const POST = withRemoteSessionAuth(async (request: NextRequest, { conversation, user }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid', message: 'body must be JSON: { tool, args }' }, { status: 400 });
  }

  const outcome = await executeRemoteToolCall(conversation, user, body as { tool: string; args: Record<string, unknown> });
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
    case 'invalid':
      return NextResponse.json({ error: 'invalid', message: outcome.message }, { status: 400 });
    case 'busy':
      return NextResponse.json({ error: 'busy', message: outcome.message }, { status: 409 });
    default:
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
});
