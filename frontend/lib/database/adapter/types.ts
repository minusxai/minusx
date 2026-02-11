/**
 * Database query result with typed rows
 */
export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

/**
 * Transaction context - uses same interface as adapter
 */
export interface ITransactionContext {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

/**
 * Main database adapter interface
 * All implementations must be async (even if underlying DB is sync)
 */
export interface IDatabaseAdapter {
  /**
   * Execute a parameterized query
   * @param sql SQL query with $1, $2, ... placeholders
   * @param params Array of parameter values
   * @returns Query results with typed rows
   */
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;

  /**
   * Execute SQL without returning results (DDL, multi-statement)
   * @param sql SQL to execute
   */
  exec(sql: string): Promise<void>;

  /**
   * Execute operations in a transaction
   * Automatically commits on success, rolls back on error
   * @param fn Transaction callback function
   */
  transaction<T>(fn: (tx: ITransactionContext) => Promise<T>): Promise<T>;

  /**
   * Close database connection
   */
  close(): Promise<void>;

  /**
   * Initialize database schema (database-specific)
   * Each adapter implements its own schema with proper syntax
   */
  initializeSchema(): Promise<void>;

  /**
   * Perform database-specific optimization/maintenance
   * SQLite: WAL checkpoint (TRUNCATE)
   * PostgreSQL: No-op (auto-vacuum handles maintenance)
   */
  optimize(): Promise<void>;
}

/**
 * Database adapter configuration
 */
export interface DatabaseConfig {
  type: 'sqlite' | 'postgres';

  // SQLite-specific
  sqlitePath?: string;

  // PostgreSQL-specific (for PGlite or node-postgres)
  postgresConnectionString?: string;
  pgDataDir?: string; // For PGlite file-based mode
}
