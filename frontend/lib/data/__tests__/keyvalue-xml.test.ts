// Schema-driven keyvalue ⇄ XML round-trips. The schema both validates and drives the
// conversion; these tests pin the markup shape and prove value === xmlToProps(propsToXml(value)).
import { describe, it, expect } from 'vitest';
import { propsToXml, xmlToProps, type SchemaCtx } from '../keyvalue-xml';
import { atlasSchema } from '@/lib/validation/atlas-json-schemas';

const ctx: SchemaCtx = { defs: (atlasSchema as { $defs?: Record<string, unknown> }).$defs ?? {} };

function roundtrip(value: unknown, schema: unknown, root: string) {
  const xml = propsToXml(value, schema, root, ctx);
  const back = xmlToProps(xml, schema, ctx);
  return { xml, back };
}

describe('keyvalue ⇄ xml (hand-built schema)', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      port: { type: 'integer' },
      enabled: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      nested: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } },
      maybe: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
  };

  it('round-trips scalars, arrays, nested objects, and coerces by schema type', () => {
    const value = { name: 'db', port: 5432, enabled: true, tags: ['a', 'b'], nested: { a: 'x', b: 1.5 } };
    const { back } = roundtrip(value, schema, 'connection');
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value).toEqual({ ...value, maybe: undefined } as unknown);
  });

  it('emits nested elements (not attributes) and <item> for arrays', () => {
    const { xml } = roundtrip({ name: 'db', tags: ['a', 'b'] }, schema, 'connection');
    expect(xml).toContain('<connection>');
    expect(xml).toContain('<name>db</name>');
    expect(xml).toContain('<tags>');
    expect(xml).toContain('<item>a</item>');
  });

  it('omits null / absent optionals', () => {
    const { xml, back } = roundtrip({ name: 'db', maybe: null }, schema, 'connection');
    expect(xml).not.toContain('<maybe>');
    expect(back.ok && (back.value as { maybe?: unknown }).maybe).toBeUndefined();
  });

  it('keeps strings with markup chars raw via a template-literal child (SQL survives)', () => {
    const sql = 'SELECT a, b FROM t WHERE x < 5 AND y > 1';
    const { xml, back } = roundtrip({ name: sql }, schema, 'q');
    expect(xml).toContain('<name>{`SELECT a, b FROM t WHERE x < 5 AND y > 1`}</name>');
    expect(back.ok && (back.value as { name: string }).name).toBe(sql);
  });

  it('coerces numeric/boolean text back to typed values', () => {
    const { back } = roundtrip({ port: 8080, enabled: false }, schema, 'c');
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect((back.value as { port: number }).port).toBe(8080);
      expect((back.value as { enabled: boolean }).enabled).toBe(false);
    }
  });
});

describe('keyvalue ⇄ xml (schemaless — config types with no JSON schema)', () => {
  it('infers object / array / scalar structure and coerces on the way back', () => {
    const value = {
      type: 'postgres',
      config: { host: 'db.internal', port: 5432, ssl: true, schemas: ['public', 'analytics'] },
    };
    const xml = propsToXml(value, undefined, 'props', ctx);
    const back = xmlToProps(xml, undefined, ctx);
    expect(xml).toContain('<config>');
    expect(xml).toContain('<item>public</item>');
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value).toEqual(value); // port→5432 (number), ssl→true (bool)
  });
});

describe('keyvalue ⇄ xml (real QuestionContent schema)', () => {
  const qSchema = (atlasSchema as { $defs: Record<string, unknown> }).$defs.QuestionContent;

  it('round-trips a question: raw SQL child + nested viz + arrays', () => {
    const value = {
      description: 'rev by month',
      query: 'SELECT month, sum(rev) AS rev FROM sales WHERE rev < 5000 GROUP BY 1',
      connection_name: 'mxfood_duckdb',
      vizSettings: { type: 'bar', xCols: ['month'], yCols: ['rev'] },
      parameters: [],
    };
    const { xml, back } = roundtrip(value, qSchema, 'question');
    // SQL with `<` lives in a raw child, untouched.
    expect(xml).toContain('WHERE rev < 5000');
    expect(xml).toContain('<connection_name>mxfood_duckdb</connection_name>');
    expect(xml).toContain('<vizSettings>');
    expect(back.ok).toBe(true);
    if (back.ok) {
      const v = back.value as typeof value;
      expect(v.query).toBe(value.query);
      expect(v.connection_name).toBe('mxfood_duckdb');
      expect(v.vizSettings).toMatchObject({ type: 'bar', xCols: ['month'], yCols: ['rev'] });
    }
  });
});
