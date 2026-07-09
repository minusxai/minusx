import { NextRequest, NextResponse } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { getConversation } from '@/lib/data/conversations.server';
import { isRemoteSessionLive } from '@/lib/data/remote-sessions.server';
import {
  mintRemoteSession,
  endRemoteSession,
  RemoteSessionMintError,
} from '@/lib/chat/remote-session.server';
import type { RemoteSessionStatus } from '@/lib/data/remote-sessions.types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { Conversation } from '@/lib/data/conversations.types';
import { boundContextAppState } from '@/lib/chat/compress-augmented';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Remote Agent Session management (owner-authenticated; the public bearer endpoints live under
 * /s/<code>). POST mints (re-mint revokes the prior code), DELETE stops, GET reports status for
 * the UI banner. See REMOTE_AGENT_SESSIONS.md §4.4.
 */

async function loadOwned(id: string, user: EffectiveUser): Promise<Conversation | NextResponse> {
  const conversationId = Number(id);
  if (!Number.isInteger(conversationId)) return ApiErrors.validationError('invalid conversation id');
  const conversation = await getConversation(conversationId);
  if (!conversation) return ApiErrors.notFound('Conversation');
  if (conversation.ownerUserId !== user.userId || conversation.mode !== user.mode) return ApiErrors.forbidden();
  return conversation;
}

export const POST = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const conversation = await loadOwned(id, user);
    if (conversation instanceof NextResponse) return conversation;

    // Base URL for the copyable link — honor proxies the same way middleware does.
    const proto = (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', ''))
      .split(',')[0].trim();
    const host = request.headers.get('host') || request.nextUrl.host;
    // Mint-time app state (what the user is looking at) — bounded like the turns route bounds it.
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const appState = (body as { appState?: unknown }).appState;
    if (appState) boundContextAppState(appState);
    const result = await mintRemoteSession(conversation, user, `${proto}://${host}`, { appState });
    return successResponse(result);
  } catch (error) {
    if (error instanceof RemoteSessionMintError) {
      return ApiErrors.conflict(error.message);
    }
    return handleApiError(error);
  }
});

export const DELETE = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const conversation = await loadOwned(id, user);
    if (conversation instanceof NextResponse) return conversation;
    await endRemoteSession(conversation.id);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});

export const GET = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const conversation = await loadOwned(id, user);
    if (conversation instanceof NextResponse) return conversation;
    const record = conversation.meta.remoteSession;
    // Active = status says remote AND the record itself is still live (revoked/expiry checked
    // data-side; the nonce isn't needed to judge liveness for the owner's own banner).
    const live = conversation.runStatus === 'remote' && isRemoteSessionLive(record);
    const status: RemoteSessionStatus = live
      ? { active: true, expiresAt: record!.expiresAt, lastActivityAt: record!.lastActivityAt }
      : { active: false };
    return successResponse(status);
  } catch (error) {
    return handleApiError(error);
  }
});
