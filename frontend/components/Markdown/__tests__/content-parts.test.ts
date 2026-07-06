// Report/markdown body parsing: chart embeds (legacy <div data-question-id> AND new
// <Question id={N}/>), {{query:id}} refs, suggested questions, trust blocks.
import { describe, it, expect } from 'vitest';
import { parseContentParts } from '../content-parts';

describe('parseContentParts — chart embeds', () => {
  it('parses the new <Question id={N}/> syntax as a question embed', () => {
    const parts = parseContentParts('Intro paragraph.\n<Question id={142} />\nOutro.');
    expect(parts).toContainEqual({ type: 'question_embed', questionId: 142 });
    // surrounding prose preserved as text parts
    expect(parts.some(p => p.type === 'text' && p.content.includes('Intro'))).toBe(true);
  });

  it('tolerates id="N" (string) and extra attributes like height', () => {
    expect(parseContentParts('<Question id="9" height="400px" />')).toContainEqual({ type: 'question_embed', questionId: 9 });
    expect(parseContentParts('<Question id={7}/>')).toContainEqual({ type: 'question_embed', questionId: 7 });
  });

  it('still parses the legacy <div data-question-id> embed (back-compat for old reports)', () => {
    expect(parseContentParts('<div data-question-id="3"></div>')).toContainEqual({ type: 'question_embed', questionId: 3 });
  });

  it('parses multiple <Question> embeds in order', () => {
    const ids = parseContentParts('<Question id={1}/>\ntext\n<Question id={2}/>')
      .filter(p => p.type === 'question_embed')
      .map(p => (p as { questionId: number }).questionId);
    expect(ids).toEqual([1, 2]);
  });

  it('leaves a {{query:id}} ref and suggested questions handling intact', () => {
    expect(parseContentParts('see {{query:abc}}')).toContainEqual({ type: 'query', content: 'abc' });
  });
});
