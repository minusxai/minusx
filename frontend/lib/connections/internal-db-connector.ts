import 'server-only';
import { init, parse, Dialect } from '@polyglot-sql/sdk';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { getModules } from '@/lib/modules/registry';
import { NodeConnector, QueryResult, SchemaEntry, TestConnectionResult } from './base';

const WRITE_OPERATIONS = immutableSet(['insert', 'update', 'delete', 'create', 'drop', 'alter', 'truncate', 'merge', 'replace']);

async function assertReadOnly(sql: string): Promise<void> {
  await init();
  let result: ReturnType<typeof parse>;
  try {
    result = parse(sql, 'postgres' as Dialect);
  } catch {
    throw new Error('internal_db: query could not be parsed — rejected for safety');
  }
  if (!result.ast?.length)
    throw new Error('internal_db: query could not be parsed — rejected for safety');
  for (const stmt of result.ast) {
    const rootKey = Object.keys(stmt)[0];
    if (WRITE_OPERATIONS.has(rootKey))
      throw new Error(`internal_db is read-only: ${rootKey} statements are not permitted`);
  }
}

function namedToPositional(
  sql: string,
  params?: Record<string, string | number>
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const seen: Record<string, number> = {};
  const positional = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
    if (!(key in seen)) {
      values.push(params?.[key] ?? null);
      seen[key] = values.length;
    }
    return `$${seen[key]}`;
  });
  return { sql: positional, values };
}

export class InternalDbConnector extends NodeConnector {

  async query(sql: string, params?: Record<string, string | number>): Promise<QueryResult> {
    await assertReadOnly(sql);
    const { sql: positionalSql, values } = namedToPositional(sql, params);
    const result = await getModules().db.exec<Record<string, unknown>>(positionalSql, values);
    const columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : [];
    return { columns, types: columns.map(() => 'text'), rows: result.rows };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const result = await getModules().db.exec<{
      table_schema: string; table_name: string; column_name: string; data_type: string;
    }>(`
      SELECT table_schema, table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name, ordinal_position
    `);
    const schemaMap = new Map<string, Map<string, Array<{ name: string; type: string }>>>();
    for (const { table_schema, table_name, column_name, data_type } of result.rows) {
      if (!schemaMap.has(table_schema)) schemaMap.set(table_schema, new Map());
      const tMap = schemaMap.get(table_schema)!;
      if (!tMap.has(table_name)) tMap.set(table_name, []);
      tMap.get(table_name)!.push({ name: column_name, type: data_type });
    }
    return Array.from(schemaMap.entries()).map(([schema, tMap]) => ({
      schema,
      tables: Array.from(tMap.entries()).map(([table, columns]) => ({ table, columns })),
    }));
  }

  async testConnection(includeSchema?: boolean): Promise<TestConnectionResult> {
    try {
      await getModules().db.exec('SELECT 1');
      const schema = includeSchema ? { schemas: await this.getSchema() } : null;
      return { success: true, message: 'Connected to document DB', schema };
    } catch (err) {
      return { success: false, message: String(err) };
    }
  }
}
