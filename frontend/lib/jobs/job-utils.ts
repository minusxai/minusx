import 'server-only';
import { AUTH_URL } from '@/lib/config';
import { CompanyDB } from '@/lib/database/company-db';
import { isSubdomainRoutingEnabled } from '@/lib/utils/subdomain';
import { UserDB } from '@/lib/database/user-db';
import { getConfigsByCompanyId } from '@/lib/data/configs.server';
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

  const dbUsers = await UserDB.listByCompany(user.companyId);
  const userById = Object.fromEntries(dbUsers.map(u => [u.id, u]));
  const { config } = await getConfigsByCompanyId(user.companyId, user.mode as Mode | undefined);

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

/** Resolve the base URL for a company (used in notification links). */
export async function resolveBaseUrl(companyId: number): Promise<string> {
  if (!isSubdomainRoutingEnabled()) return AUTH_URL;
  const company = await CompanyDB.getById(companyId);
  if (!company?.subdomain) return AUTH_URL;
  const url = new URL(AUTH_URL);
  return `${url.protocol}//${company.subdomain}.${url.host}`;
}
