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

  // Precedence is DELIBERATE: the payload spreads LAST, so a publisher's own
  // attribution wins over session-derived enrichment (e.g. share:lead sets
  // userEmail to the GUEST's email; the session here would be absent or wrong).
  // Enrichment only fills fields the publisher left unset.
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

/** Per-field cap for Slack rendering — a notification, not a data dump. */
const SLACK_FIELD_MAX_CHARS = 300;

/**
 * Render an event as a Slack message (`*type*` header + bulleted fields).
 * Each field's value is truncated: bulky payloads (an `llm:call`'s per-call map,
 * an `error`'s context object) previously arrived as an unreadable JSON wall
 * and could leak internals into the channel.
 */
function toSlackText(eventType: string, payload: Record<string, unknown>): string {
  const lines = [`*${eventType}*`];
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'type' || v == null) continue;
    const rendered = typeof v === 'object' ? JSON.stringify(v) : String(v);
    const clipped = rendered.length > SLACK_FIELD_MAX_CHARS
      ? `${rendered.slice(0, SLACK_FIELD_MAX_CHARS)}… (${rendered.length} chars)`
      : rendered;
    lines.push(`• ${k}: ${clipped}`);
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
