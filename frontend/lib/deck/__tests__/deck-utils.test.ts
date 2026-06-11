/**
 * Pure deck utilities — extractQuestionIds parses chart-embed placeholders
 * (<div data-question-id="N">) out of agent-authored slide HTML.
 */
import { extractQuestionIds } from '@/lib/deck/deck-utils';

describe('extractQuestionIds', () => {
  it('extracts multiple ids in document order', () => {
    const html =
      '<div data-question-id="5" style="width:600px"></div>' +
      '<p>hello</p>' +
      '<div data-question-id="12"></div>';
    expect(extractQuestionIds(html)).toEqual([5, 12]);
  });

  it('dedupes repeated ids', () => {
    const html =
      '<div data-question-id="7"></div><div data-question-id="7"></div>';
    expect(extractQuestionIds(html)).toEqual([7]);
  });

  it('handles single-quoted attributes', () => {
    expect(extractQuestionIds("<div data-question-id='42'></div>")).toEqual([42]);
  });

  it('returns empty array when there are no placeholders', () => {
    expect(extractQuestionIds('<h1>Title slide</h1>')).toEqual([]);
    expect(extractQuestionIds('')).toEqual([]);
  });
});
