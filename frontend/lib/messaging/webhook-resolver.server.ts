import 'server-only';
import type { MessagingWebhook, MessagingWebhookHttp } from '../types';
import { DEFAULT_EMAIL_WEBHOOK as DEFAULT_EMAIL_WEBHOOK_JSON } from '@/lib/config';

/**
 * SLACK_DEFAULT: hardcoded template.
 * The channel's own webhook_url is substituted at send time via {{SLACK_WEBHOOK}}.
 */
const SLACK_DEFAULT_TEMPLATE: MessagingWebhookHttp = {
  type: 'slack_alert',
  url: '{{SLACK_WEBHOOK}}',
  method: 'POST',
  body: '{{SLACK_PROPERTIES}}',
};

/**
 * EMAIL_DEFAULT: loaded from DEFAULT_EMAIL_WEBHOOK env var at resolve time.
 * Returns null (send fails) if the env var is not set or invalid — intentional.
 */
function getEmailDefaultWebhook(): MessagingWebhookHttp | null {
  const raw = DEFAULT_EMAIL_WEBHOOK_JSON;
  if (!raw) {
    console.error('[webhook-resolver] EMAIL_DEFAULT requires DEFAULT_EMAIL_WEBHOOK env var to be set');
    return null;
  }
  try {
    return JSON.parse(raw) as MessagingWebhookHttp;
  } catch {
    console.error('[webhook-resolver] DEFAULT_EMAIL_WEBHOOK is not valid JSON');
    return null;
  }
}

/**
 * Resolve a MessagingWebhook to its concrete HTTP config.
 * HTTP webhooks pass through unchanged.
 * Keyword webhooks are resolved server-side — credentials never leave the server.
 */
export function resolveWebhook(webhook: MessagingWebhook): MessagingWebhookHttp | null {
  if ('url' in webhook) return webhook;
  switch (webhook.keyword) {
    case 'SLACK_DEFAULT': return SLACK_DEFAULT_TEMPLATE;
    case 'EMAIL_DEFAULT': return getEmailDefaultWebhook();
  }
}
