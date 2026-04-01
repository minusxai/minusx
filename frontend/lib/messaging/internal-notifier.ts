import 'server-only';
import { GIT_COMMIT_SHA } from '@/lib/constants';

/**
 * Internal Slack channel notifier for app-level bug reporting.
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
        created_at: new Date().toISOString(),
        err_str: JSON.stringify(errObj),
      }),
    });
  } catch (e) {
    console.error('[internal-notifier] Failed to send internal notification:', e);
  }
}
