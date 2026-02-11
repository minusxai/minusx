/**
 * Webhook executor for sending messages via configured webhooks
 * Supports template variable substitution in headers and body
 */

import { MessagingWebhook } from '../types';
import { substituteVariables } from './template-variables';

export interface WebhookResult {
  success: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * Execute a webhook with template variable substitution
 * @param webhook - Webhook configuration
 * @param variables - Variables to substitute (e.g., { USER_NUMBER: '+1234567890', AUTH_OTP: '123456' })
 * @returns Result indicating success or failure
 */
export async function executeWebhook(
  webhook: MessagingWebhook,
  variables: Record<string, string>
): Promise<WebhookResult> {
  try {
    // 1. Substitute variables in headers
    const headers: Record<string, string> = {};
    if (webhook.headers) {
      for (const [key, value] of Object.entries(webhook.headers)) {
        headers[key] = substituteVariables(value, variables);
      }
    }

    // 2. Substitute variables in body (recursively for nested objects)
    let body: any = undefined;
    if (webhook.body) {
      const bodyStr = JSON.stringify(webhook.body);
      const substitutedStr = substituteVariables(bodyStr, variables);
      body = JSON.parse(substitutedStr);
    }

    // 3. Make HTTP request
    const response = await fetch(webhook.url, {
      method: webhook.method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
      };
    }

    return { success: true, statusCode: response.status };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
}

/**
 * Validate a webhook configuration
 * Checks URL format, method, headers structure, and body JSON validity
 * @param webhook - Webhook configuration to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateWebhook(webhook: MessagingWebhook): string[] {
  const errors: string[] = [];

  // Validate URL
  if (!webhook.url) {
    errors.push('URL is required');
  } else {
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
  if (webhook.body !== undefined) {
    if (typeof webhook.body !== 'object') {
      errors.push('Body must be an object');
    }
    // Try to stringify to catch circular references
    try {
      JSON.stringify(webhook.body);
    } catch (err) {
      errors.push('Body must be valid JSON (no circular references)');
    }
  }

  return errors;
}
