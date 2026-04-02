import 'server-only';
import { getConfigsByCompanyId } from '@/lib/data/configs.server';
import { sendEmailViaWebhook, sendSlackViaWebhook, sendPhoneAlertViaWebhook } from './webhook-executor';
import { resolveWebhook } from './webhook-resolver.server';
import { notifyInternal } from './internal-notifier';
import type { AppEventPayloads } from '@/lib/app-event-registry/events';
import type { Mode } from '@/lib/mode/mode-types';

export async function notifyErrorEvent(payload: AppEventPayloads['error']): Promise<void> {
  // Always notify bug reporting channel (independent of company config, fire-and-forget)
  const internalExtras: Record<string, string> = {};
  if (payload.context?.user)    internalExtras.user    = String(payload.context.user);
  if (payload.context?.url)     internalExtras.url     = String(payload.context.url);
  if (payload.context?.company) internalExtras.company = String(payload.context.company);
  void notifyInternal(payload.source, payload.message, internalExtras);
  const { config } = await getConfigsByCompanyId(payload.companyId, payload.mode as Mode | undefined);
  const recipients = config.error_delivery ?? [];
  if (!recipients.length) return;

  const webhooks = config.messaging?.webhooks ?? [];
  const message = `[${payload.source}] ${payload.message}`;

  for (const recipient of recipients) {
    const raw = webhooks.find(w => w.type === recipient.channel);
    const webhook = raw ? resolveWebhook(raw) : null;
    if (!webhook) continue;

    if (recipient.channel === 'slack_alert') {
      const ch = (config.channels ?? []).find(c => c.type === 'slack' && c.name === recipient.address);
      if (ch && ch.type === 'slack') {
        await sendSlackViaWebhook(webhook, message, ch).catch(e => {
          console.error('[error-notifier] Slack delivery failed:', e);
        });
      }
    } else if (recipient.channel === 'email_alert') {
      await sendEmailViaWebhook(webhook, recipient.address, `App Error: ${payload.source}`, message).catch(e => {
        console.error('[error-notifier] Email delivery failed:', e);
      });
    } else if (recipient.channel === 'phone_alert') {
      await sendPhoneAlertViaWebhook(webhook, recipient.address, message, { title: 'App Error' }).catch(e => {
        console.error('[error-notifier] Phone delivery failed:', e);
      });
    }
  }
}
