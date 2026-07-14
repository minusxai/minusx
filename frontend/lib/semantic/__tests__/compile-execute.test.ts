/**
 * Compile-and-EXECUTE suite — the round-trip matrix (compile → SQL → parse →
 * detect) can never catch BINDER errors (ambiguous columns, bad qualifiers),
 * because nothing binds the SQL against a real schema. This suite runs every
 * compiled query against a REAL in-memory DuckDB whose tables deliberately
 * share column names across joins (campaign_id / id / created_at on both
 * sides) — the exact ambiguity class hit in production ("Ambiguous reference
 * to column name campaign_id").
 *
 * Vocabulary is DERIVED (deriveSemanticModels over the schema + declared
 * relationships), not hand-written — so this validates what the app actually
 * uses, end to end: derive → compile → execute → parse → detect.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { deriveSemanticModels } from '../derive';
import { compileSemanticQuery } from '../compile';
import { semanticSpecFromIr } from '../detect';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import type { DatabaseWithSchema, SemanticModel, TableRelationship } from '@/lib/types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';
import type { AnyQueryIR } from '@/lib/sql/ir-types';

// ---------------------------------------------------------------------------
// Real schema with DELIBERATELY overlapping column names across the join
// ---------------------------------------------------------------------------

const DDL = `
CREATE SCHEMA mxfood;
CREATE TABLE mxfood.ad_campaigns (
  id BIGINT,            -- overlaps with ad_spend.id
  campaign_id BIGINT,   -- overlaps with ad_spend.campaign_id (the prod bug)
  campaign_name VARCHAR,
  channel VARCHAR,
  daily_budget DOUBLE,
  created_at TIMESTAMP, -- overlaps with ad_spend.created_at
  end_date DATE
);
CREATE TABLE mxfood.ad_spend (
  id BIGINT,
  campaign_id BIGINT,
  spend DOUBLE,
  impressions BIGINT,
  status VARCHAR,
  created_at TIMESTAMP
);
INSERT INTO mxfood.ad_campaigns VALUES
  (1, 101, 'Summer Sale', 'social', 50.0, TIMESTAMP '2024-01-01 00:00:00', DATE '2024-06-30'),
  (2, 102, 'Winter Push', 'search', 80.0, TIMESTAMP '2024-02-01 00:00:00', DATE '2024-12-31'),
  (3, 103, 'Brand',       'social', 20.0, TIMESTAMP '2024-03-01 00:00:00', NULL);
INSERT INTO mxfood.ad_spend VALUES
  (10, 101, 12.5, 1000, 'active',  TIMESTAMP '2024-01-05 10:00:00'),
  (11, 101, 20.0, 2000, 'active',  TIMESTAMP '2024-02-05 10:00:00'),
  (12, 102, 7.5,  500,  'paused',  TIMESTAMP '2024-02-10 10:00:00'),
  (13, 102, 30.0, 4000, 'active',  TIMESTAMP '2024-03-10 10:00:00'),
  (14, 999, 5.0,  100,  'orphan',  TIMESTAMP '2024-03-11 10:00:00');
`;

// The same schema, as the derived-model input (types match the DDL).
const SCHEMA: DatabaseWithSchema = {
  databaseName: 'warehouse',
  schemas: [{
    schema: 'mxfood',
    tables: [
      {
        table: 'ad_campaigns',
        columns: [
          { name: 'id', type: 'BIGINT' },
          { name: 'campaign_id', type: 'BIGINT' },
          { name: 'campaign_name', type: 'VARCHAR' },
          { name: 'channel', type: 'VARCHAR' },
          { name: 'daily_budget', type: 'DOUBLE' },
          { name: 'created_at', type: 'TIMESTAMP' },
          { name: 'end_date', type: 'DATE' },
        ],
      },
      {
        table: 'ad_spend',
        columns: [
          { name: 'id', type: 'BIGINT' },
          { name: 'campaign_id', type: 'BIGINT' },
          { name: 'spend', type: 'DOUBLE' },
          { name: 'impressions', type: 'BIGINT' },
          { name: 'status', type: 'VARCHAR' },
          { name: 'created_at', type: 'TIMESTAMP' },
        ],
      },
    ],
  }],
};

const RELATIONSHIPS: TableRelationship[] = [{
  connection: 'warehouse', schema: 'mxfood', table: 'ad_spend',
  column: 'campaign_id', targetSchema: 'mxfood', targetTable: 'ad_campaigns', targetColumn: 'campaign_id',
  relationship: 'many_to_one',
}];

// ---------------------------------------------------------------------------
// The diverse spec matrix — every vocabulary shape, with and without the join
// ---------------------------------------------------------------------------

const spendSpec = (partial: Partial<SemanticQuerySpec>): SemanticQuerySpec => ({
  model: 'Ad Spend', table: 'ad_spend', schema: 'mxfood',
  measures: [], dimensions: [], ...partial,
});

const SPECS: Array<[string, SemanticQuerySpec]> = [
  // -- the production bug: COUNT_DISTINCT on a column that exists on BOTH sides,
  //    combined with a joined dimension
  ['ambiguous COUNT_DISTINCT + joined dim (the prod bug)', spendSpec({
    measures: ['Count', 'Unique Campaign'],
    dimensions: ['Ad Campaigns Campaign Name'],
  })],
  // -- base-only shapes
  ['count only', spendSpec({ measures: ['Count'] })],
  ['SUM + AVG + base dim', spendSpec({ measures: ['Total Spend', 'Avg Spend'], dimensions: ['Status'] })],
  ['COUNT_DISTINCT without join (no ambiguity)', spendSpec({ measures: ['Unique Campaign'] })],
  ['time grain only', spendSpec({ measures: ['Count'], timeGrain: 'MONTH' })],
  ['limit', spendSpec({ measures: ['Count'], dimensions: ['Status'], limit: 2 })],
  // -- joined shapes
  ['joined dim only', spendSpec({ measures: ['Total Spend'], dimensions: ['Ad Campaigns Channel'] })],
  ['base + joined dims together', spendSpec({
    measures: ['Count'], dimensions: ['Status', 'Ad Campaigns Channel'],
  })],
  ['two joined dims', spendSpec({
    measures: ['Total Impressions'],
    dimensions: ['Ad Campaigns Campaign Name', 'Ad Campaigns Channel'],
  })],
  ['time grain + joined dim (created_at overlaps too)', spendSpec({
    measures: ['Total Spend'], dimensions: ['Ad Campaigns Channel'], timeGrain: 'MONTH',
  })],
  ['SUM of joined-side-overlapping name via join (Daily Budget lives on campaigns)', spendSpec({
    measures: ['Count'], dimensions: ['Ad Campaigns Campaign Name'],
    filters: [{ dimension: 'Ad Campaigns Campaign Name', operator: '!=', value: 'Brand' }],
  })],
  // -- filters across the join boundary
  ['filter on base dim + joined dim in SELECT', spendSpec({
    measures: ['Count'], dimensions: ['Ad Campaigns Channel'],
    filters: [{ dimension: 'Status', operator: '=', value: 'active' }],
  })],
  ['filter on joined dim + base dim in SELECT', spendSpec({
    measures: ['Count'], dimensions: ['Status'],
    filters: [{ dimension: 'Ad Campaigns Channel', operator: '=', value: 'social' }],
  })],
  ['IN filter on ambiguous fk column (dimension Campaign Id) with join', spendSpec({
    measures: ['Count'], dimensions: ['Ad Campaigns Campaign Name'],
    filters: [{ dimension: 'Campaign Id', operator: 'IN', value: ['101', '102'] }],
  })],
  ['IS NOT NULL filter on joined dim', spendSpec({
    measures: ['Count'], dimensions: ['Ad Campaigns Campaign Name'],
    filters: [{ dimension: 'Ad Campaigns Campaign Name', operator: 'IS NOT NULL' }],
  })],
  // -- alternate time axis (spec.timeColumn: any base temporal column)
  ['timeColumn: created_at is the default; explicit works', spendSpec({
    measures: ['Count'], timeGrain: 'WEEK', timeColumn: 'created_at',
  })],
  // -- everything at once
  ['kitchen sink: time + base dim + joined dim + filters + limit', spendSpec({
    measures: ['Count', 'Total Spend', 'Unique Campaign'],
    dimensions: ['Status', 'Ad Campaigns Channel'],
    timeGrain: 'MONTH',
    filters: [
      { dimension: 'Status', operator: '!=', value: 'orphan' },
      { dimension: 'Ad Campaigns Channel', operator: 'IS NOT NULL' },
    ],
    limit: 100,
  })],
];

// ---------------------------------------------------------------------------

describe('derived models compile to SQL that actually EXECUTES (real DuckDB)', () => {
  let db: DuckDBConnection;
  let models: SemanticModel[];
  let spendModel: SemanticModel;

  beforeAll(async () => {
    const instance = await DuckDBInstance.create(':memory:');
    db = await instance.connect();
    await db.run(DDL);
    models = deriveSemanticModels([SCHEMA], RELATIONSHIPS);
    spendModel = models.find((m) => m.table === 'ad_spend')!;
  });

  afterAll(() => {
    db?.closeSync();
  });

  it('the derived vocabulary contains everything the matrix uses', () => {
    const measureNames = spendModel.measures.map((m) => m.name);
    expect(measureNames).toEqual(expect.arrayContaining(['Count', 'Total Spend', 'Avg Spend', 'Unique Campaign', 'Total Impressions']));
    const dimNames = spendModel.dimensions.map((d) => d.name);
    expect(dimNames).toEqual(expect.arrayContaining(['Status', 'Campaign Id', 'Ad Campaigns Campaign Name', 'Ad Campaigns Channel']));
  });

  for (const [name, spec] of SPECS) {
    it(`executes: ${name}`, async () => {
      const ir = compileSemanticQuery(spec, spendModel);
      const sql = irToSqlLocal(ir, 'duckdb');
      // The whole point: a REAL binder sees this SQL. Ambiguous references throw here.
      const reader = await db.runAndReadAll(sql);
      const rows = reader.getRows();
      expect(Array.isArray(rows)).toBe(true);
      if (!spec.dimensions.length && !spec.timeGrain) {
        expect(rows.length).toBe(1); // pure aggregates return exactly one row
      }
    });

    it(`detects back: ${name}`, async () => {
      const ir = compileSemanticQuery(spec, spendModel);
      const sql = irToSqlLocal(ir, 'duckdb');
      const parsed = await parseSqlToIrLocal(sql, 'duckdb');
      const detected = semanticSpecFromIr(parsed as AnyQueryIR, models);
      expect(detected).toBeTruthy();
      expect(detected!.model).toBe(spec.model);
      expect([...detected!.measures].sort()).toEqual([...spec.measures].sort());
      expect([...detected!.dimensions].sort()).toEqual([...spec.dimensions].sort());
      expect(detected!.timeGrain ?? undefined).toBe(spec.timeGrain ?? undefined);
    });
  }

  it('timeColumn: a NON-default temporal column (end_date) is a valid time axis', async () => {
    const campaigns = models.find((m) => m.table === 'ad_campaigns')!;
    const spec: SemanticQuerySpec = {
      model: 'Ad Campaigns', table: 'ad_campaigns', schema: 'mxfood',
      measures: ['Count'], dimensions: [], timeGrain: 'MONTH', timeColumn: 'end_date',
    };
    const sql = irToSqlLocal(compileSemanticQuery(spec, campaigns), 'duckdb');
    expect(sql).toContain("DATE_TRUNC('MONTH', end_date)");
    const rows = (await db.runAndReadAll(sql)).getRows();
    expect(rows.length).toBeGreaterThan(0);
    // and it detects back, timeColumn preserved
    const parsed = await parseSqlToIrLocal(sql, 'duckdb');
    const detected = semanticSpecFromIr(parsed as AnyQueryIR, models);
    expect(detected).toMatchObject({ model: 'Ad Campaigns', timeGrain: 'MONTH', timeColumn: 'end_date' });
  });

  it('timeColumn: a non-temporal column is rejected at compile', () => {
    const spec = spendSpec({ measures: ['Count'], timeGrain: 'MONTH', timeColumn: 'status' });
    expect(() => compileSemanticQuery(spec, spendModel)).toThrow(/not a temporal column/);
  });

  it('sanity: the prod-bug query returns correct grouped counts', async () => {
    const ir = compileSemanticQuery(spendSpec({
      measures: ['Count'], dimensions: ['Ad Campaigns Campaign Name'],
    }), spendModel);
    const reader = await db.runAndReadAll(irToSqlLocal(ir, 'duckdb'));
    const byName = new Map(reader.getRows().map((r) => [r[0], Number(r[1])]));
    expect(byName.get('Summer Sale')).toBe(2);
    expect(byName.get('Winter Push')).toBe(2);
    expect(byName.get(null)).toBe(1); // orphan spend row keeps its count (LEFT join)
  });
});
