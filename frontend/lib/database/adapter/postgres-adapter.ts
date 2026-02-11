import { Pool, PoolClient } from 'pg';
import { IDatabaseAdapter, ITransactionContext, QueryResult } from './types';
import { POSTGRES_SCHEMA } from '../postgres-schema';

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
      process.env.POSTGRES_URL ||
      'postgresql://localhost:5432/atlas';
  }

  /**
   * Get or initialize connection pool
   */
  private getPool(): Pool {
    if (!this.pool) {
      const schema = process.env.POSTGRES_SCHEMA || 'public';

      this.pool = new Pool({
        connectionString: this.connectionString,
        // Set search_path to look in specified schema first, then public
        options: `-c search_path=${schema},public`,
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

    try {
      const result = await pool.query(sql, params);
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
          const result = await client.query(sql, params || []);
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
   * Initialize PostgreSQL-specific schema
   * Includes tables, indexes, triggers, and functions
   */
  async initializeSchema(): Promise<void> {
    // Execute PostgreSQL-specific schema
    await this.exec(POSTGRES_SCHEMA);
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
