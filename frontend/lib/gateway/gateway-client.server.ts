import 'server-only';

/**
 * Client for the MinusX gateway — the hosted service that provides model access
 * for MinusX-operated workspaces.
 *
 * Two env vars turn this on, and if either is missing NOTHING here runs. That
 * is the default, and the most important property in this file: an install must
 * never reach out to a hosted service because one variable happened to be set
 * in its environment.
 *
 * Everything is best-effort. Registration has already committed by the time
 * `createGatewayOrg` runs, so an outage degrades to "no gateway configured" —
 * the workspace still exists and an admin can configure a provider by hand.
 * Failing signup instead would leave a workspace that cannot be registered
 * again.
 */

import { MINUSX_AUTO_MODEL } from '@/lib/llm/minusx-default';
import { MINUSX_PROVIDER, type LlmConfig } from '@/lib/llm/llm-config-types';
import { AUTH_URL, MX_GATEWAY_ORIGIN, MX_GATEWAY_SHARED_SECRET } from '@/lib/config';
import { GIT_COMMIT_SHA } from '@/lib/constants';

import type {
  GatewayCredentials, GatewayOrgStatus, GatewayUsageRow,
} from './gateway-types';

/** Name of the provider entry written into a new workspace's LLM config. */
const GATEWAY_PROVIDER_NAME = 'minusx';

const REQUEST_TIMEOUT_MS = 10_000;

function baseUrl(): string {
  return MX_GATEWAY_ORIGIN;
}

/**
 * Both variables, or nothing. Half-configured is OFF rather than an error, so
 * setting one by accident still leaves a working install.
 */
export function gatewayEnabled(): boolean {
  return Boolean(baseUrl() && MX_GATEWAY_SHARED_SECRET);
}

async function call<T>(
  path: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<T | null> {
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Log the body, not just the status. Every failure here is silent by
      // design — the workspace still registers, it simply has no gateway — so
      // this line is the ONLY way anyone finds out why, and "-> 409" without
      // the reason sends you looking in the wrong place.
      const detail = await response.text().catch(() => '');
      console.warn(
        `[gateway] ${init.method ?? 'GET'} ${path} -> ${response.status} ${detail}`,
      );
      return null;
    }
    return (await response.json()) as T;
  } catch (err) {
    console.warn(`[gateway] ${init.method ?? 'GET'} ${path} failed:`, err);
    return null;
  }
}

/**
 * Register this workspace with the gateway and mint its first key.
 *
 * The returned secret and key are visible exactly once, so the caller must
 * persist them immediately — there is no way to read them back.
 */
export async function createGatewayOrg(
  input: { email: string; workspaceName: string },
): Promise<GatewayCredentials | null> {
  if (!gatewayEnabled()) return null;

  const body = await call<{
    org_id: string; org_secret: string; key_id: string; key: string;
  }>('/orgs', {
    method: 'POST',
    headers: { 'x-mx-shared-secret': MX_GATEWAY_SHARED_SECRET! },
    body: JSON.stringify({
      email: input.email,
      // Identifiers the service carries back to us for support. An install IS
      // one workspace — registration refuses a second — so its name and the
      // admin email are what exist at this point.
      //
      // The origin and build go with them because an org id on its own is not
      // something a human can act on: together these answer "which install is
      // this, where does it run, and what is it running". Always all three,
      // even when unset — the localhost/`unknown` defaults are themselves the
      // signal, where an absent key would just look like an older client.
      props: {
        workspace_name: input.workspaceName,
        app_url: AUTH_URL,
        app_commit: GIT_COMMIT_SHA,
      },
    }),
  });
  if (!body) return null;

  return {
    orgId: body.org_id,
    orgSecret: body.org_secret,
    keyId: body.key_id,
    key: body.key,
  };
}

/** Account status, for the settings panel. */
export async function fetchOrgStatus(orgSecret: string): Promise<GatewayOrgStatus | null> {
  if (!baseUrl() || !orgSecret) return null;

  const body = await call<Record<string, unknown>>('/org', {
    method: 'GET',
    headers: { 'x-mx-org-secret': orgSecret },
  });
  if (!body) return null;

  return {
    orgId: String(body.org_id ?? ''),
    subscribed: Boolean(body.subscribed),
    willRenew: Boolean(body.will_renew),
    accessExpiresAt: (body.access_expires_at as string | null) ?? null,
    plan: (body.plan as string | null) ?? null,
    nextPlan: (body.next_plan as string | null) ?? null,
    balanceMicroUsd: Number(body.balance_micro_usd ?? 0),
    expiringSoonMicroUsd: Number(body.expiring_soon_micro_usd ?? 0),
    periodGrantedMicroUsd: (body.period_granted_micro_usd as number | null) ?? null,
    periodUsedMicroUsd: (body.period_used_micro_usd as number | null) ?? null,
    percentUsed: (body.percent_used as number | null) ?? null,
  };
}

/** Spend breakdown, for the settings panel. */
export async function fetchOrgUsage(
  orgSecret: string,
  opts: { days?: number; groupBy?: string } = {},
): Promise<GatewayUsageRow[] | null> {
  if (!baseUrl() || !orgSecret) return null;

  const params = new URLSearchParams({
    days: String(opts.days ?? 30),
    group_by: opts.groupBy ?? 'day',
  });
  const rows = await call<Array<Record<string, unknown>>>(`/org/usage?${params}`, {
    method: 'GET',
    headers: { 'x-mx-org-secret': orgSecret },
  });
  if (!rows) return null;

  return rows.map((r) => ({
    day: String(r.day ?? ''),
    keyId: (r.key_id as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    agent: (r.agent as string | null) ?? null,
    microUsd: Number(r.micro_usd ?? 0),
    calls: Number(r.calls ?? 0),
  }));
}

/**
 * The LLM config a gateway-backed workspace starts with: one provider, every
 * grade pointed at it.
 *
 * All three grades are set deliberately — wiring only `core` would leave a new
 * workspace on "no model configured" for the other two. The model is the
 * `minusx-auto` sentinel, which lets the gateway choose from the routing
 * headers rather than pinning anything here.
 *
 * No `baseUrl` is written. This document is PERSISTED at registration, so a
 * pinned URL is frozen into the workspace forever — moving the gateway later
 * would leave every already-registered workspace calling the old address, and
 * an internal address (a container hostname, say) would be baked in for good.
 * Left unset, inference resolves from `MINUSX_GATEWAY_URL`, which is derived
 * from the same origin this client registered against, so the two cannot drift
 * and the deployment stays free to move.
 */
export function buildGatewayLlmConfig(apiKey: string): LlmConfig {
  const choice = { providerName: GATEWAY_PROVIDER_NAME, model: MINUSX_AUTO_MODEL };
  return {
    providers: [{
      name: GATEWAY_PROVIDER_NAME,
      provider: MINUSX_PROVIDER,
      apiKey,
    }],
    grades: { lite: { ...choice }, core: { ...choice }, advanced: { ...choice } },
  };
}
