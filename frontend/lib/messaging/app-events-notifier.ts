import 'server-only';
import { APP_EVENTS_SLACK_WEBHOOK } from '@/lib/config';

export async function notifyAppEvent(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!APP_EVENTS_SLACK_WEBHOOK) return;

  const lines: string[] = [`*${eventType}*`];
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null) {
      lines.push(`• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
  }

  try {
    await fetch(APP_EVENTS_SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
    });
  } catch (e) {
    console.error('[app-events-notifier] Failed to send notification:', e);
  }
}
