/**
 * Pure helpers for HTML deck slides (no DOM dependency — node-testable).
 */

/** Extract unique question ids from `<div data-question-id="N">` chart embeds,
 *  in order of first appearance. */
export function extractQuestionIds(html: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const match of html.matchAll(/data-question-id=["'](\d+)["']/g)) {
    const id = parseInt(match[1], 10);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
