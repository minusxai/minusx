import { describe, it, expect } from 'vitest';
import { extractInlineFileQueries } from '../file-queries';
import { inlineQuestionToPlaceholder } from '../story/story-question';
import { numberToPlaceholder } from '../story/story-number';

describe('extractInlineFileQueries — inline queries per file type', () => {
  it('question → its own (query, connection)', () => {
    expect(extractInlineFileQueries('question', { query: 'SELECT 1', connection_name: 'duck' }))
      .toEqual([{ query: 'SELECT 1', connection: 'duck' }]);
  });

  it('question with no query → empty', () => {
    expect(extractInlineFileQueries('question', { query: '', connection_name: 'duck' })).toEqual([]);
  });

  it('story → inline <Question> and inline <Number> embeds', () => {
    const html =
      inlineQuestionToPlaceholder({ query: 'SELECT a FROM t', connection: 'duck' }) +
      numberToPlaceholder({ query: 'SELECT SUM(x) AS m FROM t', connection: 'pg', col: 'm' });
    const out = extractInlineFileQueries('story', { story: html });
    expect(out).toEqual(expect.arrayContaining([
      { query: 'SELECT a FROM t', connection: 'duck' },
      { query: 'SELECT SUM(x) AS m FROM t', connection: 'pg' },
    ]));
    expect(out).toHaveLength(2);
  });

  it('story with no embeds → empty', () => {
    expect(extractInlineFileQueries('story', { story: '<p>just text</p>' })).toEqual([]);
  });

  it('notebook → each SQL cell, text cells ignored', () => {
    const content = {
      cells: [
        { type: 'sql', id: 'a', query: 'SELECT 1', connection_name: 'duck' },
        { type: 'text', id: 'b', markdown: '# hi' },
        { type: 'sql', id: 'c', query: 'SELECT 2', connection_name: 'pg' },
      ],
    };
    expect(extractInlineFileQueries('notebook', content)).toEqual([
      { query: 'SELECT 1', connection: 'duck' },
      { query: 'SELECT 2', connection: 'pg' },
    ]);
  });

  it('dashboard → empty (tiles are saved references, not inline)', () => {
    expect(extractInlineFileQueries('dashboard', { assets: [{ type: 'question', id: 5 }], layout: { columns: 12, items: [] } })).toEqual([]);
  });

  it('non-query types and null content → empty', () => {
    expect(extractInlineFileQueries('folder', { description: '' })).toEqual([]);
    expect(extractInlineFileQueries('question', null)).toEqual([]);
  });
});
