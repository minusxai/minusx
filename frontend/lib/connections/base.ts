import 'server-only';

export interface ColumnMeta {
  description?: string;
  category?: 'categorical' | 'numeric' | 'temporal' | 'other';
  nullCount?: number;
  /** Only for categorical columns */
  nDistinct?: number;
  topValues?: Array<{ value: string | number | boolean; count: number; fraction: number }>;
  /** Only for numeric columns */
  min?: number | string;
  max?: number | string;
  avg?: number;
  /** Only for temporal columns */
  minDate?: string;
  maxDate?: string;
}

export interface SchemaColumn {
  name: string;
  type: string;
  meta?: ColumnMeta;
}

export interface SchemaTable {
  table: string;
  columns: SchemaColumn[];
}

export interface SchemaEntry {
  schema: string;
  tables: SchemaTable[];
}

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: Record<string, unknown>[];
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  schema?: { schemas: SchemaEntry[] } | null;
}

/**
 * Abstract base class for Node.js database connectors.
 * Mirrors Python's AsyncDatabaseConnector interface.
 */
export abstract class NodeConnector {
  constructor(
    protected readonly name: string,
    protected readonly config: Record<string, any>
  ) {}

  /**
   * Test if the connection is valid.
   * Returns { success, message, schema? }
   */
  abstract testConnection(includeSchema?: boolean): Promise<TestConnectionResult>;

  /**
   * Execute a SQL query and return results.
   */
  abstract query(sql: string, params?: Record<string, string | number>): Promise<QueryResult>;

  /**
   * Get database schema.
   * Returns array of { schema, tables[] } — same shape as Python.
   */
  abstract getSchema(): Promise<SchemaEntry[]>;
}
