import { PGlite } from '@electric-sql/pglite';
import { IDatabaseAdapter, ITransactionContext, QueryResult } from './types';
import { POSTGRES_SCHEMA, splitSQLStatements } from '../postgres-schema';

/**
 * PGLite adapter — in-process Postgres-compatible engine.
 * Open-source embedded Postgres-compatible database. Same SQL dialect as PostgresAdapter.
 *
 * IMPORTANT: This is the ONLY file that should import @electric-sql/pglite
 */
export class PgliteAdapter implements IDatabaseAdapter {
  private db: PGlite;
  private schemaInitialized = false;

  /** @param dataDir - undefined = in-memory (tests); path = filesystem-backed (prod) */
  constructor(dataDir?: string) {
    // Return TIMESTAMP/TIMESTAMPTZ columns as ISO strings rather than Date objects.
    // PGLite's default is Date objects, but the rest of the codebase (DbRow, Redux state)
    // expects strings, and Date objects fail Redux Toolkit's serializableStateInvariantMiddleware.
    const parsers = {
      1082: (v: string) => v,                                          // date
      1114: (v: string) => v.replace(' ', 'T') + 'Z',                 // timestamp
      1184: (v: string) => new Date(v).toISOString(),                  // timestamptz
    };
    this.db = dataDir ? new PGlite(dataDir, { parsers }) : new PGlite({ parsers });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(sql, params);
    return {
      rows: result.rows as T[],
      rowCount: result.affectedRows ?? result.rows.length,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (pgtx) => {
      const txContext: ITransactionContext = {
        query: async <U>(sql: string, p?: any[]) => {
          const r = await pgtx.query<U>(sql, p ?? []);
          return { rows: r.rows as U[], rowCount: r.affectedRows ?? r.rows.length };
        },
        exec: (sql: string) => pgtx.exec(sql).then(() => undefined),
      };
      return fn(txContext);
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async initializeSchema(): Promise<void> {
    if (this.schemaInitialized) return;
    await this.db.waitReady;
    for (const stmt of splitSQLStatements(POSTGRES_SCHEMA)) {
      // PGLite always starts with the public schema; CREATE SCHEMA IF NOT EXISTS public
      // causes a WASM abort in PGLite even with IF NOT EXISTS.
      if (/^\s*CREATE\s+SCHEMA\b/i.test(stmt)) continue;
      try {
        await this.db.exec(stmt);
      } catch (error: any) {
        if (error?.code === '23505' || error?.code === '42710') continue;
        throw error;
      }
    }
    this.schemaInitialized = true;
  }

  async optimize(): Promise<void> {
    // No-op — PGLite is in-process, no WAL checkpoint needed
  }
}
