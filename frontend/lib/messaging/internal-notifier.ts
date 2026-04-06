import 'server-only';
import { GIT_COMMIT_SHA } from '@/lib/constants';
import { MX_API_BASE_URL, MX_API_KEY } from '@/lib/config';

/**
 * Bug reporting channel notifier for app-level errors.
 * Routes through MX_API_BASE_URL/notify → SLACK_ERRORS_WEBHOOK.
 * Never exposed to clients.
 */
export async function notifyInternal(
  source: string,
  message: string,
  extras?: Record<string, string>,
): Promise<void> {
  if (!MX_API_BASE_URL) return;

  try {
    await fetch(`${MX_API_BASE_URL}/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(MX_API_KEY ? { 'mx-api-key': MX_API_KEY } : {}),
      },
      body: JSON.stringify({
        type: 'error',
        source,
        message,
        commit: GIT_COMMIT_SHA,
        ...(extras ?? {}),
      }),
    });
  } catch (e) {
    console.error('[internal-notifier] Failed to send internal notification:', e);
  }
}
