// Uniform schema-driven content ⇄ jsx round-trips. The schema drives types; jsx fields
// inline; arrays use <item>; schemaless scalars carry type="…".
import { describe, it, expect } from 'vitest';
import { contentToJsx, jsxToContent, type SchemaCtx } from '../content-jsx';
import { atlasSchema } from '@/lib/validation/atlas-json-schemas';

const ctx: SchemaCtx = { defs: (atlasSchema as { $defs?: Record<string, unknown> }).$defs ?? {} };

function roundtrip(value: unknown, schema: unknown) {
  const jsx = contentToJsx(value, schema, ctx);
  const back = jsxToContent(jsx, schema, ctx);
  return { jsx, back };
}

describe('content ⇄ jsx — hand schema (the personal/story/friends shape)', () => {
  const schema = {
    type: 'object',
    properties: {
      personal: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } },
      story: { type: 'string', format: 'jsx' },
      friends: { type: 'array', items: { type: 'string' } },
    },
  };

  it('emits fields at top level (no wrapper), nests objects, <item> arrays, inline jsx', () => {
    const value = {
      personal: { name: 'Julie', age: 35 },
      story: '<div class="story"><h1>Hi</h1></div>',
      friends: ['alice', 'bob'],
    };
    const { jsx, back } = roundtrip(value, schema);
    expect(jsx).toContain('<personal>');
    expect(jsx).toContain('<name>Julie</name>');
    expect(jsx).toContain('<age>35</age>');
    expect(jsx).toContain('<friends>');
    expect(jsx).toContain('<item>alice</item>');
    expect(jsx).toContain('<story><div class="story">'); // jsx field inline, not {`…`}
    expect(jsx).not.toContain('<props>'); // no wrapper
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value).toMatchObject({ personal: { name: 'Julie', age: 35 }, friends: ['alice', 'bob'] });
      expect((back.value as { story: string }).story).toContain('<h1>Hi</h1>');
    }
  });

  it('coerces integers back to numbers (schema-typed)', () => {
    const { back } = roundtrip({ personal: { name: 'x', age: 40 } }, schema);
    expect(back.ok && (back.value as { personal: { age: number } }).personal.age).toBe(40);
  });

  it('rejects a jsx field that violates the static-JSX security rules (e.g. <script>)', () => {
    const bad = jsxToContent('<story><div class="story"><script>alert(1)</script></div></story>', schema, ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.toLowerCase()).toContain('script');
  });
});

describe('content ⇄ jsx — schemaless config (type="…")', () => {
  it('annotates non-string + numeric-looking scalars so they round-trip losslessly', () => {
    const value = { type: 'postgres', config: { host: 'db', port: 5432, ssl: true, zip: '90210' } };
    const { jsx, back } = roundtrip(value, undefined);
    expect(jsx).toContain('<port type="number">5432</port>');
    expect(jsx).toContain('<ssl type="boolean">true</ssl>');
    expect(jsx).toContain('<zip type="string">90210</zip>'); // numeric-looking string pinned
    expect(jsx).toContain('<host>db</host>');                 // plain string, no annotation
    expect(back.ok && back.value).toEqual(value);             // port→5432, ssl→true, zip→"90210"
  });
});

describe('content ⇄ jsx — real QuestionContent (raw SQL leaf, nested viz)', () => {
  const qSchema = (atlasSchema as { $defs: Record<string, unknown> }).$defs.QuestionContent;

  it('keeps SQL with < as a raw template-literal leaf and round-trips viz', () => {
    const value = {
      description: 'rev',
      query: 'SELECT m, sum(r) AS r FROM s WHERE r < 5000 GROUP BY 1',
      connection_name: 'saas_metrics',
      vizSettings: { type: 'bar', xCols: ['m'], yCols: ['r'] },
      parameters: [],
    };
    const { jsx, back } = roundtrip(value, qSchema);
    expect(jsx).toContain('WHERE r < 5000'); // raw, no escaping
    expect(jsx).toContain('<connection_name>saas_metrics</connection_name>');
    expect(jsx).toContain('<vizSettings>');
    expect(back.ok).toBe(true);
    if (back.ok) {
      const v = back.value as typeof value;
      expect(v.query).toBe(value.query);
      expect(v.vizSettings).toMatchObject({ type: 'bar', xCols: ['m'], yCols: ['r'] });
    }
  });
});
