import { NextRequest, NextResponse } from 'next/server';
import { withRemoteSessionAuth } from '@/lib/http/with-remote-session-auth';
import { endRemoteSession } from '@/lib/chat/remote-session.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /s/<code>/end — the external agent politely ends its own session (Remote Agent Sessions):
 * revokes the code, closes any dangling call, releases the conversation to idle (input unfreezes).
 */
export const POST = withRemoteSessionAuth(async (_request: NextRequest, { conversation }) => {
  await endRemoteSession(conversation.id);
  return NextResponse.json({ ok: true });
});
