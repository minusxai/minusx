import 'server-only';
import { MX_API_BASE_URL, MX_API_KEY } from '@/lib/config';

export async function notifyAppEvent(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!MX_API_BASE_URL) return;

  try {
    await fetch(`${MX_API_BASE_URL}/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(MX_API_KEY ? { 'mx-api-key': MX_API_KEY } : {}),
      },
      body: JSON.stringify({ type: eventType, ...payload }),
    });
  } catch (e) {
    console.error('[app-events-notifier] Failed to send notification:', e);
  }
}
