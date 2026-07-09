/**
 * Bearer auth wrapper for the public `/s/<code>/*` remote-session endpoints (modeled on
 * `withCronAuth`): the capability code is the ONLY credential — no session, no cookie. On success
 * the handler receives the conversation and the OWNER's EffectiveUser. All auth failures are a
 * uniform 404 (a token guesser learns nothing); the skill-doc page route does its own resolution
 * to render a friendlier "session ended" page.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { Conversation } from '@/lib/data/conversations.types';
import { resolveRemoteSession } from '@/lib/chat/remote-session.server';
import { handleApiError } from '@/lib/http/api-responses';

export interface RemoteSessionRequestContext {
  conversation: Conversation;
  user: EffectiveUser;
  code: string;
  /** Route params past `code` (e.g. toolCallId on the result route). */
  params: Record<string, string>;
}

type RemoteSessionHandler = (
  request: NextRequest,
  ctx: RemoteSessionRequestContext,
) => Promise<Response>;

// Per-conversation sliding-window rate limit (in-memory; per-instance, which is fine — this is a
// misbehaving-agent backstop, not a security boundary).
const RATE_LIMIT_MAX_CALLS = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
// eslint-disable-next-line no-restricted-syntax -- mutable per-conversation sliding-window cache; keys are conversation ids (per-request scope), entries self-expire via the window filter
const callTimes = new Map<number, number[]>();

function rateLimited(conversationId: number, now = Date.now()): boolean {
  const times = (callTimes.get(conversationId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (times.length >= RATE_LIMIT_MAX_CALLS) {
    callTimes.set(conversationId, times);
    return true;
  }
  times.push(now);
  callTimes.set(conversationId, times);
  return false;
}

/** Test hook — clears the in-memory rate-limit window. */
export function resetRemoteSessionRateLimit(): void {
  callTimes.clear();
}

export function withRemoteSessionAuth(handler: RemoteSessionHandler) {
  return async (
    request: NextRequest,
    routeCtx: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    const params = await routeCtx.params;
    const code = params.code ?? '';
    const resolved = await resolveRemoteSession(code);
    if (!resolved.ok) {
      // A code that PROVED ownership (nonce matched the stored hash) but is dead gets an honest
      // 410 "session_ended" so agents stop cleanly; anything else (unknown/malformed/replaced —
      // indistinguishable from a guess) stays a uniform 404. See REMOTE_AGENT_SESSIONS.md §10.
      if (resolved.denial === 'revoked' || resolved.denial === 'expired' || resolved.denial === 'idle_expired') {
        return NextResponse.json({
          error: 'session_ended',
          message: 'This remote session has ended (stopped by the user, expired, or disabled). Stop making calls with this URL and ask the user for a fresh "Copy to Agent" link.',
        }, { status: 410 });
      }
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (rateLimited(resolved.conversation.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    try {
      return await handler(request, { conversation: resolved.conversation, user: resolved.user, code, params });
    } catch (error) {
      return handleApiError(error);
    }
  };
}
