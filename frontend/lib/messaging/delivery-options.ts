/**
 * Pure functions for computing DeliveryPicker options.
 * Extracted so they can be unit tested independently of React.
 */

import type { CompanyConfig } from '@/lib/branding/whitelabel';
import type { AlertRecipient, ConfigChannel, User } from '@/lib/types';

export type SlackChannel  = Extract<ConfigChannel, { type: 'slack' }>;
export type EmailChannel  = Extract<ConfigChannel, { type: 'email' }>;
export type PhoneChannel  = Extract<ConfigChannel, { type: 'phone' }>;

export type DropdownOption =
  | { kind: 'email_alert'; via: 'user';    user: User }
  | { kind: 'phone_alert'; via: 'user';    user: User }
  | { kind: 'slack_alert'; via: 'channel'; channel: SlackChannel }
  | { kind: 'email_alert'; via: 'channel'; channel: EmailChannel }
  | { kind: 'phone_alert'; via: 'channel'; channel: PhoneChannel };

function webhookTypes(config: CompanyConfig): Set<string> {
  return new Set(config.messaging?.webhooks?.map(w => w.type) ?? []);
}

function configChannels(config: CompanyConfig) {
  return {
    slack: (config.channels ?? []).filter((c): c is SlackChannel => c.type === 'slack'),
    email: (config.channels ?? []).filter((c): c is EmailChannel => c.type === 'email'),
    phone: (config.channels ?? []).filter((c): c is PhoneChannel => c.type === 'phone'),
  };
}

export function hasDeliveryEnabled(config: CompanyConfig, users: User[]): boolean {
  const types = webhookTypes(config);
  const ch = configChannels(config);
  return (
    (types.has('email_alert') && (users.length > 0 || ch.email.length > 0)) ||
    (types.has('phone_alert') && (users.some(u => u.phone) || ch.phone.length > 0)) ||
    (types.has('slack_alert') && ch.slack.length > 0)
  );
}

export function buildDropdownOptions(
  config: CompanyConfig,
  users: User[],
  recipients: AlertRecipient[],
  query: string,
): DropdownOption[] {
  const types = webhookTypes(config);
  const ch = configChannels(config);
  const selected = new Set(recipients.map(r => `${r.channel}:${r.address}`));
  const q = query.toLowerCase();
  const opts: DropdownOption[] = [];

  for (const user of users) {
    const matches = !q || user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q);
    if (!matches) continue;
    if (types.has('email_alert') && !selected.has(`email_alert:${user.email}`)) {
      opts.push({ kind: 'email_alert', via: 'user', user });
    }
    if (types.has('phone_alert') && user.phone && !selected.has(`phone_alert:${user.phone}`)) {
      opts.push({ kind: 'phone_alert', via: 'user', user });
    }
  }

  if (types.has('email_alert')) {
    for (const c of ch.email) {
      if (!selected.has(`email_alert:${c.address}`)) opts.push({ kind: 'email_alert', via: 'channel', channel: c });
    }
  }
  if (types.has('phone_alert')) {
    for (const c of ch.phone) {
      if (!selected.has(`phone_alert:${c.address}`)) opts.push({ kind: 'phone_alert', via: 'channel', channel: c });
    }
  }
  if (types.has('slack_alert')) {
    for (const c of ch.slack) {
      if (!recipients.some(r => r.channel === 'slack_alert' && r.address === c.name)) {
        opts.push({ kind: 'slack_alert', via: 'channel', channel: c });
      }
    }
  }

  return opts;
}
