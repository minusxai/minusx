import 'server-only';
import { BigQuery } from '@google-cloud/bigquery';
import type { QueryResult, QueryStream, SchemaEntry, TestConnectionResult } from './base';
import { NodeConnector as NodeConnectorBase } from './base';
import { inlineSqlParams } from '@/lib/sql/inline-params';

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

/** Extract columns/types from a getQueryResults API response schema. */
function bigQuerySchema(response: any): { columns: string[]; types: string[] } {
  const fields: Array<{ name?: string; type?: string }> = response?.schema?.fields ?? [];
  return { columns: fields.map(f => f.name ?? ''), types: fields.map(f => f.type ?? 'STRING') };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build BigQuery's `{ params, types }` for createQueryJob.
 *
 * BigQuery (unlike DuckDB/Postgres) won't coerce a STRING parameter to DATE in
 * every context, so parameterized date filters can fail to compile. The fix is
 * to bind a declared `date` param as a REAL DATE value via BigQuery.date(), NOT
 * a string with `type:'DATE'` — the latter binds the value to NULL in the
 * @google-cloud/bigquery client (verified against a live connection). A
 * BigQueryDate value is inferred as DATE with no explicit `types` entry needed.
 * `null` params still need an explicit type (BigQuery requires it) → STRING;
 * text/number keep BigQuery's own (correct) inference. A malformed/non-YMD date
 * value falls back to a plain string (no new error).
 */
function bigQueryParams(
  raw: Record<string, string | number | null>,
  declared?: Record<string, string>,
): { params: Record<string, unknown>; types: Record<string, string> } {
  const params: Record<string, unknown> = {};
  const types: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null) { params[k] = null; types[k] = 'STRING'; continue; }
    if (declared?.[k] === 'date' && typeof v === 'string' && YMD.test(v)) {
      params[k] = BigQuery.date(v); // real DATE value (BigQueryDate), not a string
    } else {
      params[k] = v;
    }
  }
  return { params, types };
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
    const queryConfig: Record<string, any> = { query: sql };
    if (params && Object.keys(params).length > 0) {
      queryConfig.params = params;
      if (paramTypes && Object.keys(paramTypes).length > 0) {
        queryConfig.types = paramTypes;
      }
    }

    const job = await this.createAndAwaitJob(queryConfig);

    const [rows, , response] = await job.getQueryResults();
    const { columns, types } = bigQuerySchema(response);

    return { rows: rows as Record<string, any>[], columns, types };
  }

  /** Create a query job and poll it to DONE (throws on query error). Shared by query()/queryStream(). */
  private async createAndAwaitJob(queryConfig: Record<string, any>) {
    const client = this.getClient();
    const [job] = await client.createQueryJob(queryConfig);
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
    return job;
  }

  /**
   * Streaming variant — pages through the job's results (autoPaginate off) so the
   * server yields rows as BigQuery returns them rather than buffering the whole
   * set. Schema comes from the first page's API response.
   */
  override async queryStream(
    sql: string,
    params?: Record<string, string | number>,
    _timeoutMs?: number,
    paramTypes?: Record<string, string>,
  ): Promise<QueryStream> {
    const queryParams: Record<string, string | number | null> = {};
    const bqSql = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
      queryParams[key] = params?.[key] ?? null;
      return `@${key}`;
    });
    const finalQuery = inlineSqlParams(sql, params);

    const hasParams = Object.keys(queryParams).length > 0;
    const { params: bqParams, types: bqTypes } = bigQueryParams(queryParams, paramTypes);

    const queryConfig: Record<string, any> = { query: bqSql };
    if (hasParams) {
      queryConfig.params = bqParams;
      if (Object.keys(bqTypes).length) queryConfig.types = bqTypes;
    }

    const job = await this.createAndAwaitJob(queryConfig);

    // First page → schema + initial rows; follow nextQuery for subsequent pages.
    const [firstRows, firstNext, response] = await job.getQueryResults({ autoPaginate: false, maxResults: 1000 } as any);
    const { columns, types } = bigQuerySchema(response);

    async function* rows(): AsyncGenerator<Record<string, unknown>> {
      let page = firstRows as Record<string, any>[];
      let next = firstNext as any;
      for (;;) {
        for (const r of page) yield normalizeBigQueryRow(r);
        if (!next) break;
        const [nextRows, nextNext] = await job.getQueryResults(next);
        page = nextRows as Record<string, any>[];
        next = nextNext as any;
      }
    }

    return { columns, types, finalQuery, rows: rows() };
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
    // Substitute :paramName → @paramName (BigQuery named params). Negative
    // lookbehind skips the second `:` of `::cast` operators (BigQuery uses
    // CAST() rather than `::`, but legacy SQL queries can still contain it).
    const queryParams: Record<string, string | number | null> = {};
    const bqSql = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
      queryParams[key] = params?.[key] ?? null;
      return `@${key}`;
    });

    const finalQuery = inlineSqlParams(sql, params);

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
    return { columns, types, rows: rows.map(normalizeBigQueryRow), finalQuery };
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
