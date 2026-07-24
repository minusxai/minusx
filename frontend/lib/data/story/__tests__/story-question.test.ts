// Inline <Question> embeds round-trip: jsx attrs → embed → placeholder → embed → jsx,
// and an embed projects to a full QuestionContent for rendering.
import { describe, it, expect } from 'vitest';
import {
  inlineQuestionFromJsxAttrs, inlineQuestionToPlaceholder, inlineQuestionToJsx,
  extractInlineQuestions, placeholdersToInlineQuestionJsx, inlineEmbedToQuestionContent,
  savedQuestionToPlaceholder, savedQuestionVizFromEl, embeddedQuestionCount, applyVizOverride,
  updateSavedQuestionVizInHtml, updateInlineQuestionInHtml, questionContentToInlineEmbed,
  updateSavedQuestionVizInJsx, updateInlineQuestionInJsx,
  type InlineQuestionEmbed,
} from '../story-question';
import { parseJsx } from '@/lib/jsx';
import type { VizEnvelope, SpreadsheetSource, VizSettings, QuestionContent } from '@/lib/validation/atlas-schemas';
import { serializeJsonAttr } from '../html-attr';

const svEnvelope = {
  version: 2,
  source: { kind: 'recipe', recipe: 'minusx/single-value@1', bindings: { value: 'mrr' }, params: { label: 'MRR' }, columnFormats: null },
} as VizEnvelope;

const embed: InlineQuestionEmbed = {
  query: 'SELECT SUM(mrr) AS mrr\nFROM metrics\nWHERE month = :month AND mrr > 0',
  connection: 'duckdb',
  viz: svEnvelope,
  parameters: [{ name: 'month', type: 'date', label: null, source: null }],
  height: '200px',
};

describe('story-question — jsx attrs ⇄ inline embed', () => {
  it('builds an embed from <Question query=… connection=… viz=… params=…> attrs', () => {
    const e = inlineQuestionFromJsxAttrs({
      query: embed.query, connection: 'duckdb',
      viz: embed.viz, params: embed.parameters, height: '200px',
    });
    expect(e).toEqual(embed);
  });

  it('returns null when there is no query (not an inline question)', () => {
    expect(inlineQuestionFromJsxAttrs({ connection: 'duckdb' })).toBeNull();
    expect(inlineQuestionFromJsxAttrs({ id: 5 })).toBeNull();
  });

  it('defaults connection to "" and tolerates a missing viz/params', () => {
    expect(inlineQuestionFromJsxAttrs({ query: 'SELECT 1' })).toEqual({ query: 'SELECT 1', connection: '' });
  });

  it('normalizes literal \\n / \\t escapes (agent wrote a quoted attr, not a template literal) into real whitespace', () => {
    // A quoted JSX attribute leaves backslash-escapes literal; the SQL parser then chokes on `\`.
    const e = inlineQuestionFromJsxAttrs({ query: 'SELECT\\n  mrr\\nFROM t\\tWHERE x > 1', connection: 'duckdb' });
    expect(e!.query).toBe('SELECT\n  mrr\nFROM t\tWHERE x > 1');
    expect(e!.query).not.toContain('\\n');
    // a clean query (real newlines, e.g. from a template literal) is untouched
    expect(inlineQuestionFromJsxAttrs({ query: 'SELECT 1\nFROM t' })!.query).toBe('SELECT 1\nFROM t');
  });
});

