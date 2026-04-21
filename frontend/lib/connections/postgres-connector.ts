import 'server-only';
import { Pool } from 'pg';
import type { NodeConnector, QueryResult, SchemaEntry, TestConnectionResult } from './base';
import { NodeConnector as NodeConnectorBase } from './base';

const PG_OID_TO_TYPE: Record<number, string> = {
  16:   'boolean',
  17:   'bytea',
  20:   'bigint',
  21:   'smallint',
  23:   'integer',
  25:   'text',
  114:  'json',
  700:  'real',
  701:  'double precision',
  1042: 'character',
  1043: 'character varying',
  1082: 'date',
  1114: 'timestamp without time zone',
  1184: 'timestamp with time zone',
  1186: 'interval',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
};

export class PostgresConnector extends NodeConnectorBase {
  private pool: Pool | null = null;

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        host: this.config.host ?? 'localhost',
        port: Number(this.config.port ?? 5432),
        database: this.config.database,
        user: this.config.username,
        password: this.config.password ?? undefined,
        ssl: this.config.ssl ?? { rejectUnauthorized: false },
      });
    }
    return this.pool;
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      const pool = this.getPool();
      await pool.query('SELECT 1', []);
      if (includeSchema) {
        const schemas = await this.getSchema();
        return { success: true, message: 'Connection successful', schema: { schemas } };
      }
      return { success: true, message: 'Connection successful' };
    } catch (err: any) {
      return { success: false, message: err?.message ?? String(err) };
    }
  }

  async query(sql: string, params?: Record<string, string | number>): Promise<QueryResult> {
    const pool = this.getPool();

    // Substitute :paramName → $N (positional), reusing index for repeated names
    const paramValues: unknown[] = [];
    const seenParams: Record<string, number> = {};
    const positionalSql = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
      if (!(key in seenParams)) {
        paramValues.push(params?.[key] ?? null);
        seenParams[key] = paramValues.length;
      }
      return `$${seenParams[key]}`;
    });

    const result = await pool.query(positionalSql, paramValues as any[]);

    const columns = result.fields.map((f: any) => f.name as string);
    const types = result.fields.map((f: any) => PG_OID_TO_TYPE[f.dataTypeID as number] ?? 'text');

    return { columns, types, rows: result.rows };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const pool = this.getPool();
    const result = await pool.query(`
      SELECT table_schema, table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name, ordinal_position
    `);

    const schemaMap = new Map<string, Map<string, Array<{ name: string; type: string }>>>();
    for (const row of result.rows) {
      const { table_schema, table_name, column_name, data_type } = row;
      if (!schemaMap.has(table_schema)) schemaMap.set(table_schema, new Map());
      const tableMap = schemaMap.get(table_schema)!;
      if (!tableMap.has(table_name)) tableMap.set(table_name, []);
      tableMap.get(table_name)!.push({ name: column_name, type: data_type });
    }

    return Array.from(schemaMap.entries()).map(([schema, tableMap]) => ({
      schema,
      tables: Array.from(tableMap.entries()).map(([table, columns]) => ({ table, columns })),
    }));
  }
}
