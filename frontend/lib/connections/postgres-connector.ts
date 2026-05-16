import 'server-only';
import type { NodeConnector, QueryResult, SchemaEntry, TableIndex, TestConnectionResult } from './base';
import { NodeConnector as NodeConnectorBase } from './base';
import { inlineSqlParams } from '@/lib/sql/inline-params';
import { getOrCreatePgPool } from './pg-registry';
import { namedToPositional } from './named-to-positional';

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

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      const pool = getOrCreatePgPool(this.config);
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
    const pool = getOrCreatePgPool(this.config);

    // Substitute :paramName → $N (positional); negative lookbehind in
    // `namedToPositional` leaves `::cast` operators intact.
    const { sql: positionalSql, values: paramValues } = namedToPositional(sql, params);

    const finalQuery = inlineSqlParams(sql, params);

    const result = await pool.query(positionalSql, paramValues as any[]);

    const columns = result.fields.map((f: any) => f.name as string);
    const types = result.fields.map((f: any) => PG_OID_TO_TYPE[f.dataTypeID as number] ?? 'text');

    return { columns, types, rows: result.rows, finalQuery };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const pool = getOrCreatePgPool(this.config);
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

    const indexMap = await this.getIndexes(pool);

    return Array.from(schemaMap.entries()).map(([schema, tableMap]) => ({
      schema,
      tables: Array.from(tableMap.entries()).map(([table, columns]) => ({
        table,
        columns,
        indexes: indexMap.get(`${schema}.${table}`) ?? [],
      })),
    }));
  }

  /**
   * Introspect indexes from the pg catalog. The query returns one row per
   * (index, column) with `col_pos` ordering; grouped here into
   * `TableIndex[]` keyed by `schema.table`. Plain-column indexes only —
   * expression-index columns (`indkey` entry of 0) are skipped by the
   * `attnum = ANY(indkey)` join, so a purely-expression index yields an
   * empty `columns` list.
   */
  private async getIndexes(
    pool: ReturnType<typeof getOrCreatePgPool>,
  ): Promise<Map<string, TableIndex[]>> {
    const result = await pool.query(`
      SELECT
        n.nspname  AS table_schema,
        t.relname  AS table_name,
        i.relname  AS index_name,
        ix.indisunique AS is_unique,
        a.attname  AS column_name,
        array_position(ix.indkey, a.attnum) AS col_pos
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n.nspname, t.relname, i.relname, col_pos
    `);

    // Group: schema.table → index_name → columns (sorted by col_pos in
    // code, not relying on the query's ORDER BY) + uniqueness.
    const byTable = new Map<
      string,
      Map<string, { unique: boolean; cols: Array<{ pos: number; name: string }> }>
    >();
    for (const row of result.rows) {
      if (!row.index_name) continue; // defensive — non-index rows
      const tableKey = `${row.table_schema}.${row.table_name}`;
      if (!byTable.has(tableKey)) byTable.set(tableKey, new Map());
      const idxMap = byTable.get(tableKey)!;
      if (!idxMap.has(row.index_name)) {
        idxMap.set(row.index_name, { unique: !!row.is_unique, cols: [] });
      }
      idxMap.get(row.index_name)!.cols.push({ pos: Number(row.col_pos), name: row.column_name });
    }

    const out = new Map<string, TableIndex[]>();
    for (const [tableKey, idxMap] of byTable) {
      out.set(
        tableKey,
        Array.from(idxMap.entries()).map(([name, { unique, cols }]) => ({
          name,
          columns: cols.sort((a, b) => a.pos - b.pos).map((c) => c.name),
          unique,
        })),
      );
    }
    return out;
  }
}
