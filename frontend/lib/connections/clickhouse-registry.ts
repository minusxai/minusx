import 'server-only';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

// Process-wide ClickHouse client cache, keyed by url+database+user. The
// `@clickhouse/client` keeps an HTTP keep-alive socket pool per client, so
// reusing one client across the many short-lived ClickHouseConnector instances
// (fuzzy search, profiling, benchmark loops) avoids socket accumulation —
// the same leak the Mongo connector hit.
// eslint-disable-next-line no-restricted-syntax -- server-only; keyed by connection identity
const registry = new Map<string, ClickHouseClient>();

/** Build the HTTP-interface base URL. Defaults: https + 8443, or http + 8123. */
export function clickHouseUrl(config: Record<string, any>): string {
  const protocol = config.protocol === 'http' ? 'http' : 'https';
  const host = config.host ?? 'localhost';
  const port = config.port ?? (protocol === 'https' ? 8443 : 8123);
  return `${protocol}://${host}:${port}`;
}

function clientKey(config: Record<string, any>): string {
  return `${clickHouseUrl(config)}|${config.database ?? ''}|${config.username ?? ''}`;
}

export function getOrCreateClickHouseClient(config: Record<string, any>): ClickHouseClient {
  const key = clientKey(config);
  const existing = registry.get(key);
  if (existing) return existing;

  const client = createClient({
    url: clickHouseUrl(config),
    username: config.username ?? 'default',
    password: config.password ?? '',
    // Default database for unqualified table names. Omit when blank so the
    // server's own default applies.
    database: config.database || undefined,
  });
  registry.set(key, client);
  return client;
}

/** Clear all cached clients. Used in tests where `@clickhouse/client` is mocked per-test. */
export function clearClickHouseRegistry(): void {
  registry.clear();
}
