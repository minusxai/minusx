import 'server-only';
import { getConfigsByCompanyId } from '@/lib/data/configs.server';
import { UserDB } from '@/lib/database/user-db';
import { sendEmailViaWebhook, sendSlackViaWebhook, sendPhoneAlertViaWebhook } from './webhook-executor';
import { resolveWebhook } from './webhook-resolver.server';
import { notifyInternal } from './internal-notifier';
import type { AppEventPayloads } from '@/lib/app-event-registry/events';
import type { Mode } from '@/lib/mode/mode-types';

export async function notifyErrorEvent(payload: AppEventPayloads['error']): Promise<void> {
  // Always notify bug reporting channel (independent of company config, fire-and-forget)
  const internalExtras: Record<string, string> = {};
  if (payload.companyId)        internalExtras.companyId = String(payload.companyId);
  if (payload.mode)             internalExtras.mode      = payload.mode;
  if (payload.context?.user)    internalExtras.user      = String(payload.context.user);
  if (payload.context?.url)     internalExtras.url       = String(payload.context.url);
  if (payload.context?.company) internalExtras.company   = String(payload.context.company);
  void notifyInternal(payload.source, payload.message, internalExtras);
  const { config } = await getConfigsByCompanyId(payload.companyId, payload.mode as Mode | undefined);
  const recipients = config.error_delivery ?? [];
  if (!recipients.length) return;

  // Resolve addresses for normalized recipients
  const dbUsers = await UserDB.listByCompany(payload.companyId);
  const userById = Object.fromEntries(dbUsers.map(u => [u.id, u]));

  const webhooks = config.messaging?.webhooks ?? [];
  const message = `[${payload.source}] ${payload.message}`;

  for (const recipient of recipients) {
    if ('userId' in recipient) {
      const u = userById[recipient.userId];
      if (!u) continue;
      if (recipient.channel === 'email') {
        if (!u.email) continue;
        const raw = webhooks.find(w => w.type === 'email_alert');
        const webhook = raw ? resolveWebhook(raw) : null;
        if (!webhook) continue;
        await sendEmailViaWebhook(webhook, u.email, `App Error: ${payload.source}`, message).catch(e => {
          console.error('[error-notifier] Email delivery failed:', e);
        });
      } else if (recipient.channel === 'phone') {
        if (!u.phone) continue;
        const raw = webhooks.find(w => w.type === 'phone_alert');
        const webhook = raw ? resolveWebhook(raw) : null;
        if (!webhook) continue;
        await sendPhoneAlertViaWebhook(webhook, u.phone, message, { title: 'App Error' }).catch(e => {
          console.error('[error-notifier] Phone delivery failed:', e);
        });
      }
    } else {
      // channelName-based
      const ch = (config.channels ?? []).find(c => c.name === recipient.channelName);
      if (!ch) continue;
      if (recipient.channel === 'slack' && ch.type === 'slack') {
        const raw = webhooks.find(w => w.type === 'slack_alert');
        const webhook = raw ? resolveWebhook(raw) : null;
        if (!webhook) continue;
        await sendSlackViaWebhook(webhook, message, ch).catch(e => {
          console.error('[error-notifier] Slack delivery failed:', e);
        });
      } else if (recipient.channel === 'email' && ch.type === 'email') {
        const raw = webhooks.find(w => w.type === 'email_alert');
        const webhook = raw ? resolveWebhook(raw) : null;
        if (!webhook) continue;
        await sendEmailViaWebhook(webhook, ch.address, `App Error: ${payload.source}`, message).catch(e => {
          console.error('[error-notifier] Email delivery failed:', e);
        });
      } else if (recipient.channel === 'phone' && ch.type === 'phone') {
        const raw = webhooks.find(w => w.type === 'phone_alert');
        const webhook = raw ? resolveWebhook(raw) : null;
        if (!webhook) continue;
        await sendPhoneAlertViaWebhook(webhook, ch.address, message, { title: 'App Error' }).catch(e => {
          console.error('[error-notifier] Phone delivery failed:', e);
        });
      }
    }
  }
}
