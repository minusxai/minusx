import 'server-only';
import { headers } from 'next/headers';
import { MX_API_BASE_URL, MX_API_KEY } from '@/lib/config';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';

export async function notifyAppEvent(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!MX_API_BASE_URL) return;

  let requestPath: string | undefined;
  let clientUrl: string | undefined;
  let userEmail: string | undefined;
  let userRole: string | undefined;

  try {
    const h = await headers();
    requestPath = h.get('x-request-path') ?? undefined;
    clientUrl = h.get('referer') ?? undefined;
  } catch {
    // Not in a request context (e.g. cron jobs, tests)
  }

  try {
    const user = await getEffectiveUser();
    userEmail = user?.email;
    userRole = user?.role;
  } catch {
    // Session unavailable (cron jobs, unauthenticated routes)
  }

  const enriched = {
    type: eventType,
    ...(requestPath ? { requestPath } : {}),
    ...(clientUrl ? { clientUrl } : {}),
    ...(userEmail ? { userEmail } : {}),
    ...(userRole ? { userRole } : {}),
    ...payload,
  };

  try {
    await fetch(`${MX_API_BASE_URL}/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(MX_API_KEY ? { 'mx-api-key': MX_API_KEY } : {}),
      },
      body: JSON.stringify(enriched),
    });
  } catch (e) {
    console.error('[app-events-notifier] Failed to send notification:', e);
  }
}
