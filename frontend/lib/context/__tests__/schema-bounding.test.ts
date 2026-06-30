// Memory bounding for a context's COMPUTED schema fields, applied at LOAD time (see schema-bounding.ts).
//  - boundSchema (parentSchema, the editor MENU): keep columns when small → names-only → table-capped.
//  - boundFullSchema (the CHILD-inheritance source): strip columns when huge but NEVER drop a table.
import { describe, it, expect } from 'vitest';
import { boundSchema, boundFullSchema } from '@/lib/context/schema-bounding';

const schemaWithCols = [
  { databaseName: 'wh', schemas: [
    { schema: 'sales', tables: [
      { table: 'orders', columns: [{ name: 'id' }, { name: 'amount' }] },
      { table: 'customers', columns: [{ name: 'id' }, { name: 'email' }] },
    ] },
  ] },
];

describe('boundSchema — parentSchema (the editor menu): tiered degradation', () => {
  it('tier 1: keeps columns when it fits the budget', () => {
    expect(boundSchema(schemaWithCols)).toBe(schemaWithCols);
  });

  it('tier 2: drops columns (names only) when with-columns exceeds the budget but names fit', () => {
    // ~400 tables × many columns: with-columns is well over 20k, names-only is well under.
    const tables = Array.from({ length: 400 }, (_, i) => ({
      table: `t${i}`,
      columns: Array.from({ length: 30 }, (_, c) => ({ name: `column_number_${c}`, type: 'text' })),
    }));
    const med: any = boundSchema([{ databaseName: 'wh', schemas: [{ schema: 'public', tables }] }]);
    const kept = med[0].schemas[0].tables;
    expect(kept).toHaveLength(400);            // every table name kept
    expect('columns' in kept[0]).toBe(false);  // but columns dropped
  });

  it('tier 3: caps the table list when even names-only is over budget', () => {
    const bigTables = Array.from({ length: 2000 }, (_, i) => ({ table: `table_with_a_longish_name_${i}`, columns: [{ name: 'c' }] }));
    const capped: any = boundSchema([{ databaseName: 'wh', schemas: [{ schema: 'public', tables: bigTables }] }]);
    const kept = capped.flatMap((db: any) => (db.schemas || []).flatMap((s: any) => s.tables || []));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(2000);    // truncated
    expect(JSON.stringify(capped).length).toBeLessThan(40000);
  });

  it('passes through non-arrays unchanged', () => {
    expect(boundSchema(undefined)).toBeUndefined();
  });
});

describe('boundFullSchema — the CHILD-inheritance source: strip columns, NEVER cap tables', () => {
  it('keeps columns for a small schema (no change)', () => {
    expect(boundFullSchema(schemaWithCols)).toBe(schemaWithCols);
  });

  it('drops columns but keeps EVERY table name for a huge schema (so children can still inherit any table)', () => {
    const tables = Array.from({ length: 3000 }, (_, i) => ({
      table: `events_2025_${i}`,
      columns: Array.from({ length: 20 }, (_, c) => ({ name: `column_number_${c}`, type: 'STRING' })),
    }));
    const huge = [{ databaseName: 'wh', schemas: [{ schema: 'warehouse', tables }] }];
    const bounded: any = boundFullSchema(huge);
    const kept = bounded.flatMap((db: any) => db.schemas.flatMap((s: any) => s.tables.map((t: any) => t.table)));
    expect(kept).toHaveLength(3000);                     // NOT capped — every table survives for inheritance
    expect(kept).toContain('events_2025_2999');          // including the very last one
    expect('columns' in bounded[0].schemas[0].tables[0]).toBe(false); // but columnar bulk is gone
  });
});
