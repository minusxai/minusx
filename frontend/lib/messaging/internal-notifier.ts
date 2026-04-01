import 'server-only';
import { GIT_COMMIT_SHA } from '@/lib/constants';

/**
 * Bug reporting channel notifier for app-level errors.
 * Completely independent of company config — uses INTERNAL_SLACK_CHANNEL_WEBHOOK env var directly.
 * Never exposed to clients. Never re-uses any company-configured webhook.
 */
export async function notifyInternal(
  source: string,
  message: string,
  extras?: Record<string, string>,
): Promise<void> {
  const webhookUrl = process.env.INTERNAL_SLACK_CHANNEL_WEBHOOK;
  if (!webhookUrl) return;

  const errObj: Record<string, string> = {
    source,
    message,
    commit: GIT_COMMIT_SHA,
    ...(extras ?? {}),
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_id: extras?.user ?? source,
        created_at: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
        err_str: JSON.stringify(errObj),
        thread_url: process.env.AUTH_URL ?? 'https://minusx.ai',
      }),
    });
  } catch (e) {
    console.error('[internal-notifier] Failed to send internal notification:', e);
  }
}