describe('story-question — placeholder round-trip (through content.story HTML)', () => {
  it('embed → placeholder carries the full def and survives extract', () => {
    const html = inlineQuestionToPlaceholder(embed);
    expect(html).toContain('data-question-inline');
    expect(html).toContain('height:200px');
    expect(extractInlineQuestions(html)).toEqual([embed]);
  });

  it('escapes <, >, " and & in the encoded query so the HTML stays well-formed', () => {
    const tricky: InlineQuestionEmbed = { query: `SELECT * FROM t WHERE a < 1 AND b > 2 AND c = "x" & d`, connection: 'duckdb' };
    const html = inlineQuestionToPlaceholder(tricky);
    expect(html).not.toContain('< 1'); // raw '<' must be escaped inside the attribute
    expect(extractInlineQuestions(html)).toEqual([tricky]);
  });

  it('finds inline + saved embeds independently in one body', () => {
    const html = `<div class="s">${inlineQuestionToPlaceholder(embed)}<div data-question-id="42" style="width:100%;height:430px"></div></div>`;
    expect(extractInlineQuestions(html)).toEqual([embed]); // only the inline one
  });
});

describe('story-question — placeholder → <Question/> jsx (agent view)', () => {
  it('round-trips placeholder → jsx → placeholder (query as a raw template literal)', () => {
    const html = inlineQuestionToPlaceholder(embed);
    const jsx = placeholdersToInlineQuestionJsx(html);
    // raw multi-line SQL kept in a template literal (no \n escaping)
    expect(jsx).toContain('query={`SELECT SUM(mrr) AS mrr\nFROM metrics');
    expect(jsx).toContain('connection="duckdb"');
    expect(jsx).toContain('"recipe":"minusx/single-value@1"');
    // and inlineQuestionToJsx produces the same jsx
    expect(inlineQuestionToJsx(embed)).toBe(jsx);
  });
});

describe('story-question — legacy VizSettings inputs are AUTO-UPGRADED to V2 envelopes', () => {
  it('a legacy-shaped viz attr converts to an envelope at parse (the embed model is envelope-only)', () => {
    const e = inlineQuestionFromJsxAttrs({
      query: 'SELECT month, revenue FROM t', connection: 'duckdb',
      viz: { type: 'single_value', yCols: ['revenue'], singleValueConfig: { label: 'Revenue' } },
    });
    expect(e!.viz?.version).toBe(2);
    expect(e!.viz?.source).toMatchObject({ kind: 'recipe', recipe: 'minusx/single-value@1', bindings: { value: 'revenue' } });
    expect((e as unknown as Record<string, unknown>).vizSettings).toBeUndefined();
  });

  it('a STORED legacy payload (existing story bodies) converts on read', () => {
    const legacyPayload = {
      query: 'SELECT month, revenue FROM t', connection_name: 'duckdb',
      vizSettings: { type: 'bar', xCols: ['month'], yCols: ['revenue'] },
    };
    const html = `<div data-question-inline="${serializeJsonAttr(legacyPayload)}" style="width:100%;height:430px"></div>`;
    const [e] = extractInlineQuestions(html);
    expect(e.viz?.version).toBe(2);
    expect(e.viz?.source.kind).toBe('vega-lite');
    expect((e as unknown as Record<string, unknown>).vizSettings).toBeUndefined();
  });

  it('questionContentToInlineEmbed converts a legacy-only content viz to an envelope', () => {
    const c = {
      description: null, query: 'SELECT month, revenue FROM t', connection_name: 'duckdb',
      vizSettings: { type: 'bar', xCols: ['month'], yCols: ['revenue'] } as VizSettings,
      viz: null, parameters: [], parameterValues: null,
    } as QuestionContent;
    const back = questionContentToInlineEmbed(c);
    expect(back.viz?.version).toBe(2);
    expect(back.viz?.source.kind).toBe('vega-lite');
    expect((back as unknown as Record<string, unknown>).vizSettings).toBeUndefined();
  });
});

const envelope: VizEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: '.mx-th{background:#111;color:#fff}' },
};

const sheet: SpreadsheetSource = {
  version: 1,
  columns: [{ name: 'month', type: 'text' }, { name: 'mrr', type: 'number' }],
  rows: [['Jan', '120'], ['Feb', '140']],
};

