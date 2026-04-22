import 'server-only';
import { AUTH_URL } from '@/lib/config';
import { UserDB } from '@/lib/database/user-db';
import { getConfigsForMode } from '@/lib/data/configs.server';
import type { AlertRecipient } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/**
 * Resolve email addresses from the normalized AlertRecipient list.
 * Returns a flat list of email addresses ready to send to.
 */
export async function resolveEmailAddresses(
  recipients: AlertRecipient[],
  user: EffectiveUser,
): Promise<string[]> {
  const emailRecipients = recipients.filter(r => r.channel === 'email');
  if (emailRecipients.length === 0) return [];

  const dbUsers = await UserDB.listAll();
  const userById = Object.fromEntries(dbUsers.map(u => [u.id, u]));
  const { config } = await getConfigsForMode(user.mode as Mode | undefined);

  const addresses: string[] = [];
  for (const r of emailRecipients) {
    if ('userId' in r) {
      const u = userById[r.userId];
      if (u?.email) addresses.push(u.email);
    } else {
      const ch = (config.channels ?? []).find(c => c.name === r.channelName && c.type === 'email');
      if (ch && ch.type === 'email') addresses.push(ch.address);
    }
  }
  return addresses;
}

/** Resolve the base URL (used in notification links). */
export async function resolveBaseUrl(): Promise<string> {
  return AUTH_URL;
}
