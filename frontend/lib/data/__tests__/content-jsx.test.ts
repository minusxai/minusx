// Uniform schema-driven content ⇄ jsx round-trips. The schema drives types; jsx fields
// inline; arrays use <item>; schemaless scalars carry type="…".
import { describe, it, expect } from 'vitest';
import { contentToJsx, jsxToContent, type SchemaCtx } from '../content-jsx';
import { atlasSchema } from '@/lib/validation/atlas-json-schemas';

// Identity jsx-field codec — content-jsx is the GENERIC converter; the real story-specific codec
// (placeholder ⇄ <Question>/<Param>) is wired by file-markup and covered in file-markup.test.ts.
const ctx: SchemaCtx = {
  defs: (atlasSchema as { $defs?: Record<string, unknown> }).$defs ?? {},
  jsxField: { toJsx: (s) => s, fromJsx: (s) => s },
};

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

describe('content ⇄ jsx — discriminated/scalar unions (DashboardContent assets + layout id)', () => {
  const dashSchema = (atlasSchema as { $defs: Record<string, unknown> }).$defs.DashboardContent;

  it('preserves an inline TEXT asset (string id + content) AND a question ref through the round-trip', () => {
    const value = {
      description: 'MRR Dashboard',
      assets: [
        { type: 'text', id: 'inline-text-0', content: '# MRR Overview' },
        { type: 'question', id: 1026 },
      ],
      layout: {
        columns: 12,
        items: [
          { id: 'inline-text-0', x: 0, y: 0, w: 12, h: 2 },
          { id: 1026, x: 0, y: 2, w: 12, h: 6 },
        ],
      },
    };
    const { back } = roundtrip(value, dashSchema);
    expect(back.ok).toBe(true);
    if (back.ok) {
      const v = back.value as typeof value;
      // InlineAsset branch: content kept, string id kept (NOT coerced to NaN/null)
      expect(v.assets[0]).toEqual({ type: 'text', id: 'inline-text-0', content: '# MRR Overview' });
      // FileReference branch: integer id stays an integer
      expect(v.assets[1]).toEqual({ type: 'question', id: 1026 });
      // Scalar union DashboardLayoutItem.id: string id stays a string, int id stays an int
      expect(v.layout.items[0].id).toBe('inline-text-0');
      expect(v.layout.items[1].id).toBe(1026);
    }
  });

  it('does not corrupt a divider inline asset (string id, null content)', () => {
    const value = {
      description: 'd',
      assets: [{ type: 'divider', id: 'div-1', content: null }],
      layout: { columns: 12, items: [{ id: 'div-1', x: 0, y: 0, w: 12, h: 1 }] },
    };
    const { back } = roundtrip(value, dashSchema);
    expect(back.ok).toBe(true);
    if (back.ok) {
      const v = back.value as typeof value;
      expect(v.assets[0].type).toBe('divider');
      expect(v.assets[0].id).toBe('div-1');
      expect(v.layout.items[0].id).toBe('div-1');
    }
  });
});

describe('content ⇄ jsx — NotebookCell union (sql vs text cell discrimination)', () => {
  const nbSchema = (atlasSchema as { $defs: Record<string, unknown> }).$defs.NotebookContent;

  it('round-trips a SQL cell and a TEXT cell without cross-contaminating their fields', () => {
    const value = {
      description: 'nb',
      cells: [
        { type: 'sql', id: 'c1', name: 'Rev', query: 'SELECT 1 WHERE x < 5', vizSettings: { type: 'table' }, parameters: [], parameterValues: {}, connection_name: 'static', references: [] },
        { type: 'text', id: 'c2', name: null, content: '# Notes\nSome **markdown** body.' },
      ],
    };
    const { back } = roundtrip(value, nbSchema);
    expect(back.ok).toBe(true);
    if (back.ok) {
      const v = back.value as typeof value;
      // SQL branch keeps query/viz; not mis-parsed as a text cell.
      expect(v.cells[0]).toMatchObject({ type: 'sql', id: 'c1', query: 'SELECT 1 WHERE x < 5' });
      // TEXT branch keeps its `content` (dropped before FIX-3 — union resolved to NotebookSqlCell).
      expect(v.cells[1]).toMatchObject({ type: 'text', id: 'c2', content: '# Notes\nSome **markdown** body.' });
      expect((v.cells[1] as { query?: string }).query).toBeUndefined();
    }
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

describe('jsxToContent — loose top-level body markup (agent omitted the <story> wrapper)', () => {
  // Agents routinely author a story body as loose top-level markup (<style> + <div>, per the
  // skill scaffolds) instead of wrapping it in the <story> field element. Dropping it silently
  // produced the "1 FILE EDIT but blank story" bug; failing loudly made CreateFile always fail.
  // The right behavior: when the schema has a jsx field and the document doesn't provide it,
  // ADOPT the unrecognized top-level markup as that field's body.
  const schema = {
    type: 'object',
    properties: { story: { type: 'string', format: 'jsx' }, description: { type: 'string' } },
  };

  it('adopts a loose <div> body into the jsx field (CreateFile from the skill scaffold)', () => {
    const res = jsxToContent('<div class="story"><h1>Hi</h1><p>Body</p></div>', schema, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = res.value as { story?: string };
      expect(v.story).toContain('<h1>Hi</h1>');
      expect(v.story).toContain('class="story"');
    }
  });

  it('adopts a loose <style> + <div> pair, preserving both and their order', () => {
    const res = jsxToContent(
      '<style>{`.story-x { color: red; }`}</style>\n<div class="story-x"><h1>Hi</h1></div>',
      schema, ctx
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const story = (res.value as { story?: string }).story ?? '';
      expect(story).toContain('.story-x');
      expect(story.indexOf('<style')).toBeLessThan(story.indexOf('<div'));
    }
  });

  it('adopts loose body markup alongside recognized sibling fields (mixed document)', () => {
    const res = jsxToContent(
      '<description>launch recap</description>\n<style>{`.s{color:red}`}</style>\n<div class="s"><h1>Hi</h1></div>',
      schema, ctx
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = res.value as { description?: string; story?: string };
      expect(v.description).toBe('launch recap');
      expect(v.story).toContain('<h1>Hi</h1>');
    }
  });

  it('does NOT adopt loose siblings when the jsx field is explicitly provided', () => {
    const res = jsxToContent('<story><h1>Hi</h1></story><div>loose</div>', schema, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const story = (res.value as { story?: string }).story ?? '';
      expect(story).toContain('Hi');
      expect(story).not.toContain('loose');
    }
  });

  it('still enforces the static-JSX security rules on adopted markup (<script> rejected)', () => {
    const res = jsxToContent('<div class="story"><script>alert(1)</script></div>', schema, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.toLowerCase()).toContain('script');
  });

  it('still fails loudly for schemas WITHOUT a jsx field (question markup stays strict)', () => {
    const qSchema = { type: 'object', properties: { query: { type: 'string' }, description: { type: 'string' } } };
    const res = jsxToContent('<div class="story"><h1>Hi</h1></div>', qSchema, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/div/);
      expect(res.error).toMatch(/query/);
    }
  });

  it('treats an empty document (no elements) as an empty object, not an error', () => {
    const res = jsxToContent('', schema, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({});
  });
});
