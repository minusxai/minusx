// Inline <Number> — a live single figure that sits IN the prose (a styled <span>), not a chart
// card. Polymorphic like <Question>: id={N} (saved question) or query={`…`} (inline). Round-trips
// jsx attrs → embed → placeholder → embed → jsx.
import { describe, it, expect } from 'vitest';
import {
  numberFromJsxAttrs, numberToPlaceholder, numberToJsx, extractInlineNumbers,
  placeholdersToNumberJsx, type InlineNumberEmbed,
} from '../story-number';

describe('story-number — jsx attrs ⇄ embed', () => {
  it('builds an INLINE-query number embed with decoration + style', () => {
    const e = numberFromJsxAttrs({
      query: 'SELECT SUM(mrr) AS mrr FROM t', connection: 'duckdb',
      col: 'mrr', prefix: '$', suffix: '/mo', style: { color: '#16a34a', fontWeight: 700 },
    });
    expect(e).toEqual({
      query: 'SELECT SUM(mrr) AS mrr FROM t', connection: 'duckdb',
      col: 'mrr', prefix: '$', suffix: '/mo', style: { color: '#16a34a', fontWeight: 700 },
    });
  });

  it('builds a SAVED-question number embed from id', () => {
    expect(numberFromJsxAttrs({ id: 1026, prefix: '$' })).toEqual({ id: 1026, prefix: '$' });
  });

  it('returns null without an id or a query', () => {
    expect(numberFromJsxAttrs({ prefix: '$' })).toBeNull();
  });

  it('cooks \\n / \\t escapes in the query (agent wrote a double-quoted attr, not a template literal)', () => {
    // A double-quoted JSX attr `query="…\n…"` resolves to a LITERAL backslash-n (JSX doesn't
    // process escapes), which DuckDB/Postgres reject: 'syntax error at or near "\"'. Cook it to
    // real whitespace — the same normalization inline <Question> embeds already get — so the
    // agent's most common query mistake is harmless. (A template literal arrives already cooked,
    // so this is a no-op on the correct form.)
    const e = numberFromJsxAttrs({ query: 'SELECT a\\nFROM t\\tWHERE x = 1', connection: 'duck' });
    expect(e?.query).toBe('SELECT a\nFROM t\tWHERE x = 1');
  });
});

describe('story-number — placeholder round-trip (inline SPAN, not a block)', () => {
  const embed: InlineNumberEmbed = {
    query: 'SELECT v FROM t\nWHERE a < 1 LIMIT 1', connection: 'duckdb',
    col: 'v', prefix: '$', suffix: 'k', style: { color: '#fff' },
  };

  it('embed → <span data-number-inline> and survives extract', () => {
    const html = numberToPlaceholder(embed);
    expect(html.startsWith('<span')).toBe(true); // inline, not <div>
    expect(html).toContain('data-number-inline');
    expect(extractInlineNumbers(html)).toEqual([embed]);
  });

  it('saved id → <span data-number-id>', () => {
    const html = numberToPlaceholder({ id: 1026, prefix: '$' });
    expect(html).toContain('data-number-id="1026"');
    expect(extractInlineNumbers(html)).toEqual([{ id: 1026, prefix: '$' }]);
  });

  it('escapes <, >, " in the encoded inline query', () => {
    const tricky: InlineNumberEmbed = { query: 'SELECT * WHERE a < 1 AND b > 2', connection: 'd' };
    expect(extractInlineNumbers(numberToPlaceholder(tricky))).toEqual([tricky]);
  });
});

describe('story-number — placeholder → <Number/> jsx', () => {
  it('round-trips placeholder → jsx → placeholder for an inline-query number', () => {
    const embed: InlineNumberEmbed = { query: 'SELECT v\nFROM t', connection: 'duckdb', prefix: '$', style: { color: '#fff' } };
    const jsx = placeholdersToNumberJsx(numberToPlaceholder(embed));
    expect(jsx).toContain('query={`SELECT v\nFROM t`}');
    expect(jsx).toContain('style={{"color":"#fff"}}');
    expect(numberToJsx(embed)).toBe(jsx);
  });

  it('emits a saved-id <Number/> as id={N}', () => {
    expect(numberToJsx({ id: 1026, prefix: '$' })).toBe('<Number id={1026} prefix="$" />');
  });
});

// ---------------------------------------------------------------------------
// Jsx write-back (the number query editor's commit path on format:'jsx' stories)
// ---------------------------------------------------------------------------
import { updateNumberQueryInJsx } from '../story-number';
import { parseJsx } from '@/lib/jsx';

/** Static attrs of the component element at an interpreter AST path (test read-back helper). */
function componentAttrsAt(source: string, path: string): Record<string, unknown> {
  const parsed = parseJsx(source);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return {};
  let list = parsed.nodes;
  let node = null as (typeof list)[number] | null;
  for (const idx of path.split('.').map(Number)) {
    node = list[idx] ?? null;
    if (!node) return {};
    list = node.type === 'element' ? node.children : [];
  }
  const attrs: Record<string, unknown> = {};
  if (node?.type === 'element') for (const a of node.attributes) if (a.value.static) attrs[a.name] = a.value.json;
  return attrs;
}

describe('story-number — updateNumberQueryInJsx', () => {
  // Paths: div=0 → [p=0.0 (inline Number=0.0.1), saved Number=0.1]
  const DOC = `<div className="p-8"><p>MRR is <Number query={\`SELECT SUM(mrr) FROM m\`} connection="duckdb" prefix="$" style={{"fontWeight":700}} /></p><Number id={7} suffix="%" /></div>`;

  it('replaces the query on the inline <Number> at the path, preserving decoration attrs', () => {
    const out = updateNumberQueryInJsx(DOC, '0.0.1', "SELECT SUM(mrr) FROM m WHERE month = 'Jan'");
    expect(out).not.toBe(DOC);
    const attrs = componentAttrsAt(out, '0.0.1');
    expect(numberFromJsxAttrs(attrs)).toEqual({
      query: "SELECT SUM(mrr) FROM m WHERE month = 'Jan'",
      connection: 'duckdb', prefix: '$', style: { fontWeight: 700 },
    });
  });

  it('refuses a saved (id) number, a non-Number element, and a bad path', () => {
    expect(updateNumberQueryInJsx(DOC, '0.1', 'SELECT 1')).toBe(DOC);
    expect(updateNumberQueryInJsx(DOC, '0.0', 'SELECT 1')).toBe(DOC);
    expect(updateNumberQueryInJsx(DOC, '9', 'SELECT 1')).toBe(DOC);
  });

  it('returns a non-parsing source unchanged', () => {
    expect(updateNumberQueryInJsx('<div', '0', 'SELECT 1')).toBe('<div');
  });
});
