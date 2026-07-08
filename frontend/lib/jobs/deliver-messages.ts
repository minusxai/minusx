/**
 * Shared delivery dispatch for job-run messages (email/phone/slack alerts).
 * Used by both the cron scanner (`lib/jobs/cron-scan.ts`) and the manual
 * job-run orchestrator (`lib/jobs/run-job.ts`) so there is one code path
 * from "handler produced messages" to "webhook attempted", reusing
 * `lib/messaging` for the actual delivery.
 */
import 'server-only';
import type { OrgConfig } from '@/lib/branding/whitelabel';
import type { MessageAttemptLog, RunMessageRecord, SlackBotConfig } from '@/lib/types';
import { postSlackMessage } from '@/lib/integrations/slack/api';
import { sendEmailViaWebhook, sendPhoneAlertViaWebhook, sendSlackViaWebhook, type WebhookResult } from '@/lib/messaging/webhook-executor';
import { resolveWebhook } from '@/lib/messaging/webhook-resolver.server';

export interface DeliverMessagesOptions {
  /** When false, every message is marked 'skipped' without attempting delivery (default true). */
  send?: boolean;
  /**
   * Message types to leave completely untouched (no delivery attempt, status
   * unchanged) — for callers that intentionally don't support a given
   * channel. Unlike `send: false`, this does not mark the message 'skipped';
   * it's invisible to this function, matching pre-existing behavior for call
   * sites that never delivered that type in the first place.
   */
  skipTypes?: RunMessageRecord['type'][];
}

function applyWebhookResult(msg: RunMessageRecord, result: WebhookResult): void {
  const attemptLog: MessageAttemptLog = {
    attemptedAt: new Date().toISOString(),
    success: result.success,
    statusCode: result.statusCode,
    error: result.error,
    requestBody: result.requestBody,
    responseBody: result.responseBody,
  };
  msg.logs = [...(msg.logs ?? []), attemptLog];
  if (result.success) {
    msg.status = 'sent';
    msg.sentAt = new Date().toISOString();
  } else {
    msg.status = 'failed';
    msg.deliveryError = result.error ?? `HTTP ${result.statusCode}`;
  }
}

/**
 * Attempt delivery of each pending run message, mutating status/logs/sentAt/
 * deliveryError in place. Never throws — a per-message delivery failure is
 * recorded on that message, not surfaced to the caller.
 */
export async function deliverMessages(
  messages: RunMessageRecord[],
  config: OrgConfig,
  options: DeliverMessagesOptions = {},
): Promise<void> {
  const { send = true, skipTypes = [] } = options;

  if (!send) {
    for (const msg of messages) msg.status = 'skipped';
    return;
  }

  const webhooks = config.messaging?.webhooks ?? [];
  const emailWebhookRaw = webhooks.find((w) => w.type === 'email_alert');
  const emailWebhook = emailWebhookRaw ? resolveWebhook(emailWebhookRaw) : null;
  const phoneWebhookRaw = webhooks.find((w) => w.type === 'phone_alert');
  const phoneWebhook = phoneWebhookRaw ? resolveWebhook(phoneWebhookRaw) : null;
  const slackWebhookRaw = webhooks.find((w) => w.type === 'slack_alert');
  const slackWebhook = slackWebhookRaw ? resolveWebhook(slackWebhookRaw) : null;

  for (const msg of messages) {
    if (skipTypes.includes(msg.type)) continue;
    try {
      if (msg.type === 'email_alert') {
        if (!emailWebhook) {
          msg.status = 'failed';
          msg.deliveryError = 'No email_alert webhook configured';
        } else {
          const result = await sendEmailViaWebhook(emailWebhook, msg.metadata.to, msg.metadata.subject, msg.content);
          applyWebhookResult(msg, result);
        }
      } else if (msg.type === 'phone_alert') {
        if (!phoneWebhook) {
          msg.status = 'failed';
          msg.deliveryError = 'No phone_alert webhook configured';
        } else {
          const result = await sendPhoneAlertViaWebhook(phoneWebhook, msg.metadata.to, msg.content, {
            title: msg.metadata.title,
            desc: msg.metadata.desc,
            link: msg.metadata.link,
            summary: msg.metadata.summary,
          });
          applyWebhookResult(msg, result);
        }
      } else if (msg.type === 'slack_alert') {
        if (!slackWebhook) {
          msg.status = 'failed';
          msg.deliveryError = 'No slack_alert webhook configured';
        } else {
          const result = await sendSlackViaWebhook(slackWebhook, msg.content, {
            webhook_url: msg.metadata.webhook_url,
            properties: msg.metadata.properties,
          });
          applyWebhookResult(msg, result);
        }
      } else if (msg.type === 'slack_app_alert') {
        const bot = (config.bots ?? []).find(
          (candidate): candidate is SlackBotConfig =>
            candidate.type === 'slack' &&
            candidate.enabled !== false &&
            candidate.team_id === msg.metadata.team_id,
        );
        if (!bot) {
          msg.status = 'failed';
          msg.deliveryError = `No Slack app installation found for team ${msg.metadata.team_id}`;
        } else {
          await postSlackMessage(bot.bot_token, {
            channel: msg.metadata.channel,
            text: msg.content,
          });
          msg.logs = [...(msg.logs ?? []), { attemptedAt: new Date().toISOString(), success: true }];
          msg.status = 'sent';
          msg.sentAt = new Date().toISOString();
        }
      }
    } catch (err) {
      const deliveryError = err instanceof Error ? err.message : 'Unknown delivery error';
      msg.logs = [...(msg.logs ?? []), { attemptedAt: new Date().toISOString(), success: false, error: deliveryError }];
      msg.status = 'failed';
      msg.deliveryError = deliveryError;
    }
  }
}
