/**
 * Webhook executor for sending messages via configured webhooks
 * Supports template variable substitution in headers and body
 */

import { MessagingWebhook, MessagingWebhookHttp } from '../types';
import { substituteVariables } from './template-variables';

export interface WebhookResult {
  success: boolean;
  error?: string;
  statusCode?: number;
  requestBody?: string;
  responseBody?: string;
}

/**
 * Execute a webhook with template variable substitution
 * @param webhook - Webhook configuration
 * @param variables - Variables to substitute (e.g., { USER_NUMBER: '+1234567890', AUTH_OTP: '123456' })
 * @returns Result indicating success or failure
 */
export async function executeWebhook(
  webhook: MessagingWebhookHttp,
  variables: Record<string, string>,
): Promise<WebhookResult> {
  try {
    // 1. Substitute variables in URL
    const resolvedUrl = substituteVariables(webhook.url, variables);

    // 2. Substitute variables in headers
    const headers: Record<string, string> = {};
    if (webhook.headers) {
      for (const [key, value] of Object.entries(webhook.headers)) {
        headers[key] = substituteVariables(value, variables);
      }
    }

    // 3. Build body
    let body: any = undefined;
    if (typeof webhook.body === 'string') {
      body = JSON.parse(substituteVariables(webhook.body, variables));
    } else if (webhook.body) {
      const jsonSafeVariables: Record<string, string> = {};
      for (const [key, value] of Object.entries(variables)) {
        jsonSafeVariables[key] = JSON.stringify(value).slice(1, -1);
      }
      body = JSON.parse(substituteVariables(JSON.stringify(webhook.body), jsonSafeVariables));
    }

    // 4. Make HTTP request
    const requestBody = body ? JSON.stringify(body) : undefined;
    let response: Response;
    try {
      response = await fetch(resolvedUrl, {
        method: webhook.method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: requestBody,
      });
    } catch (err: any) {
      return { success: false, error: err.message || 'Unknown error', requestBody };
    }

    const responseBody = await response.text().catch(() => undefined);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
        requestBody,
        responseBody,
      };
    }

    return { success: true, statusCode: response.status, requestBody, responseBody };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
}

/**
 * Send a phone alert message via a configured phone_alert webhook
 */
export async function sendPhoneAlertViaWebhook(
  webhook: MessagingWebhookHttp,
  to: string,
  body: string,
  extras?: { title?: string; desc?: string; link?: string; summary?: string }
): Promise<WebhookResult> {
  return executeWebhook(webhook, {
    PHONE_ALERT_TO:      to,
    PHONE_ALERT_BODY:    body,
    PHONE_ALERT_TITLE:   extras?.title   ?? '',
    PHONE_ALERT_DESC:    extras?.desc    ?? '',
    PHONE_ALERT_LINK:    extras?.link    ?? '',
    PHONE_ALERT_SUMMARY: extras?.summary ?? body,
  });
}

/**
 * Send an email via a configured email webhook
 * @param webhook - Email webhook configuration
 * @param to - Recipient address
 * @param subject - Email subject
 * @param body - Email body
 */
export async function sendEmailViaWebhook(
  webhook: MessagingWebhookHttp,
  to: string,
  subject: string,
  body: string
): Promise<WebhookResult> {
  return executeWebhook(webhook, { EMAIL_TO: to, EMAIL_SUBJECT: subject, EMAIL_BODY: body });
}

/**
 * Send a Slack alert via a configured slack_alert webhook.
 * Webhook url uses {{SLACK_WEBHOOK}}, body uses {{SLACK_PROPERTIES}}.
 * {{SLACK_MESSAGE}} is substituted within channel properties values before sending.
 */
export async function sendSlackViaWebhook(
  webhook: MessagingWebhookHttp,
  text: string,
  channelData: { webhook_url: string; properties?: Record<string, unknown> }
): Promise<WebhookResult> {
  const props = channelData.properties ?? {};
  const jsonSafeMessage = JSON.stringify(text).slice(1, -1);
  const substitutedProps = substituteVariables(JSON.stringify(props), { SLACK_MESSAGE: jsonSafeMessage });

  return executeWebhook(webhook, {
    SLACK_WEBHOOK: channelData.webhook_url,
    SLACK_PROPERTIES: substitutedProps,
  });
}

/**
 * Validate a webhook configuration
 * Checks URL format, method, headers structure, and body JSON validity
 * @param webhook - Webhook configuration to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateWebhook(webhook: MessagingWebhook): string[] {
  if ('keyword' in webhook) return [];
  const errors: string[] = [];

  // Validate URL
  if (!webhook.url) {
    errors.push('URL is required');
  } else if (!/\{\{[^}]+\}\}/.test(webhook.url)) {
    // Skip URL validation for template variable URLs (e.g. {{SLACK_WEBHOOK}})
    try {
      const url = new URL(webhook.url);
      if (!url.protocol.startsWith('http')) {
        errors.push('URL must use http:// or https://');
      }
    } catch (err) {
      errors.push('Invalid URL format');
    }
  }

  // Validate method
  const validMethods = ['GET', 'POST', 'PUT'];
  if (!validMethods.includes(webhook.method)) {
    errors.push(`Method must be one of: ${validMethods.join(', ')}`);
  }

  // Validate headers (if present)
  if (webhook.headers) {
    if (typeof webhook.headers !== 'object' || Array.isArray(webhook.headers)) {
      errors.push('Headers must be an object (key-value pairs)');
    }
  }

  // Validate body (if present)
  // String body is a template placeholder (e.g. '{{SLACK_PROPERTIES}}') — substituted + JSON.parsed at runtime
  if (webhook.body !== undefined && typeof webhook.body !== 'string') {
    // Try to stringify to catch circular references
    try {
      JSON.stringify(webhook.body);
    } catch (err) {
      errors.push('Body must be valid JSON (no circular references)');
    }
  }

  return errors;
}
