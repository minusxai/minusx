import 'server-only';
import { createHash } from 'node:crypto';
import { createPool, type Pool, type PoolOptions } from 'mysql2';

// eslint-disable-next-line no-restricted-syntax -- server-only pool cache, isolated by credentials and TLS settings
const registry = new Map<string, Pool>();

export function getOrCreateMySqlPool(config: Record<string, any>): Pool {
  const port = Number(config.port ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MySQL port must be between 1 and 65535');
  if (config.ssl_mode && !['disabled', 'required'].includes(config.ssl_mode)) throw new Error('Invalid MySQL TLS mode');
  const options: PoolOptions = {
    host: config.host || 'localhost',
    port,
    user: config.username,
    password: config.password ?? '',
    database: config.database || undefined,
    ssl: config.ssl_mode === 'required' ? { rejectUnauthorized: true } : undefined,
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    multipleStatements: false,
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 60_000,
    connectTimeout: 10_000,
    // Do not negotiate LOCAL INFILE for an analytics connection.
    flags: ['-LOCAL_FILES'],
  };
  const key = createHash('sha256').update(JSON.stringify(options)).digest('hex');
  let pool = registry.get(key);
  if (!pool) {
    pool = createPool(options);
    registry.set(key, pool);
  }
  return pool;
}

/** Close cached pools, including their idle sockets. */
export async function closeMySqlPools(): Promise<void> {
  const pools = [...registry.values()];
  registry.clear();
  await Promise.all(pools.map(pool => new Promise<void>((resolve, reject) => {
    pool.end(error => error ? reject(error) : resolve());
  })));
}
