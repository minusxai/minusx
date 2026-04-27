import { Pool, PoolClient } from 'pg';
import { IDatabaseAdapter, ITransactionContext, QueryResult } from './types';
import { POSTGRES_SCHEMA, splitSQLStatements } from '../postgres-schema';
import { POSTGRES_URL, POSTGRES_SCHEMA as CONFIG_POSTGRES_SCHEMA } from '@/lib/config';

/**
 * PostgreSQL adapter using node-postgres (pg) with connection pooling
 * Uses native $1, $2 placeholder syntax (no translation needed)
 *
 * IMPORTANT: This is the ONLY file that should import pg
 */
export class PostgresAdapter implements IDatabaseAdapter {
  private pool: Pool | null = null;
  private connectionString: string;

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

    // pg serializes JS arrays as Postgres arrays {1,2,...} not JSON [1,2,...].
    // All array columns in this schema are JSONB, so stringify arrays explicitly.
    const serialized = params.map(p => Array.isArray(p) ? JSON.stringify(p) : p);

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
          const serializedTx = (params || []).map((p: any) => Array.isArray(p) ? JSON.stringify(p) : p);
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
}
