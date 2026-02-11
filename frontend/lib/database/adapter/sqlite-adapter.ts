import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { IDatabaseAdapter, ITransactionContext, QueryResult } from './types';
import { DB_DIR, DB_PATH } from '../db-config';
import { DATABASE_SCHEMA } from '../schema';

/**
 * SQLite adapter that wraps better-sqlite3 with async interface
 * Translates $1, $2 placeholders to ? placeholders
 *
 * IMPORTANT: This is the ONLY file that should import better-sqlite3
 */
export class SqliteAdapter implements IDatabaseAdapter {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    const rawPath = dbPath || process.env.DATABASE_URL || DB_PATH;

    // Validate path stays within allowed data directories to prevent path traversal
    const normalizedPath = path.resolve(rawPath);
    const configuredDataDir = path.resolve(DB_DIR);
    const localDataDir = path.resolve(process.cwd(), 'data');

    const isInConfiguredDir = normalizedPath === configuredDataDir || normalizedPath.startsWith(configuredDataDir + path.sep);
    const isInLocalDir = normalizedPath === localDataDir || normalizedPath.startsWith(localDataDir + path.sep);

    if (!isInConfiguredDir && !isInLocalDir) {
      throw new Error(`Database path must be within data directories: ${rawPath}`);
    }

    this.dbPath = normalizedPath;
  }

  /**
   * Get or initialize database connection
   * Automatically initializes schema when creating a new database file
   */
  private getConnection(): Database.Database {
    if (!this.db) {
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      const isNewDatabase = !fs.existsSync(this.dbPath);

      // Create database connection
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      // Initialize schema for new databases
      if (isNewDatabase) {
        this.db.exec(DATABASE_SCHEMA);
      }
    }
    return this.db;
  }

  /**
   * Translate $1, $2, ... to ?, ?, ...
   */
  private translateParams(sql: string): string {
    return sql.replace(/\$\d+/g, '?');
  }

  /**
   * Execute parameterized query
   * Handles both SELECT (returns rows) and INSERT/UPDATE/DELETE (returns rowCount)
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const db = this.getConnection();
    const translatedSql = this.translateParams(sql);

    try {
      const stmt = db.prepare(translatedSql);

      // Check if this is a SELECT statement (returns data)
      const trimmedSql = sql.trim().toUpperCase();
      const isSelect = trimmedSql.startsWith('SELECT') || trimmedSql.startsWith('WITH');

      if (isSelect) {
        // Use .all() for SELECT statements
        const rows = stmt.all(...params) as T[];
        return {
          rows,
          rowCount: rows.length
        };
      } else {
        // Use .run() for INSERT/UPDATE/DELETE statements
        const result = stmt.run(...params);
        return {
          rows: [] as T[],
          rowCount: result.changes
        };
      }
    } catch (error) {
      console.error('[SqliteAdapter] Query error:', { sql, params, error });
      throw error;
    }
  }

  /**
   * Execute SQL without returning results
   */
  async exec(sql: string): Promise<void> {
    const db = this.getConnection();
    db.exec(sql);
  }

  /**
   * Execute transaction
   */
  async transaction<T>(fn: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    const db = this.getConnection();

    // Create transaction context that uses this adapter
    const txContext: ITransactionContext = {
      query: <U>(sql: string, params?: any[]) => this.query<U>(sql, params),
      exec: (sql: string) => this.exec(sql)
    };

    db.exec('BEGIN TRANSACTION');

    try {
      const result = await fn(txContext);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Initialize SQLite-specific schema
   * Includes WAL mode, tables, indexes, and triggers
   */
  async initializeSchema(): Promise<void> {
    const db = this.getConnection();

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Execute SQLite-specific schema
    await this.exec(DATABASE_SCHEMA);
  }

  /**
   * Optimize SQLite database
   * Executes WAL checkpoint to flush to disk and truncate log
   */
  async optimize(): Promise<void> {
    await this.query('PRAGMA wal_checkpoint(TRUNCATE)');
  }
}
