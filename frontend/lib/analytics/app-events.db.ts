import 'server-only';
import { getModules } from '@/lib/modules/registry';

/**
 * Store one published app-event in the local `app_events` log. Best-effort and
 * fire-and-forget: errors are caught + logged, never thrown (an analytics write must
 * never break the request that produced the event).
 *
 * `mode` / `user_id` / `user_email` are lifted to columns for cheap filtering; the full
 * (already-enriched) event payload is kept verbatim in the JSONB `payload`.
 */
export async function recordAppEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const mode = typeof payload.mode === 'string' ? payload.mode : null;
    const userId = typeof payload.userId === 'number' ? payload.userId : null;
    const userEmail = typeof payload.userEmail === 'string' ? payload.userEmail : null;

    // Defensive JSON round-trip: a payload may carry non-serialisable values (e.g. an
    // Error object on `error` events). Keep the log resilient rather than dropping rows.
    let safePayload: unknown;
    try { safePayload = JSON.parse(JSON.stringify(payload)); } catch { safePayload = { unserializable: true, eventType }; }

    await getModules().db.exec(
      `INSERT INTO app_events (event_type, mode, user_id, user_email, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [eventType, mode, userId, userEmail, safePayload],
    );
  } catch (err) {
    console.error('[analytics] app_events insert failed:', err);
  }
}
