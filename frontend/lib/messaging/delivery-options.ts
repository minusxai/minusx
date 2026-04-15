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
  | { kind: 'email'; via: 'user';    user: User }
  | { kind: 'phone'; via: 'user';    user: User }
  | { kind: 'slack'; via: 'channel'; channel: SlackChannel }
  | { kind: 'email'; via: 'channel'; channel: EmailChannel }
  | { kind: 'phone'; via: 'channel'; channel: PhoneChannel };

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

function recipientKey(r: AlertRecipient): string {
  return 'userId' in r ? `user:${r.userId}:${r.channel}` : `channel:${r.channelName}:${r.channel}`;
}

export function buildDropdownOptions(
  config: CompanyConfig,
  users: User[],
  recipients: AlertRecipient[],
  query: string,
): DropdownOption[] {
  const types = webhookTypes(config);
  const ch = configChannels(config);
  const selected = new Set(recipients.map(recipientKey));
  const q = query.toLowerCase();
  const opts: DropdownOption[] = [];

  for (const user of users) {
    if (!user.id) continue;
    const matches = !q || user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q);
    if (!matches) continue;
    if (types.has('email_alert') && !selected.has(`user:${user.id}:email`)) {
      opts.push({ kind: 'email', via: 'user', user });
    }
    if (types.has('phone_alert') && user.phone && !selected.has(`user:${user.id}:phone`)) {
      opts.push({ kind: 'phone', via: 'user', user });
    }
  }

  if (types.has('email_alert')) {
    for (const c of ch.email) {
      if (!selected.has(`channel:${c.name}:email`)) opts.push({ kind: 'email', via: 'channel', channel: c });
    }
  }
  if (types.has('phone_alert')) {
    for (const c of ch.phone) {
      if (!selected.has(`channel:${c.name}:phone`)) opts.push({ kind: 'phone', via: 'channel', channel: c });
    }
  }
  if (types.has('slack_alert')) {
    for (const c of ch.slack) {
      if (!selected.has(`channel:${c.name}:slack`)) opts.push({ kind: 'slack', via: 'channel', channel: c });
    }
  }

  return opts;
}
