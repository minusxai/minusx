/**
 * Semantic model config validation — the save-time gate that guarantees a
 * context never persists an incomplete/contradictory model (the query-time
 * compiler can then trust its input). Messages are user-facing: prefixed with
 * the model name and specific about what's missing.
 */
import { describe, it, expect } from 'vitest';
import { validateSemanticModels } from '../validate-models';
import type { SemanticModel } from '@/lib/types/semantic';

const valid: SemanticModel = {
  name: 'Orders',
  connection: 'warehouse',
  table: 'orders',
  timeDimension: { column: 'created_at' },
  dimensions: [{ name: 'Status', column: 'status' }],
  measures: [
    { name: 'Count', agg: 'COUNT' },
    { name: 'Revenue', agg: 'SUM', column: 'total' },
  ],
  joins: [{ table: 'customers', alias: 'c', leftColumn: 'customer_id', rightColumn: 'id' }],
  metrics: [{ name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Count' }],
};

describe('validateSemanticModels', () => {
  it('accepts a complete model (and an empty list)', () => {
    expect(validateSemanticModels([valid])).toEqual([]);
    expect(validateSemanticModels([])).toEqual([]);
    expect(validateSemanticModels(undefined)).toEqual([]);
  });

  it('requires model name, table and at least one measure', () => {
    const issues = validateSemanticModels([
      { ...valid, name: ' ', table: '', measures: [] },
    ]);
    expect(issues.join('; ')).toMatch(/name/i);
    expect(issues.join('; ')).toMatch(/table/i);
    expect(issues.join('; ')).toMatch(/measure/i);
  });

  it('flags duplicate model names', () => {
    const issues = validateSemanticModels([valid, { ...valid }]);
    expect(issues.join('; ')).toMatch(/duplicate.*Orders/i);
  });

  it('flags incomplete dimensions and duplicate dimension names', () => {
    const issues = validateSemanticModels([{
      ...valid,
      dimensions: [
        { name: '', column: 'status' },
        { name: 'Region', column: '' },
        { name: 'Status', column: 'status' },
        { name: 'Status', column: 'zone' },
      ],
    }]);
    expect(issues.join('; ')).toMatch(/dimension.*name/i);
    expect(issues.join('; ')).toMatch(/dimension.*column/i);
    expect(issues.join('; ')).toMatch(/duplicate.*Status/i);
  });

  it('flags measures missing a column (except COUNT) and duplicate measure names', () => {
    const issues = validateSemanticModels([{
      ...valid,
      measures: [
        { name: 'Revenue', agg: 'SUM' },          // SUM needs a column
        { name: 'Revenue', agg: 'AVG', column: 'total' },
        { name: '', agg: 'COUNT' },
      ],
    }]);
    expect(issues.join('; ')).toMatch(/Revenue.*column/i);
    expect(issues.join('; ')).toMatch(/duplicate.*Revenue/i);
    expect(issues.join('; ')).toMatch(/measure.*name/i);
  });

  it('flags metrics referencing unknown measures', () => {
    const issues = validateSemanticModels([{
      ...valid,
      metrics: [{ name: 'AOV', type: 'ratio', numerator: 'Nope', denominator: 'Count' }],
    }]);
    expect(issues.join('; ')).toMatch(/AOV.*Nope/);
  });

  it('accepts declared relationships and flags duplicate join aliases', () => {
    expect(validateSemanticModels([{
      ...valid,
      joins: [{ table: 'customers', alias: 'c', relationship: 'one_to_one', leftColumn: 'customer_id', rightColumn: 'id' }],
    }])).toEqual([]);

    const issues = validateSemanticModels([{
      ...valid,
      joins: [
        { table: 'customers', alias: 'c', leftColumn: 'customer_id', rightColumn: 'id' },
        { table: 'zones', alias: 'c', leftColumn: 'zone_id', rightColumn: 'id' },
      ],
    }]);
    expect(issues.join('; ')).toMatch(/duplicate.*alias.*"c"/i);
  });

  it('flags incomplete joins and dimensions pointing at unknown joins', () => {
    const issues = validateSemanticModels([{
      ...valid,
      joins: [{ table: '', alias: '', leftColumn: '', rightColumn: '' }],
      dimensions: [{ name: 'Region', column: 'region', join: 'missing' }],
    }]);
    expect(issues.join('; ')).toMatch(/join/i);
    expect(issues.join('; ')).toMatch(/Region.*missing/i);
  });
});
