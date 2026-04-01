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

  const commitSha = GIT_COMMIT_SHA;
  const lines: string[] = [
    `*[${source}]* ${message}`,
    ...(extras ? Object.entries(extras).map(([k, v]) => `• *${k}*: ${v}`) : []),
    `commit: \`${commitSha}\``,
  ];

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
    });
  } catch (e) {
    console.error('[internal-notifier] Failed to send internal notification:', e);
  }
}
