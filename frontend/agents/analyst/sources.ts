export interface SchemaHit {
  table: string;
  columns: { name: string; type: string }[];
  description?: string;
}

export interface SchemaSource {
  search(query: string): Promise<SchemaHit[]>;
}

export interface SqlExecutor {
  execute(sql: string): Promise<{ rows: Record<string, unknown>[]; error?: string }>;
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
