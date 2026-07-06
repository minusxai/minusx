/**
 * Shared client-side error reporter — fire-and-forget POST to /api/chat/log-error
 * so client-side failures land on the conversation document's `errors[]` and
 * survive page reload. Used by both `chatListener.handleStreamError` (transport)
 * and the wizard's init path (`handleAgentDescribe`).
 *
 * Idempotent + best-effort: any failure is swallowed (we never recurse).
 */

import { getStore } from '@/store/store';
import { selectActiveConversation } from '@/store/chatSlice';

// Mirror the existing API_BASE_URL/patchApiUrl pattern used in chatListener.
const API_BASE_URL = typeof window === 'undefined' ? 'http://localhost:3000' : '';
function patchApiUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return path; // browser uses relative; SSR/node uses the prefixed URL above
}

type ReportableErrorSource = 'transport' | 'session' | 'unhandled';

function reportClientErrorToChat(
  conversationID: number,
  message: string,
  source: ReportableErrorSource = 'transport',
  httpStatus?: number,
): void {
  if (!Number.isFinite(conversationID) || conversationID <= 0) return; // no real conv to attach to
  const body = {
    conversationID,
    error: {
      _type: 'error',
      source,
      message,
      timestamp: Date.now(),
      ...(typeof httpStatus === 'number' ? { details: { http_status: httpStatus } } : {}),
    },
  };
  void fetch(patchApiUrl(`${API_BASE_URL}/api/chat/log-error`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => { /* best-effort */ });
}

/**
 * Used by code paths that fail BEFORE a new conversation exists (e.g.
 * /api/conversations create failure in the wizard). Routes the error to the user's
 * currently-active conversation if there is one — so the failure still appears
 * in their history. No-op if no active conv (true cold-start init failure).
 */
export function logInitFailure(message: string, httpStatus?: number): void {
  let activeId = 0;
  try {
    const state = getStore().getState();
    const id = selectActiveConversation(state);
    if (typeof id === 'number') activeId = id;
  } catch { /* swallow — fall through to no-op */ }
  if (activeId > 0) {
    reportClientErrorToChat(activeId, message, 'transport', httpStatus);
  }
}
