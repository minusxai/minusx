import 'server-only';
import { AUTH_URL } from '@/lib/config';
import { CompanyDB } from '@/lib/database/company-db';
import { isSubdomainRoutingEnabled } from '@/lib/utils/subdomain';

/** Resolve the base URL for a company (used in notification links). */
export async function resolveBaseUrl(companyId: number): Promise<string> {
  if (!isSubdomainRoutingEnabled()) return AUTH_URL;
  const company = await CompanyDB.getById(companyId);
  if (!company?.subdomain) return AUTH_URL;
  const url = new URL(AUTH_URL);
  return `${url.protocol}//${company.subdomain}.${url.host}`;
}
