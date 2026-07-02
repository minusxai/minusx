// Inline <Question> embeds round-trip: jsx attrs → embed → placeholder → embed → jsx,
// and an embed projects to a full QuestionContent for rendering.
import { describe, it, expect } from 'vitest';
import {
  inlineQuestionFromJsxAttrs, inlineQuestionToPlaceholder, inlineQuestionToJsx,
  extractInlineQuestions, placeholdersToInlineQuestionJsx, inlineEmbedToQuestionContent,
  type InlineQuestionEmbed,
} from '../story-question';

const embed: InlineQuestionEmbed = {
  query: 'SELECT SUM(mrr) AS mrr\nFROM metrics\nWHERE month = :month AND mrr > 0',
  connection: 'duckdb',
  vizSettings: { type: 'single_value', yCols: ['mrr'], singleValueConfig: { prefix: '$', suffix: ' MRR' } },
  parameters: [{ name: 'month', type: 'date', label: null, source: null }],
  height: '200px',
};

describe('story-question — jsx attrs ⇄ inline embed', () => {
  it('builds an embed from <Question query=… connection=… viz=… params=…> attrs', () => {
    const e = inlineQuestionFromJsxAttrs({
      query: embed.query, connection: 'duckdb',
      viz: embed.vizSettings, params: embed.parameters, height: '200px',
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
    expect(jsx).toContain('"type":"single_value"');
    // and inlineQuestionToJsx produces the same jsx
    expect(inlineQuestionToJsx(embed)).toBe(jsx);
  });
});

describe('story-question — width authoring (flow-block contract)', () => {
  const sized: InlineQuestionEmbed = { query: 'SELECT 1', connection: 'duckdb', width: '720px', height: '300px' };

  it('reads a width attr into the embed', () => {
    const e = inlineQuestionFromJsxAttrs({ query: 'SELECT 1', connection: 'duckdb', width: '720px', height: '300px' });
    expect(e).toEqual(sized);
  });

  it('places px width onto the placeholder style and round-trips through extract', () => {
    const html = inlineQuestionToPlaceholder(sized);
    expect(html).toContain('style="width:720px;height:300px"');
    expect(extractInlineQuestions(html)).toEqual([sized]);
  });

  it('defaults to width:100% when width is omitted', () => {
    const html = inlineQuestionToPlaceholder({ query: 'SELECT 1', connection: 'duckdb', height: '300px' });
    expect(html).toContain('style="width:100%;height:300px"');
  });

  it('emits width in the <Question/> jsx (agent view)', () => {
    expect(inlineQuestionToJsx(sized)).toContain('width="720px"');
  });
});

describe('story-question — embed → QuestionContent projection (for rendering)', () => {
  it('maps connection→connection_name, viz→vizSettings, params→parameters; fills defaults', () => {
    const c = inlineEmbedToQuestionContent(embed);
    expect(c.query).toBe(embed.query);
    expect(c.connection_name).toBe('duckdb');
    expect(c.vizSettings.type).toBe('single_value');
    expect(c.parameters).toEqual(embed.parameters);
  });

  it('a bare inline question still yields a valid QuestionContent (table viz default)', () => {
    const c = inlineEmbedToQuestionContent({ query: 'SELECT 1', connection: '' });
    expect(c.vizSettings.type).toBe('table');
    expect(c.connection_name).toBe('');
    expect(c.parameters).toEqual([]);
  });
});
