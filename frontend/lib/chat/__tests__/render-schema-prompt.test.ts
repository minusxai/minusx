import { describe, it, expect } from 'vitest';
import {
  renderSchemaForPrompt,
  DEFAULT_SCHEMA_PROMPT_BUDGET_CHARS,
  type SchemaEntry,
} from '@/lib/chat/render-schema-prompt';

const small: SchemaEntry[] = [
  { schema: 'public', tables: ['orders', 'customers', 'products'] },
  { schema: 'analytics', tables: ['daily_revenue'] },
];

function makeHugeSchema(numSchemas: number, tablesPer: number): SchemaEntry[] {
  return Array.from({ length: numSchemas }, (_, s) => ({
    schema: `schema_${s}`,
    tables: Array.from({ length: tablesPer }, (_, t) => `table_${s}_${t}`),
  }));
}

describe('renderSchemaForPrompt', () => {
  it('renders a small schema identically to JSON.stringify with no truncation note', () => {
    const out = renderSchemaForPrompt(small);
    expect(out).toBe(JSON.stringify(small));
    expect(out).not.toMatch(/more table/i);
    expect(out).not.toMatch(/SearchDBSchema/);
  });

  it('returns "[]" for an empty array (truthy, no note)', () => {
    expect(renderSchemaForPrompt([])).toBe('[]');
  });

  it('returns emptyText for null/undefined (default empty string)', () => {
    expect(renderSchemaForPrompt(undefined)).toBe('');
    expect(renderSchemaForPrompt(null)).toBe('');
    expect(renderSchemaForPrompt(undefined, { emptyText: 'No schema provided.' })).toBe(
      'No schema provided.',
    );
  });

  it('caps output near the budget for a rogue schema with thousands of tables', () => {
    const huge = makeHugeSchema(50, 200); // 10,000 tables
    const out = renderSchemaForPrompt(huge, { budgetChars: 1000 });
    // Output should be far smaller than the full stringification.
    expect(out.length).toBeLessThan(JSON.stringify(huge).length / 5);
    // Some content is still present.
    expect(out).toContain('table_0_0');
    // And it tells the agent more exist + how to find them.
    expect(out).toMatch(/more table/i);
    expect(out).toContain('SearchDBSchema');
  });

  it('reports how many tables AND whole schemas were dropped', () => {
    const huge = makeHugeSchema(10, 100); // 1000 tables across 10 schemas
    const out = renderSchemaForPrompt(huge, { budgetChars: 200 });
    // Tiny budget → most schemas entirely omitted.
    const tableMatch = out.match(/(\d+)\s+more table/i);
    const schemaMatch = out.match(/(\d+)\s+more schema/i);
    expect(tableMatch).not.toBeNull();
    expect(schemaMatch).not.toBeNull();
    expect(Number(tableMatch![1])).toBeGreaterThan(0);
    expect(Number(schemaMatch![1])).toBeGreaterThan(0);
  });

  it('omits the schema count when only tables within a shown schema are dropped', () => {
    const one: SchemaEntry[] = [{ schema: 'public', tables: Array.from({ length: 500 }, (_, i) => `t_${i}`) }];
    const out = renderSchemaForPrompt(one, { budgetChars: 200 });
    expect(out).toMatch(/more table/i);
    expect(out).not.toMatch(/more schema/i);
  });

  it('supports pretty-printing', () => {
    const out = renderSchemaForPrompt(small, { pretty: true });
    expect(out).toContain('\n');
    expect(out).toContain('  ');
  });

  it('has a sane default budget exported', () => {
    expect(DEFAULT_SCHEMA_PROMPT_BUDGET_CHARS).toBeGreaterThan(0);
  });
});
