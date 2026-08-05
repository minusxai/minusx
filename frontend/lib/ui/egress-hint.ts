/**
 * Which source IPs a customer must allow through their database firewall.
 *
 * This is the deployment's EGRESS address — what the customer's database sees as
 * the source of an inbound connection — not the address the app is reached on.
 * The two differ behind NAT, a load balancer, or serverless egress pools, so the
 * value is configured (MX_EGRESS_IPS) rather than derived from the request.
 *
 * Unset is the off switch, and that is how self-hosted installs opt out: there
 * the egress address belongs to the operator's own network, so showing anything
 * would point people at the wrong firewall.
 */
import { immutableSet } from '@/lib/utils/immutable-collections';

/** Engines reached over the network at host:port, where a firewall sits in the path. */
const NETWORK_REACHED_TYPES = immutableSet(['postgresql', 'clickhouse']);

/** Split a comma/whitespace-separated env value into a de-duplicated list. */
export function parseEgressIps(raw: string | undefined | null): string[] {
  const parts = (raw ?? '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

/**
 * Whether an IP allowlist hint is meaningful for this connection type.
 *
 * False for BigQuery and Athena: they are reached over public service endpoints
 * and gated by IAM credentials, so source-IP allowlisting is the wrong lever.
 * False for file-backed sources, which open no outbound connection at all.
 */
export function connectionTypeNeedsEgressHint(type: string | undefined | null): boolean {
  return type ? NETWORK_REACHED_TYPES.has(type) : false;
}
