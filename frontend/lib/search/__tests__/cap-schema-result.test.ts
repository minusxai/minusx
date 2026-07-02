/**
 * capSchemaResult bounds the serialized size of a SearchDBSchema result handed to the LLM. An
 * unbounded schema (e.g. a GA4 export with hundreds of identical events_YYYYMMDD tables, millions of
 * chars) is re-sent every turn and single-handedly exhausts the model's context window during a
 * dashboard/story build. This keeps whole tables in order until a budget runs out, then annotates it.
 */
import { capSchemaResult, SCHEMA_RESULT_MAX_CHARS } from '@/lib/search/schema-search';

// A table whose serialized form is ~1KB (padded column name).
function bigTable(i: number) {
  return { table: `events_2025${String(i).padStart(4, '0')}`, columns: Array.from({ length: 8 }, (_, c) => ({ name: `col_${c}_${'x'.repeat(100)}`, type: 'STRING' })) };
}

describe('capSchemaResult', () => {
  it('returns the payload untouched when already under the cap', () => {
    const payload = { success: true, schema: [{ schema: 's', tables: [bigTable(1), bigTable(2)] }], queryType: 'none' };
    expect(capSchemaResult(payload, 1_000_000)).toBe(payload); // same reference, no copy
  });

  it('caps a huge `schema` payload and annotates the truncation', () => {
    const tables = Array.from({ length: 500 }, (_, i) => bigTable(i));
    const payload = { success: true, schema: [{ schema: 'analytics', tables }], queryType: 'none' as const };
    const capped = capSchemaResult(payload) as typeof payload & { truncated?: boolean; note?: string };

    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(SCHEMA_RESULT_MAX_CHARS);
    expect(capped.truncated).toBe(true);
    expect(capped.note).toMatch(/showing \d+ of 500 tables/);
    // Kept a non-empty, in-order prefix of the tables.
    expect(capped.schema[0].tables.length).toBeGreaterThan(0);
    expect(capped.schema[0].tables.length).toBeLessThan(500);
    expect(capped.schema[0].tables[0].table).toBe('events_20250000');
  });

  it('caps the keyword-search `results` shape too', () => {
    const tables = Array.from({ length: 500 }, (_, i) => bigTable(i));
    const payload = { success: true, results: [{ schema: { schema: 'analytics', tables }, score: 1 }], queryType: 'string' as const };
    const capped = capSchemaResult(payload) as typeof payload & { truncated?: boolean };
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(SCHEMA_RESULT_MAX_CHARS);
    expect(capped.truncated).toBe(true);
    expect(capped.results[0].schema.tables.length).toBeGreaterThan(0);
    expect(capped.results[0].schema.tables.length).toBeLessThan(500);
  });

  it('does NOT mutate the input (cached schema objects stay intact)', () => {
    const tables = Array.from({ length: 500 }, (_, i) => bigTable(i));
    const payload = { success: true, schema: [{ schema: 'analytics', tables }], queryType: 'none' as const };
    capSchemaResult(payload);
    expect(payload.schema[0].tables.length).toBe(500); // original untouched
  });
});
