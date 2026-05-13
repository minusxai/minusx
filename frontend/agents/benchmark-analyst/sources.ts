import type { AgentContext } from '@/orchestrator/types';

export interface SchemaSource {
  /** Return the raw schema array for a connection: [{schema, tables: [{table, columns}]}] */
  getSchema(connection: string, ctx?: AgentContext): Promise<any[]>;
}

/**
 * Result shape returned by SQL execution. Production fills `columns`/`types`/
 * `finalQuery`/`executionMs` so the legacy ExecuteSQLDisplay can render
 * structured tables; benchmark/test stubs may return only `rows`/`error`.
 */
export interface SqlExecutorResult {
  rows: Record<string, unknown>[];
  error?: string;
  columns?: string[];
  types?: string[];
  finalQuery?: string;
  executionMs?: number;
}

export interface SqlExecutor {
  /** `ctx` is the tool's `AgentContext` — production casts to read
   *  `effectiveUser` for routing; benchmark/test stubs ignore it. */
  execute(sql: string, connection: string, ctx?: AgentContext): Promise<SqlExecutorResult>;
}

let _schemaSource: SchemaSource | null = null;
let _sqlExecutor: SqlExecutor | null = null;

export function setSchemaSource(s: SchemaSource): void { _schemaSource = s; }
export function setSqlExecutor(e: SqlExecutor): void { _sqlExecutor = e; }

export function getSchemaSource(): SchemaSource {
  if (!_schemaSource) throw new Error('SchemaSource not set. Call setSchemaSource() at app/test init.');
  return _schemaSource;
}

export function getSqlExecutor(): SqlExecutor {
  if (!_sqlExecutor) throw new Error('SqlExecutor not set. Call setSqlExecutor() at app/test init.');
  return _sqlExecutor;
}

export function resetSources(): void {
  _schemaSource = null;
  _sqlExecutor = null;
}
