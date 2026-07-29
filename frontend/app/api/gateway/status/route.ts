import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { getRawConfig } from '@/lib/data/configs.server';
import { resolveConfigSecrets } from '@/lib/secrets/config-secrets.server';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { fetchOrgStatus, fetchOrgUsage } from '@/lib/gateway/gateway-client.server';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';

/**
 * `GET /api/gateway/status` — what the plan & balance panel renders.
 *
 * The org secret never leaves the server: it lives in the secrets store as a
 * `@SECRETS/…` ref, is resolved here, and is used to call the gateway. The
 * browser receives only the resulting status.
 *
 * Returns `{ enabled: false }` rather than an error when no gateway is
 * configured — such a workspace is not in a broken state, it simply has no
 * billing to show, and the UI should render nothing rather than an error card.
 */
export async function GET() {
  try {
    const user = await getEffectiveUser();
    if (!user) return ApiErrors.unauthorized();

    const config = await getRawConfig(DEFAULT_MODE);
    const gateway = config.gateway;
    if (!gateway?.orgSecret) return successResponse({ enabled: false });

    // Spend is org-wide, so only an admin may see it.
    if (user.role !== 'admin') return ApiErrors.forbidden('Admins only');

    const resolved = await resolveConfigSecrets(gateway);
    const [status, usage] = await Promise.all([
      fetchOrgStatus(resolved.orgSecret),
      fetchOrgUsage(resolved.orgSecret, { days: 30, groupBy: 'day' }),
    ]);

    // A gateway outage is not a failure of this page — report it as
    // unreachable so the panel can say so instead of showing a stale zero.
    if (!status) return successResponse({ enabled: true, reachable: false });

    return successResponse({ enabled: true, reachable: true, status, usage: usage ?? [] });
  } catch (error) {
    return handleApiError(error);
  }
}
