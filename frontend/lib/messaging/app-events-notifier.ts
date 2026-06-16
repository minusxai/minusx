import 'server-only';
import { headers } from 'next/headers';
import { EVENTS_FORWARD_RULES } from '@/lib/config';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';

/**
 * Enrich a raw event payload with request/session context (request path, referer,
 * acting user's email/role). Returns a new object — never mutates the input.
 */
export async function enrichEventPayload(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let requestPath: string | undefined;
  let clientUrl: string | undefined;
  let userEmail: string | undefined;
  let userRole: string | undefined;

  try {
    const h = await headers();
    requestPath = h.get('x-request-path') ?? undefined;
    clientUrl = h.get('referer') ?? undefined;
  } catch {
    // Not in a request context (cron jobs, tests).
  }
  try {
    const user = await getEffectiveUser();
    userEmail = user?.email;
    userRole = user?.role;
  } catch {
    // Session unavailable.
  }

  return {
    type: eventType,
    ...(requestPath ? { requestPath } : {}),
    ...(clientUrl ? { clientUrl } : {}),
    ...(userEmail ? { userEmail } : {}),
    ...(userRole ? { userRole } : {}),
    ...payload,
  };
}

function isSlackWebhook(url: string): boolean {
  return /hooks\.slack\.com/.test(url);
}

/** Render an event as a Slack message (`*type*` header + bulleted fields). */
function toSlackText(eventType: string, payload: Record<string, unknown>): string {
  const lines = [`*${eventType}*`];
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'type' || v == null) continue;
    lines.push(`• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return lines.join('\n');
}

/**
 * Forward an (already-enriched) event to every webhook whose EVENTS_FORWARD_RULES regex
 * matches the event type. Slack webhooks (hooks.slack.com) receive a formatted `{ text }`
 * message; any other URL receives the raw enriched JSON (e.g. a central ingest endpoint).
 * Best-effort and fire-and-forget — a failing webhook never throws.
 */
export async function forwardToWebhooks(
  eventType: string,
  enriched: Record<string, unknown>,
): Promise<void> {
  const matched = EVENTS_FORWARD_RULES.filter(r => r.pattern.test(eventType));
  if (matched.length === 0) return;

  await Promise.allSettled(matched.map(async (rule) => {
    const body = isSlackWebhook(rule.url)
      ? JSON.stringify({ text: toSlackText(eventType, enriched) })
      : JSON.stringify(enriched);
    try {
      await fetch(rule.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    } catch (e) {
      console.error('[app-events-notifier] forward failed for', rule.url, e);
    }
  }));
}
