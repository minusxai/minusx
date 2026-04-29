import 'server-only';
import { BigQuery } from '@google-cloud/bigquery';
import type { QueryResult, SchemaEntry, TestConnectionResult } from './base';
import { NodeConnector as NodeConnectorBase } from './base';

const POLL_INTERVAL_MS = 500;

// BigQuery typed values (TIMESTAMP, DATE, DATETIME, TIME) are returned as { value: string }
// objects by the client library. Flatten them to plain strings so they render correctly.
function normalizeBigQueryValue(val: unknown): unknown {
  if (val == null) return val;
  if (Array.isArray(val)) return val.map(normalizeBigQueryValue);
  if (typeof val === 'object') {
    const keys = Object.keys(val as object);
    if (keys.length === 1 && keys[0] === 'value' && typeof (val as any).value === 'string') {
      return (val as any).value;
    }
  }
  return val;
}

function normalizeBigQueryRow(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) result[k] = normalizeBigQueryValue(v);
  return result;
}

export class BigQueryConnector extends NodeConnectorBase {
  private client: BigQuery | null = null;

  private parseCredentials(): Record<string, any> {
    const parsed = JSON.parse(this.config.service_account_json as string);
    return parsed.credentials ?? parsed;
  }

  private getClient(): BigQuery {
    if (!this.client) {
      const credentials = this.parseCredentials();
      this.client = new BigQuery({
        projectId: this.config.project_id as string,
        credentials,
      });
    }
    return this.client;
  }

  private async runQueryJob(
    sql: string,
    params?: Record<string, string | number | null>,
    paramTypes?: Record<string, string>
  ): Promise<{ rows: Record<string, any>[]; columns: string[]; types: string[] }> {
    const client = this.getClient();

    const queryConfig: Record<string, any> = { query: sql };
    if (params && Object.keys(params).length > 0) {
      queryConfig.params = params;
      if (paramTypes && Object.keys(paramTypes).length > 0) {
        queryConfig.types = paramTypes;
      }
    }

    const [job] = await client.createQueryJob(queryConfig);

    // Poll for completion
    while (true) {
      const [metadata] = await job.getMetadata();
      const state = metadata?.status?.state;
      if (state === 'DONE') {
        const err = metadata?.status?.errorResult;
        if (err) throw new Error(err.message ?? 'Query failed');
        break;
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    const [rows, , response] = await job.getQueryResults();
    const schema = (response as any)?.schema ?? (response as any)?.schema;
    const fields: Array<{ name?: string; type?: string }> = (schema as any)?.fields ?? [];
    const columns = fields.map(f => f.name ?? '');
    const types = fields.map(f => f.type ?? 'STRING');

    return { rows: rows as Record<string, any>[], columns, types };
  }

  async testConnection(includeSchema = false): Promise<TestConnectionResult> {
    try {
      await this.runQueryJob('SELECT 1');
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
    // Substitute :paramName → @paramName (BigQuery named params), collect param values
    const queryParams: Record<string, string | number | null> = {};
    const bqSql = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
      queryParams[key] = params?.[key] ?? null;
      return `@${key}`;
    });

    const hasParams = Object.keys(queryParams).length > 0;
    // BigQuery requires explicit types for null parameters; default them to STRING.
    const nullTypes: Record<string, string> = {};
    for (const [k, v] of Object.entries(queryParams)) {
      if (v === null) nullTypes[k] = 'STRING';
    }
    const { rows, columns, types } = await this.runQueryJob(
      bqSql,
      hasParams ? queryParams : undefined,
      hasParams && Object.keys(nullTypes).length ? nullTypes : undefined,
    );
    return { columns, types, rows: rows.map(normalizeBigQueryRow) };
  }

  async getSchema(): Promise<SchemaEntry[]> {
    const client = this.getClient();
    const projectId = this.config.project_id as string;

    const [datasets] = await client.getDatasets();
    const schemas: SchemaEntry[] = [];

    for (const dataset of datasets) {
      const datasetId = dataset.id as string;
      try {
        const { rows } = await this.runQueryJob(`
          SELECT table_name, column_name, data_type
          FROM \`${projectId}.${datasetId}.INFORMATION_SCHEMA.COLUMNS\`
          ORDER BY table_name, ordinal_position
        `);

        const tableMap = new Map<string, Array<{ name: string; type: string }>>();
        for (const row of rows as any[]) {
          const { table_name, column_name, data_type } = row;
          if (!tableMap.has(table_name)) tableMap.set(table_name, []);
          tableMap.get(table_name)!.push({ name: column_name, type: data_type });
        }

        schemas.push({
          schema: datasetId,
          tables: Array.from(tableMap.entries()).map(([table, columns]) => ({ table, columns })),
        });
      } catch {
        // Skip datasets we can't access
      }
    }

    return schemas;
  }
}