describe('story-question — V2 viz envelope on inline embeds', () => {
  it('a viz attr shaped like an envelope ({version:2, source}) lands on embed.viz verbatim', () => {
    const e = inlineQuestionFromJsxAttrs({ query: 'SELECT 1', connection: 'duckdb', viz: envelope });
    expect(e).toEqual({ query: 'SELECT 1', connection: 'duckdb', viz: envelope });
  });

  it('envelope survives the placeholder round-trip and the jsx round-trip', () => {
    const e: InlineQuestionEmbed = { query: 'SELECT 1', connection: 'duckdb', viz: envelope };
    const html = inlineQuestionToPlaceholder(e);
    expect(extractInlineQuestions(html)).toEqual([e]);
    const jsx = placeholdersToInlineQuestionJsx(html);
    expect(jsx).toContain('"version":2');
    expect(inlineQuestionToJsx(e)).toBe(jsx);
  });

  it('projects to QuestionContent with viz AUTHORITATIVE (no legacy vizSettings alongside)', () => {
    const c = inlineEmbedToQuestionContent({ query: 'SELECT 1', connection: 'duckdb', viz: envelope });
    expect(c.viz).toEqual(envelope);
    expect(c.vizSettings ?? null).toBeNull();
  });
});

describe('story-question — spreadsheet (inline data) embeds', () => {
  it('builds an embed from <Question spreadsheet=… viz=…> attrs — no query required', () => {
    const e = inlineQuestionFromJsxAttrs({ spreadsheet: sheet, viz: envelope });
    expect(e).toEqual({ connection: '', spreadsheet: sheet, viz: envelope });
  });

  it('still returns null when there is neither a query nor a spreadsheet', () => {
    expect(inlineQuestionFromJsxAttrs({ connection: 'duckdb' })).toBeNull();
    expect(inlineQuestionFromJsxAttrs({ viz: envelope })).toBeNull();
  });

  it('spreadsheet survives the placeholder round-trip', () => {
    const e: InlineQuestionEmbed = { connection: '', spreadsheet: sheet, viz: envelope, height: '300px' };
    const html = inlineQuestionToPlaceholder(e);
    expect(html).toContain('data-question-inline');
    expect(extractInlineQuestions(html)).toEqual([e]);
  });

  it('emits jsx with a spreadsheet attr and no query attr; round-trips', () => {
    const e: InlineQuestionEmbed = { connection: '', spreadsheet: sheet };
    const jsx = inlineQuestionToJsx(e);
    expect(jsx).toContain('spreadsheet={');
    expect(jsx).not.toContain('query=');
    expect(placeholdersToInlineQuestionJsx(inlineQuestionToPlaceholder(e))).toBe(jsx);
  });

  it('projects to a QuestionContent whose spreadsheet drives rendering (query empty)', () => {
    const c = inlineEmbedToQuestionContent({ connection: '', spreadsheet: sheet });
    expect(c.spreadsheet).toEqual(sheet);
    expect(c.query).toBe('');
    expect(c.connection_name).toBe('');
  });

  it('embeddedQuestionCount counts spreadsheet-only inline embeds', () => {
    const html = inlineQuestionToPlaceholder({ connection: '', spreadsheet: sheet });
    expect(embeddedQuestionCount({ story: html }, 'story')).toBe(1);
  });
});

describe('story-question — saved embed viz override (data-question-viz)', () => {
  it('savedQuestionToPlaceholder without an override matches the classic placeholder', () => {
    expect(savedQuestionToPlaceholder(42, '430px'))
      .toBe('<div data-question-id="42" style="width:100%;height:430px"></div>');
  });

  it('carries a full V2 envelope on the placeholder and reads it back from a DOM el', () => {
    const html = savedQuestionToPlaceholder(42, '430px', envelope);
    expect(html).toContain('data-question-id="42"');
    expect(html).toContain('data-question-viz=');
    // simulate a DOM element (getAttribute returns the entity-DECODED value)
    const m = html.match(/data-question-viz="([^"]*)"/)!;
    const el = {
      getAttribute: (name: string) => {
        if (name !== 'data-question-viz') return null;
        return m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      },
    };
    expect(savedQuestionVizFromEl(el)).toEqual(envelope);
  });

  it('returns null for an element without an override or with a non-envelope payload', () => {
    expect(savedQuestionVizFromEl({ getAttribute: () => null })).toBeNull();
    expect(savedQuestionVizFromEl({ getAttribute: () => '{"type":"bar"}' })).toBeNull();
  });
});

