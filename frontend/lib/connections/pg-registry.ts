import 'server-only';
import { Pool } from 'pg';

// Keyed by "host:port:database:user" — one pool per unique Postgres target, process-wide.
// This prevents pool accumulation when multiple PostgresConnector instances
// reference the same database (e.g. during benchmark runs or fuzzy search).
// eslint-disable-next-line no-restricted-syntax -- server-only; keyed by connection identity
const registry = new Map<string, Pool>();

function poolKey(config: Record<string, any>): string {
  if (config.connection_string) return config.connection_string;
  const host = config.host ?? 'localhost';
  const port = String(config.port ?? 5432);
  const database = config.database ?? '';
  const user = config.username ?? '';
  return `${host}:${port}:${database}:${user}`;
}

export function getOrCreatePgPool(config: Record<string, any>): Pool {
  const key = poolKey(config);
  if (registry.has(key)) return registry.get(key)!;

  const pool = config.connection_string
    ? new Pool({ connectionString: config.connection_string })
    : new Pool({
        host: config.host ?? 'localhost',
        port: Number(config.port ?? 5432),
        database: config.database,
        user: config.username,
        password: config.password ?? undefined,
        ssl: config.ssl ?? { rejectUnauthorized: false },
      });
  registry.set(key, pool);
  return pool;
}

/** Clear all cached pools. Useful in tests where `pg` is mocked per-test. */
export function clearPgPoolRegistry(): void {
  registry.clear();
}
