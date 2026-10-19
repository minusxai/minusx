import 'server-only';
import type { FieldPacket, PoolConnection } from 'mysql2';
import { NodeConnector as NodeConnectorBase, drainQueryStream, groupColumnsIntoSchemaEntries, type QueryResult, type QueryStream, type SchemaEntry } from './base';
import { getOrCreateMySqlPool } from './mysql-registry';
import { rewriteNamedParams } from './named-to-positional';
import { inlineSqlParams } from '@/lib/sql/inline-params';

const MYSQL_TYPES: Readonly<Record<number, string>> = Object.freeze({
  0: 'DECIMAL', 1: 'TINYINT', 2: 'SMALLINT', 3: 'INT', 4: 'FLOAT', 5: 'DOUBLE',
  6: 'NULL', 7: 'TIMESTAMP', 8: 'BIGINT', 9: 'MEDIUMINT', 10: 'DATE', 11: 'TIME',
  12: 'DATETIME', 13: 'YEAR', 14: 'DATE', 15: 'VARCHAR', 16: 'BIT', 245: 'JSON',
  246: 'DECIMAL', 247: 'ENUM', 248: 'SET', 249: 'TINYBLOB', 250: 'MEDIUMBLOB',
  251: 'LONGBLOB', 252: 'BLOB', 253: 'VARCHAR', 254: 'CHAR', 255: 'GEOMETRY',
});

/** Use the shared placeholder grammar only outside MySQL literals/identifiers/comments. */
function bindParams(sql: string, params?: Record<string, string | number>) {
  const values: Array<string | number | null> = [];
  let offset = 0;
  const chunks: string[] = [];
  const rewrite = (part: string) => rewriteNamedParams(part, params, (name, value) => {
    values.push(params && Object.hasOwn(params, name) ? value ?? null : null);
    return '?';
  });
  // Scan each character at most once, including unterminated quotes/comments.
  // A regex that searches for a closing delimiter can repeatedly backtrack on
  // malformed user SQL and block the server's event loop.
  for (let i = 0; i < sql.length;) {
    const start = i;
    const quote = sql[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '\\' && quote !== '`') { i = Math.min(i + 2, sql.length); continue; }
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue; }
          break;
        }
      }
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (quote === '#' || (sql.startsWith('--', i) && (i + 2 === sql.length || /\s/.test(sql[i + 2])))) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
    } else {
      i++;
      continue;
    }
    chunks.push(rewrite(sql.slice(offset, start)), sql.slice(start, i));
    offset = i;
  }
  chunks.push(rewrite(sql.slice(offset)));
  return { sql: chunks.join(''), values };
}

export class MySqlConnector extends NodeConnectorBase {
  protected async ping(): Promise<void> { await this.query('SELECT 1', undefined, 10_000); }

  async query(sql: string, params?: Record<string, string | number>, timeoutMs?: number): Promise<QueryResult> {
    return drainQueryStream(await this.queryStream(sql, params, timeoutMs));
  }

  override async queryStream(sql: string, params?: Record<string, string | number>, timeoutMs?: number): Promise<QueryStream> {
    const bound = bindParams(sql, params);
    const pool = getOrCreateMySqlPool(this.config);
    const connection = await new Promise<PoolConnection>((resolve, reject) => {
      pool.getConnection((error, conn) => error ? reject(error) : resolve(conn));
    });
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (reusable: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (reusable) connection.release(); else connection.destroy();
    };
    try {
      // Binary binding avoids SQL-mode-dependent escaping. Queries without values
      // use COM_QUERY, which also supports SHOW/EXPLAIN on MySQL-compatible engines.
      const command = bound.values.length ? connection.execute(bound) : connection.query({ sql: bound.sql });
      const stream = command.stream({ highWaterMark: 32 });
      // Install before awaiting fields: errors can arrive before consumption starts.
      stream.on('error', () => finish(false));
      stream.once('close', () => finish(false));
      command.once('end', () => finish(true));
      const fields = await new Promise<FieldPacket[]>((resolve, reject) => {
        command.once('fields', (fields: FieldPacket[] | undefined) => {
          // Doris advertises utf8mb3 (33) while sending full UTF-8. mysql2 maps
          // that to CESU-8, corrupting supplementary characters such as emoji.
          // UTF-8 also decodes valid MySQL utf8mb3; leave binary/other charsets alone.
          // The driver emits fields before constructing either row parser.
          for (const field of fields ?? []) {
            if (field.encoding === 'cesu8') field.encoding = 'utf8';
          }
          resolve(fields ?? []);
        });
        command.once('end', () => resolve([]));
        command.once('error', error => { finish(false); reject(error); });
        stream.once('error', reject);
        if (timeoutMs && timeoutMs > 0) {
          timer = setTimeout(() => {
            const error = new Error(`MySQL query timed out after ${timeoutMs}ms`);
            finish(false);
            stream.destroy(error);
          }, timeoutMs);
        }
      });
      async function* rows(): AsyncGenerator<Record<string, unknown>> {
        try {
          for await (const row of stream) {
            // DDL/DML emits an OK packet through the same stream, not a data row.
            if (fields.length) yield row;
          }
        } finally {
          stream.destroy();
          finish(false);
        }
      }
      return {
        columns: fields.map(field => field.name),
        types: fields.map(field => MYSQL_TYPES[field.columnType ?? -1] ?? 'UNKNOWN'),
        finalQuery: inlineSqlParams(sql, params),
        rows: rows(),
      };
    } catch (error) {
      finish(false);
      throw error;
    }
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const result = await this.query(`
      SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name,
             COLUMN_NAME AS column_name, DATA_TYPE AS data_type
      FROM information_schema.columns
      WHERE ${this.config.database ? 'table_schema = :database' : "table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"}
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
    `, this.config.database ? { database: this.config.database } : undefined, 30_000);
    // Avoid engine-specific index/statistics catalogs: Doris shares this column API.
    return groupColumnsIntoSchemaEntries(result.rows, {
      schema: row => String(row.table_schema),
      table: row => String(row.table_name),
      columns: row => [{ name: String(row.column_name), type: String(row.data_type) }],
    });
  }
}
