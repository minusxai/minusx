/**
 * Types for the MinusX gateway — the hosted service that provides model access
 * and tracks usage for MinusX-operated workspaces.
 *
 * This is the whole client surface. The app stores three credentials, sends
 * inference to the gateway, and reads a status object to render. It holds no
 * billing logic of its own: how plans, balances or expiry work is the service's
 * business, and this file only describes the shape that comes back.
 *
 * Self-hosted installs never use any of this — see `gateway-client.server.ts`.
 */

/** Where the credentials live inside a workspace's config document. */
export const GATEWAY_CONFIG_KEY = 'gateway' as const;

/**
 * Returned once when a workspace is registered and not retrievable afterwards,
 * which is why registration persists them immediately.
 */
export interface GatewayCredentials {
  /** Public id, safe to log. */
  orgId: string;
  /** Manages the account: status, usage, keys. Stored as a `@SECRETS/…` ref. */
  orgSecret: string;
  /** Public id of the first API key. */
  keyId: string;
  /** The inference credential. Stored as a `@SECRETS/…` ref. */
  key: string;
}

/** Account status, as the settings panel renders it. Money is integer micro-USD. */
export interface GatewayOrgStatus {
  orgId: string;
  /**
   * Whether a plan is currently active. This is a label to display — it is not
   * permission to spend, and the app must not gate requests on it.
   */
  subscribed: boolean;
  /**
   * Whether the plan is expected to renew. `subscribed` alone cannot tell
   * "renews on the 1st" from "ends on the 1st", so the panel needs both.
   */
  willRenew: boolean;
  accessExpiresAt: string | null;
  plan: string | null;
  /** Differs from `plan` only while a change is scheduled. */
  nextPlan: string | null;
  balanceMicroUsd: number;
  /** Balance due to expire soon, so the panel can warn before it goes. */
  expiringSoonMicroUsd: number;
  /** Null when there is no plan to measure against. */
  periodGrantedMicroUsd: number | null;
  periodUsedMicroUsd: number | null;
  /** Already clamped to [0, 1] by the service. */
  percentUsed: number | null;
}

/** One row of the spend breakdown. */
export interface GatewayUsageRow {
  day: string;
  keyId: string | null;
  model: string | null;
  agent: string | null;
  microUsd: number;
  calls: number;
}

/** The wire format is integer micro-USD: $1 == 1_000_000. */
export const MICRO_PER_USD = 1_000_000;

export function microToUsd(micro: number): number {
  return micro / MICRO_PER_USD;
}
