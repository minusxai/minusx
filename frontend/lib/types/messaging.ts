// ============================================================================
// Messaging/config domain types — split out of lib/types.ts (thin barrel there
// re-exports everything here; see lib/types.ts for the barrel).
// ============================================================================

import type { BaseFileContent } from './files';
import type { AlertRecipient } from './jobs';

export type ConfigChannel =
  | { type: 'slack'; name: string; webhook_url: string; properties?: Record<string, unknown> }
  | { type: 'email'; name: string; address: string }
  | { type: 'phone'; name: string; address: string }
  | { type: 'slack_app'; name: string; team_id: string; channel_id: string; team_name?: string; channel_name?: string; captured_at?: string };

export interface SlackBotConfig {
  type: 'slack';
  name: string;
  install_mode: 'manifest_manual' | 'oauth';
  bot_token: string;
  signing_secret?: string;
  team_id?: string;
  team_name?: string;
  bot_user_id?: string;
  app_id?: string;
  enterprise_id?: string;
  installed_at?: string;
  installed_by?: string;
  enabled?: boolean;
  scopes?: string[];
}

export type ConfigBot = SlackBotConfig;

export interface ConfigContent extends BaseFileContent {
  branding?: {
    logoLight?: string;
    logoDark?: string;
    displayName?: string;
    agentName?: string;
    favicon?: string;
  };
  links?: {
    docsUrl?: string;
    supportUrl?: string;
    githubIssuesUrl?: string;
  };
  messaging?: {
    webhooks: MessagingWebhook[];
  };
  channels?: ConfigChannel[];
  error_delivery?: AlertRecipient[];
  bots?: ConfigBot[];
  // Future: other config sections can be added here
}

/**
 * Messaging webhook — explicit HTTP config (url/method/headers/body)
 */
export interface MessagingWebhookHttp {
  type: 'phone_otp' | 'email_otp' | 'email_alert' | 'phone_alert' | 'slack_alert';
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  body?: string | Record<string, any>;
}

/**
 * Messaging webhook — keyword alias resolved server-side at send time.
 * Clients only see the keyword; credentials are never in the config.
 * Only valid type+keyword combinations are allowed.
 */
export type MessagingWebhookKeyword =
  | { type: 'email_otp';   keyword: 'EMAIL_DEFAULT' }
  | { type: 'email_alert'; keyword: 'EMAIL_DEFAULT' }
  | { type: 'slack_alert'; keyword: 'SLACK_DEFAULT' };

export type MessagingWebhook = MessagingWebhookHttp | MessagingWebhookKeyword;
