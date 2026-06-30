/**
 * AthenaConnector.queryStream: follows GetQueryResults pagination (NextToken),
 * skipping the header row on the first page only. AWS SDK mocked.
 */
const cell = (v: string) => ({ VarCharValue: v });

vi.mock('@aws-sdk/client-athena', () => ({
  AthenaClient: class { async send(cmd: any) { return cmd._result; } },
  StartQueryExecutionCommand: class { _result = { QueryExecutionId: 'q1' }; constructor(public input: any) {} },
  GetQueryExecutionCommand: class { _result = { QueryExecution: { Status: { State: 'SUCCEEDED' } } }; constructor(public input: any) {} },
  GetQueryResultsCommand: class {
    _result: any;
    constructor(public input: any) {
      if (!input.NextToken) {
        this._result = {
          ResultSet: {
            ResultSetMetadata: { ColumnInfo: [{ Name: 'id', Type: 'integer' }, { Name: 'name', Type: 'varchar' }] },
            Rows: [
              { Data: [cell('id'), cell('name')] }, // header row (skipped)
              { Data: [cell('1'), cell('a')] },
              { Data: [cell('2'), cell('b')] },
            ],
          },
          NextToken: 'p2',
        };
      } else {
        this._result = { ResultSet: { Rows: [{ Data: [cell('3'), cell('c')] }] }, NextToken: undefined };
      }
    }
  },
}));
vi.mock('@aws-sdk/client-glue', () => ({ GlueClient: class {}, GetDatabasesCommand: class {}, GetTablesCommand: class {} }));

import { describe, it, expect } from 'vitest';
import { AthenaConnector } from '../athena-connector';
import { drainQueryStream } from '../base';

describe('AthenaConnector.queryStream', () => {
  it('streams paged results, header only on the first page', async () => {
    const conn = new AthenaConnector('a', { s3_staging_dir: 's3://x/', region_name: 'us-east-1' });
    const stream = await conn.queryStream('SELECT id, name FROM t');
    expect(stream.columns).toEqual(['id', 'name']);
    expect(stream.types).toEqual(['integer', 'varchar']);
    const result = await drainQueryStream(stream);
    expect(result.rows).toEqual([
      { id: '1', name: 'a' }, { id: '2', name: 'b' }, { id: '3', name: 'c' },
    ]);
  });
});