describe('story-question — applyVizOverride (saved question + story override)', () => {
  const saved = {
    description: null, query: 'SELECT 1', connection_name: 'duckdb',
    vizSettings: { type: 'bar' } as VizSettings,
    viz: { version: 2, source: { kind: 'recipe', recipe: 'minusx/funnel@1', bindings: {}, params: null, columnFormats: null } } as VizEnvelope,
    parameters: [], parameterValues: null,
  } as QuestionContent;

  it('FULLY replaces the question viz (envelope swapped, legacy vizSettings suppressed)', () => {
    const out = applyVizOverride(saved, envelope);
    expect(out.viz).toEqual(envelope);
    expect(out.vizSettings ?? null).toBeNull();
    expect(out.query).toBe('SELECT 1'); // everything else untouched
  });

  it('is a no-op (same reference) without an override', () => {
    expect(applyVizOverride(saved, null)).toBe(saved);
    expect(applyVizOverride(saved, undefined)).toBe(saved);
  });
});

describe('story-question — modal write-back transforms (story HTML in, story HTML out)', () => {
  it('updateSavedQuestionVizInHtml sets the override on the right OCCURRENCE of a repeated id', () => {
    const html = `<p>a</p>${savedQuestionToPlaceholder(42)}<p>b</p>${savedQuestionToPlaceholder(7, '300px')}${savedQuestionToPlaceholder(42)}`;
    const out = updateSavedQuestionVizInHtml(html, 42, 1, envelope);
    // only the SECOND 42 placeholder gains the override; the first 42 and the 7 are untouched
    expect(out.match(/data-question-viz=/g)).toHaveLength(1);
    expect(out.indexOf('data-question-viz=')).toBeGreaterThan(out.indexOf('data-question-id="7"'));
    // height on the untouched 7 embed survives
    expect(out).toContain('height:300px');
  });

  it('updateSavedQuestionVizInHtml replaces an existing override and preserves the embed height', () => {
    const html = savedQuestionToPlaceholder(42, '250px', envelope);
    const next: VizEnvelope = { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } };
    const out = updateSavedQuestionVizInHtml(html, 42, 0, next);
    expect(out).toBe(savedQuestionToPlaceholder(42, '250px', next));
  });

  it('updateSavedQuestionVizInHtml with null REMOVES the override (back to the saved viz)', () => {
    const html = savedQuestionToPlaceholder(42, '430px', envelope);
    expect(updateSavedQuestionVizInHtml(html, 42, 0, null)).toBe(savedQuestionToPlaceholder(42, '430px'));
  });

  it('updateInlineQuestionInHtml replaces the nth inline embed (document order), leaving others alone', () => {
    const a: InlineQuestionEmbed = { query: 'SELECT 1', connection: 'c1' };
    const b: InlineQuestionEmbed = { query: 'SELECT 2', connection: 'c2' };
    const html = `<p>x</p>${inlineQuestionToPlaceholder(a)}<p>y</p>${inlineQuestionToPlaceholder(b)}`;
    const replacement: InlineQuestionEmbed = { connection: '', spreadsheet: sheet, viz: envelope };
    const out = updateInlineQuestionInHtml(html, 1, replacement);
    expect(extractInlineQuestions(out)).toEqual([a, replacement]);
    expect(out).toContain('<p>x</p>');
    expect(out).toContain('<p>y</p>');
  });

  it('questionContentToInlineEmbed reverse-projects; round-trips through inlineEmbedToQuestionContent', () => {
    const content = inlineEmbedToQuestionContent({ query: 'SELECT 1', connection: 'duckdb', viz: envelope, height: '250px' });
    const back = questionContentToInlineEmbed(content, '250px');
    expect(back).toEqual({ query: 'SELECT 1', connection: 'duckdb', viz: envelope, height: '250px' });
    // spreadsheet variant — the projection's DEFAULT table envelope is omitted on the way
    // back, so a viz-less embed stays viz-less in the markup
    const sheetContent = inlineEmbedToQuestionContent({ connection: '', spreadsheet: sheet });
    expect(questionContentToInlineEmbed(sheetContent)).toEqual({ connection: '', spreadsheet: sheet });
  });
});

