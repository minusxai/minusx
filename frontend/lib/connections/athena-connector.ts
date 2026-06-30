import 'server-only';
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} from '@aws-sdk/client-athena';
import { GlueClient, GetDatabasesCommand, GetTablesCommand } from '@aws-sdk/client-glue';
import type { QueryResult, QueryStream, SchemaEntry, TestConnectionResult } from './base';
import { NodeConnector as NodeConnectorBase } from './base';
import { inlineSqlParams } from '@/lib/sql/inline-params';

const POLL_INTERVAL_MS = 500;

export class AthenaConnector extends NodeConnectorBase {
  private athenaClient: AthenaClient | null = null;
  private glueClient: GlueClient | null = null;

  private buildClientOptions(): Record<string, any> {
    const region = (this.config.region_name as string) ?? 'us-east-1';
    const keyId = this.config.aws_access_key_id as string | undefined;
    const secret = this.config.aws_secret_access_key as string | undefined;
    const opts: Record<string, any> = { region };
    if (keyId && secret) {
      opts.credentials = { accessKeyId: keyId, secretAccessKey: secret };
    }
    return opts;
  }

  private getAthenaClient(): AthenaClient {
    if (!this.athenaClient) {
      this.athenaClient = new AthenaClient(this.buildClientOptions());
    }
    return this.athenaClient;
  }

  private getGlueClient(): GlueClient {
    if (!this.glueClient) {
      this.glueClient = new GlueClient(this.buildClientOptions());
    }
    return this.glueClient;
  }

  private async waitForQuery(client: AthenaClient, queryExecutionId: string): Promise<string> {
    while (true) {
      const { QueryExecution } = await client.send(
        new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId })
      );
      const state = QueryExecution?.Status?.State;
      if (state === 'SUCCEEDED') return queryExecutionId;
      if (state === 'FAILED' || state === 'CANCELLED') {
        const reason = QueryExecution?.Status?.StateChangeReason ?? `Query ${state}`;
        throw new Error(reason);
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      const client = this.getAthenaClient();
      const { QueryExecutionId } = await client.send(
        new StartQueryExecutionCommand({
          QueryString: 'SELECT 1',
          WorkGroup: (this.config.work_group as string) ?? 'primary',
          ResultConfiguration: {
            OutputLocation: this.config.s3_staging_dir as string,
          },
        })
      );
      await this.waitForQuery(client, QueryExecutionId!);
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
    const client = this.getAthenaClient();

    // Substitute :paramName → ? (Athena positional), collect values in
    // order. Negative lookbehind skips the second `:` of `::cast`
    // operators (Athena/Trino support PostgreSQL casts).
    const paramValues: string[] = [];
    const athenaSql = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
      const val = params?.[key];
      paramValues.push(val != null ? String(val) : 'NULL');
      return '?';
    });

    const finalQuery = inlineSqlParams(sql, params);

    const { QueryExecutionId } = await client.send(
      new StartQueryExecutionCommand({
        QueryString: athenaSql,
        ExecutionParameters: paramValues.length ? paramValues : undefined,
        WorkGroup: (this.config.work_group as string) ?? 'primary',
        ResultConfiguration: {
          OutputLocation: this.config.s3_staging_dir as string,
        },
      })
    );

    await this.waitForQuery(client, QueryExecutionId!);

    const { ResultSet } = await client.send(
      new GetQueryResultsCommand({ QueryExecutionId: QueryExecutionId! })
    );

    const columnInfo = ResultSet?.ResultSetMetadata?.ColumnInfo ?? [];
    const columns = columnInfo.map((c: any) => c.Name as string);
    const types = columnInfo.map((c: any) => c.Type as string);

    // First row is the header row — skip it
    const dataRows = (ResultSet?.Rows ?? []).slice(1);
    const rows = dataRows.map((row: any) => {
      const obj: Record<string, string | null> = {};
      (row.Data ?? []).forEach((cell: any, i: number) => {
        obj[columns[i]] = cell.VarCharValue ?? null;
      });
      return obj;
    });

    return { columns, types, rows, finalQuery };
  }

  /**
   * Streaming variant — Athena's GetQueryResults is natively paged, so we yield
   * each page's rows as it arrives (following NextToken) instead of buffering the
   * whole result. The header row is present only on the first page.
   */
  override async queryStream(sql: string, params?: Record<string, string | number>): Promise<QueryStream> {
    const client = this.getAthenaClient();
    const paramValues: string[] = [];
    const athenaSql = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
      const val = params?.[key];
      paramValues.push(val != null ? String(val) : 'NULL');
      return '?';
    });
    const finalQuery = inlineSqlParams(sql, params);

    const { QueryExecutionId } = await client.send(
      new StartQueryExecutionCommand({
        QueryString: athenaSql,
        ExecutionParameters: paramValues.length ? paramValues : undefined,
        WorkGroup: (this.config.work_group as string) ?? 'primary',
        ResultConfiguration: { OutputLocation: this.config.s3_staging_dir as string },
      }),
    );
    await this.waitForQuery(client, QueryExecutionId!);

    // First page → column metadata (and the header row to skip).
    const firstPage = await client.send(new GetQueryResultsCommand({ QueryExecutionId: QueryExecutionId! }));
    const columnInfo = firstPage.ResultSet?.ResultSetMetadata?.ColumnInfo ?? [];
    const columns = columnInfo.map((c: any) => c.Name as string);
    const types = columnInfo.map((c: any) => c.Type as string);

    const toRow = (row: any): Record<string, string | null> => {
      const obj: Record<string, string | null> = {};
      (row.Data ?? []).forEach((cell: any, i: number) => { obj[columns[i]] = cell.VarCharValue ?? null; });
      return obj;
    };

    async function* rows(): AsyncGenerator<Record<string, unknown>> {
      // First page: row 0 is the header → skip it.
      for (const row of (firstPage.ResultSet?.Rows ?? []).slice(1)) yield toRow(row);
      let next = firstPage.NextToken;
      while (next) {
        const page = await client.send(new GetQueryResultsCommand({ QueryExecutionId: QueryExecutionId!, NextToken: next }));
        for (const row of page.ResultSet?.Rows ?? []) yield toRow(row); // no header on later pages
        next = page.NextToken;
      }
    }

    return { columns, types, finalQuery, rows: rows() };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const glue = this.getGlueClient();
    const schemas: SchemaEntry[] = [];

    let nextToken: string | undefined;
    const allDatabases: string[] = [];

    do {
      const resp = await glue.send(new GetDatabasesCommand({ NextToken: nextToken }));
      for (const db of resp.DatabaseList ?? []) {
        if (db.Name && db.Name !== 'information_schema') {
          allDatabases.push(db.Name);
        }
      }
      nextToken = resp.NextToken;
    } while (nextToken);

    for (const dbName of allDatabases) {
      const tables: Array<{ table: string; columns: Array<{ name: string; type: string }> }> = [];

      let tableToken: string | undefined;
      do {
        const resp = await glue.send(new GetTablesCommand({ DatabaseName: dbName, NextToken: tableToken }));
        for (const tbl of resp.TableList ?? []) {
          const cols: Array<{ name: string; type: string }> = [];
          for (const col of tbl.StorageDescriptor?.Columns ?? []) {
            cols.push({ name: col.Name!, type: col.Type! });
          }
          for (const pk of tbl.PartitionKeys ?? []) {
            cols.push({ name: pk.Name!, type: pk.Type! });
          }
          tables.push({ table: tbl.Name!, columns: cols });
        }
        tableToken = resp.NextToken;
      } while (tableToken);

      schemas.push({ schema: dbName, tables });
    }

    return schemas;
  }
}
