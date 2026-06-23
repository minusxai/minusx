// QuestionV2 ⇄ jsx adapter: a QuestionV2 file stores its query/connection/viz as a
// static-JSX `<Question connection=... viz={...}>{`SQL`}</Question>` string. The SQL
// lives in a template-literal child so `<`, `>`, `{` stay raw (the whole point).
import { describe, it, expect } from 'vitest';
import { parseQuestionJsx, buildQuestionJsx } from '../question-v2';
import { validateJsxSource } from '@/lib/jsx';
import type { VizSettings } from '@/lib/types';

describe('parseQuestionJsx', () => {
  it('extracts query (template-literal child), connection, and viz', () => {
    const jsx = '<Question connection="github" viz={{"type":"bar","xCols":["a"]}}>{`SELECT * FROM t WHERE a < 5`}</Question>';
    const r = parseQuestionJsx(jsx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.query).toBe('SELECT * FROM t WHERE a < 5');
      expect(r.value.connection_name).toBe('github');
      expect(r.value.vizSettings).toEqual({ type: 'bar', xCols: ['a'] });
    }
  });

  it('falls back to plain text children when there is no template literal', () => {
    const r = parseQuestionJsx('<Question connection="db">SELECT 1</Question>');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.query).toBe('SELECT 1');
      expect(r.value.connection_name).toBe('db');
      expect(r.value.vizSettings).toBeUndefined();
    }
  });

  it('errors when there is no <Question> element', () => {
    expect(parseQuestionJsx('<div>nope</div>').ok).toBe(false);
    expect(parseQuestionJsx('<Question oops=>').ok).toBe(false); // syntax error
  });
});

describe('buildQuestionJsx', () => {
  it('round-trips query (with < and newlines) + connection + viz', () => {
    const viz: VizSettings = { type: 'line', xCols: ['day'], yCols: ['count'] };
    const query = 'SELECT day, count(*)\nFROM events\nWHERE stars < 100\nGROUP BY 1';
    const jsx = buildQuestionJsx({ query, connection_name: 'github', vizSettings: viz });
    const r = parseQuestionJsx(jsx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.query).toBe(query);
      expect(r.value.connection_name).toBe('github');
      expect(r.value.vizSettings).toEqual(viz);
    }
  });

  it('escapes backticks and ${ in the SQL so the template literal stays valid', () => {
    const query = 'SELECT `weird_col`, concat("a", "${x}") FROM t';
    const jsx = buildQuestionJsx({ query, connection_name: 'db' });
    const r = parseQuestionJsx(jsx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.query).toBe(query);
  });

  it('produces jsx that passes engine validation (Question registered)', () => {
    const jsx = buildQuestionJsx({ query: 'SELECT 1 WHERE a < 2', connection_name: 'db', vizSettings: { type: 'table' } });
    expect(validateJsxSource(jsx, ['Question'])).toEqual([]);
  });
});