describe('story-question — embed → QuestionContent projection (for rendering)', () => {
  it('maps connection→connection_name, viz→viz (authoritative), params→parameters', () => {
    const c = inlineEmbedToQuestionContent(embed);
    expect(c.query).toBe(embed.query);
    expect(c.connection_name).toBe('duckdb');
    expect(c.viz).toEqual(svEnvelope);
    expect(c.vizSettings ?? null).toBeNull();
    expect(c.parameters).toEqual(embed.parameters);
  });

  it('a bare inline question still yields a valid QuestionContent (V2 table envelope default)', () => {
    const c = inlineEmbedToQuestionContent({ query: 'SELECT 1', connection: '' });
    expect(c.viz).toEqual({ version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } });
    expect(c.vizSettings ?? null).toBeNull();
    expect(c.connection_name).toBe('');
    expect(c.parameters).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Jsx write-back (the story-embed edit modal's commit path on format:'jsx' stories)
// ---------------------------------------------------------------------------

/** Static attrs of the component element at an interpreter AST path (test read-back helper). */
function componentAttrsAt(source: string, path: string): Record<string, unknown> {
  const parsed = parseJsx(source);
  expect(parsed.ok, `parse: ${!parsed.ok ? parsed.error : ''}`).toBe(true);
  if (!parsed.ok) return {};
  let list = parsed.nodes;
  let node = null as (typeof list)[number] | null;
  for (const idx of path.split('.').map(Number)) {
    node = list[idx] ?? null;
    expect(node, `node at ${path}`).toBeTruthy();
    if (!node) return {};
    list = node.type === 'element' ? node.children : [];
  }
  expect(node?.type).toBe('element');
  const attrs: Record<string, unknown> = {};
  if (node?.type === 'element') for (const a of node.attributes) if (a.value.static) attrs[a.name] = a.value.json;
  return attrs;
}

const barEnvelope = {
  version: 2,
  source: { kind: 'recipe', recipe: 'minusx/bar@1', bindings: { x: 'month', y: 'mrr' }, params: {}, columnFormats: null },
} as VizEnvelope;

// Paths: div=0 → [h1=0.0, saved Question=0.1, Card=0.2 (inline Question=0.2.0), Number=0.3]
const JSX_DOC = `<div className="p-8"><h1>Report</h1><Question id={42} height="500px" className="mt-4" /><Card><Question query={\`SELECT a, b
FROM t WHERE label = 'q"uote'\`} connection="duckdb" viz={${JSON.stringify(svEnvelope)}} height="340px" className="rounded" /></Card><Number query={\`SELECT count(*) FROM t\`} connection="duckdb" prefix="$" /></div>`;

describe('story-question — updateSavedQuestionVizInJsx', () => {
  it('sets a viz override on the saved <Question> at the path, preserving its other attrs', () => {
    const out = updateSavedQuestionVizInJsx(JSX_DOC, '0.1', 42, barEnvelope);
    expect(out).not.toBe(JSX_DOC);
    const attrs = componentAttrsAt(out, '0.1');
    expect(attrs.viz).toEqual(barEnvelope);
    expect(attrs.id).toBe(42);
    expect(attrs.height).toBe('500px');
    expect(attrs.className).toBe('mt-4');
  });

  it('replaces an existing override, and viz=null removes it', () => {
    const withViz = updateSavedQuestionVizInJsx(JSX_DOC, '0.1', 42, svEnvelope);
    const replaced = updateSavedQuestionVizInJsx(withViz, '0.1', 42, barEnvelope);
    expect(componentAttrsAt(replaced, '0.1').viz).toEqual(barEnvelope);
    const removed = updateSavedQuestionVizInJsx(replaced, '0.1', 42, null);
    expect(componentAttrsAt(removed, '0.1').viz).toBeUndefined();
    expect(componentAttrsAt(removed, '0.1').id).toBe(42);
  });

  it('refuses a stale path: wrong id, non-Question element, inline (id-less) Question, bad path', () => {
    expect(updateSavedQuestionVizInJsx(JSX_DOC, '0.1', 99, barEnvelope)).toBe(JSX_DOC);
    expect(updateSavedQuestionVizInJsx(JSX_DOC, '0.0', 42, barEnvelope)).toBe(JSX_DOC);
    expect(updateSavedQuestionVizInJsx(JSX_DOC, '0.2.0', 42, barEnvelope)).toBe(JSX_DOC);
    expect(updateSavedQuestionVizInJsx(JSX_DOC, '9.9', 42, barEnvelope)).toBe(JSX_DOC);
  });

  it('returns a non-parsing source unchanged', () => {
    expect(updateSavedQuestionVizInJsx('<div', '0', 42, barEnvelope)).toBe('<div');
  });
});

describe('story-question — updateInlineQuestionInJsx', () => {
  const edited: InlineQuestionEmbed = {
    query: "SELECT c\nFROM u WHERE note = 'it''s \"fine\"'",
    connection: 'postgres',
    viz: barEnvelope,
    parameters: [{ name: 'day', type: 'date', label: null, source: null }],
    height: '340px',
  };

  it('replaces the inline <Question> definition at the path and round-trips through jsx attrs', () => {
    const out = updateInlineQuestionInJsx(JSX_DOC, '0.2.0', edited);
    expect(out).not.toBe(JSX_DOC);
    const attrs = componentAttrsAt(out, '0.2.0');
    expect(inlineQuestionFromJsxAttrs(attrs)).toEqual(edited);
    expect(attrs.className).toBe('rounded'); // unrelated attr preserved
  });

  it('drops viz/params attrs when the edited embed no longer carries them', () => {
    const out = updateInlineQuestionInJsx(JSX_DOC, '0.2.0', { query: 'SELECT 1', connection: 'duckdb', height: '340px' });
    const attrs = componentAttrsAt(out, '0.2.0');
    expect(attrs.viz).toBeUndefined();
    expect(attrs.params).toBeUndefined();
    expect(inlineQuestionFromJsxAttrs(attrs)).toEqual({ query: 'SELECT 1', connection: 'duckdb', height: '340px' });
  });

  it('refuses a saved (id) embed, a non-Question element, and a bad path', () => {
    expect(updateInlineQuestionInJsx(JSX_DOC, '0.1', edited)).toBe(JSX_DOC);
    expect(updateInlineQuestionInJsx(JSX_DOC, '0.3', edited)).toBe(JSX_DOC);
    expect(updateInlineQuestionInJsx(JSX_DOC, '4', edited)).toBe(JSX_DOC);
  });

  it('the rest of the document survives the round-trip (saved embed + prose intact)', () => {
    const out = updateInlineQuestionInJsx(JSX_DOC, '0.2.0', edited);
    expect(componentAttrsAt(out, '0.1')).toEqual({ id: 42, height: '500px', className: 'mt-4' });
    expect(out).toContain('Report');
  });
});
