import { Pool, PoolClient } from 'pg';
import { IDatabaseAdapter, ITransactionContext, QueryResult, isSqlArray } from './types';
import { POSTGRES_SCHEMA, splitSQLStatements } from '../postgres-schema';
import { POSTGRES_URL, POSTGRES_SCHEMA as CONFIG_POSTGRES_SCHEMA } from '@/lib/config';

/**
 * Serialize params for node-postgres. pg binds a JS array as a Postgres array
 * literal `{...}` — correct for `= ANY($1)` but invalid for a JSONB column (wants
 * JSON `[...]`). So plain arrays are JSON-stringified (JSONB), while `sqlArray()`-
 * wrapped params are passed through as native arrays (ANY()/array params).
 */
export function serializePgParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (isSqlArray(p)) return p.values;
    if (Array.isArray(p)) return JSON.stringify(p);
    return p;
  });
}

/**
 * PostgreSQL adapter using node-postgres (pg) with connection pooling
 * Uses native $1, $2 placeholder syntax (no translation needed)
 *
 * IMPORTANT: This is the ONLY file that should import pg
 */
/** Channel names go straight into `LISTEN` (not parameterizable) — allow only safe identifiers. */
function assertSafeChannel(channel: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(channel)) {
    throw new Error(`unsafe NOTIFY channel name: ${channel}`);
  }
}

export class PostgresAdapter implements IDatabaseAdapter {
  private pool: Pool | null = null;
  private connectionString: string;

  // A single dedicated client holds every LISTEN for this process and fans NOTIFYs out in-memory to
  // per-channel callback sets. One connection (not one per subscriber) keeps the pool free.
  private listenClient: PoolClient | null = null;
  private listenSetup: Promise<PoolClient> | null = null;
  private readonly channelHandlers = new Map<string, Set<(payload: string) => void>>();

  constructor(connectionString?: string) {
    this.connectionString =
      connectionString ||
      POSTGRES_URL ||
      'postgresql://localhost:5432/atlas';
  }

  /**
   * Get or initialize connection pool
   */
  private getPool(): Pool {
    if (!this.pool) {
      const schema = CONFIG_POSTGRES_SCHEMA;

      this.pool = new Pool({
        connectionString: this.connectionString,
        // Set search_path to look in specified schema first, then public
        options: `-c search_path=${schema},public`,
        // Fail fast if pool can't acquire a connection within 30s (prevents infinite hangs)
        connectionTimeoutMillis: 30000,
        // Evict idle connections before the server/firewall kills them silently
        idleTimeoutMillis: 30000,
        // TCP keepalives prevent firewalls/proxies from dropping long-idle connections
        keepAlive: true,
        ssl: { rejectUnauthorized: false },
      });

      // Handle pool errors
      this.pool.on('error', (err: Error) => {
        console.error('[PostgresAdapter] Unexpected pool error:', err);
      });
    }
    return this.pool;
  }

  /**
   * Execute parameterized query
   * Handles both SELECT (returns rows) and INSERT/UPDATE/DELETE (returns rowCount)
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const pool = this.getPool();

    const serialized = serializePgParams(params);

    try {
      const result = await pool.query(sql, serialized);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount || 0,
      };
    } catch (error) {
      console.error('[PostgresAdapter] Query error:', { sql, params, error });
      throw error;
    }
  }

  /**
   * Execute SQL without returning results
   */
  async exec(sql: string): Promise<void> {
    const pool = this.getPool();
    await pool.query(sql);
  }

  /**
   * Execute transaction with dedicated client
   */
  async transaction<T>(fn: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    const pool = this.getPool();
    const client: PoolClient = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create transaction context that uses dedicated client
      const txContext: ITransactionContext = {
        query: async <U>(sql: string, params?: any[]) => {
          const serializedTx = serializePgParams(params || []);
          const result = await client.query(sql, serializedTx);
          return {
            rows: result.rows as U[],
            rowCount: result.rowCount || 0,
          };
        },
        exec: async (sql: string) => {
          await client.query(sql);
        },
      };

      const result = await fn(txContext);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Close connection pool
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Initialize PostgreSQL-specific schema.
   * Runs each statement individually so errors are proper Promise rejections.
   * Concurrent Turbopack workers race on CREATE OR REPLACE FUNCTION (23505) and
   * CREATE TRIGGER (42710) — both are safe to ignore when another worker wins.
   */
  async initializeSchema(): Promise<void> {
    const pool = this.getPool();
    for (const stmt of splitSQLStatements(POSTGRES_SCHEMA)) {
      try {
        await pool.query(stmt);
      } catch (error: any) {
        if (error?.code === '23505' || error?.code === '42710') continue;
        throw error;
      }
    }
  }

  /**
   * Optimize PostgreSQL database
   * No-op for now - PostgreSQL auto-vacuum handles maintenance
   * Could add VACUUM ANALYZE in the future if needed
   */
  async optimize(): Promise<void> {
    // PostgreSQL auto-vacuum handles maintenance
    // Future: Could run VACUUM ANALYZE for manual optimization
  }

  // ── LISTEN/NOTIFY (chat v3 streaming wakeup) ──────────────────────────────

  async notify(channel: string, payload: string): Promise<void> {
    assertSafeChannel(channel);
    // pg_notify takes the channel as a value (safe) — no identifier interpolation needed.
    await this.getPool().query('SELECT pg_notify($1, $2)', [channel, payload]);
  }

  /** Lazily acquire the shared listener client and wire its notification dispatch. */
  private async getListenClient(): Promise<PoolClient> {
    if (this.listenClient) return this.listenClient;
    if (this.listenSetup) return this.listenSetup;
    this.listenSetup = (async () => {
      const client = await this.getPool().connect();
      client.on('notification', (msg) => {
        const handlers = this.channelHandlers.get(msg.channel);
        if (handlers) for (const h of handlers) h(msg.payload ?? '');
      });
      // On connection loss, drop it so the next listen() rebuilds + re-LISTENs every channel.
      const reset = () => {
        if (this.listenClient === client) { this.listenClient = null; this.listenSetup = null; }
      };
      client.on('error', reset);
      client.on('end', reset);
      this.listenClient = client;
      return client;
    })();
    return this.listenSetup;
  }

  async listen(channel: string, onNotify: (payload: string) => void): Promise<() => Promise<void>> {
    assertSafeChannel(channel);
    const client = await this.getListenClient();
    let handlers = this.channelHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channelHandlers.set(channel, handlers);
      await client.query(`LISTEN "${channel}"`);
    }
    handlers.add(onNotify);

    return async () => {
      const set = this.channelHandlers.get(channel);
      if (!set) return;
      set.delete(onNotify);
      if (set.size === 0) {
        this.channelHandlers.delete(channel);
        try { await this.listenClient?.query(`UNLISTEN "${channel}"`); } catch { /* connection gone */ }
      }
    };
  }
}
