/**
 * Slide title write-back — the rail's rename edit, applied to the <Slide> element by
 * AST path (same mechanism as every other story transform).
 */
import { describe, it, expect } from 'vitest';
import { updateSlideTitleInJsx } from '../story-slides';

const DECK = '<SlideDeck><Slide title="Old"><h2>A</h2></Slide><Slide><h2>B</h2></Slide></SlideDeck>';

describe('updateSlideTitleInJsx', () => {
  it('replaces an existing title at the path', () => {
    const out = updateSlideTitleInJsx(DECK, '0.0', 'New title');
    expect(out).toContain('title="New title"');
    expect(out).not.toContain('title="Old"');
    expect(out).toContain('<h2>B</h2>'); // rest of the doc untouched
  });

  it('adds a title to an untitled slide', () => {
    const out = updateSlideTitleInJsx(DECK, '0.1', 'Named');
    expect(out).toContain('<Slide title="Named">');
  });

  it('removes the attribute for an empty title (heading fallback takes over)', () => {
    const out = updateSlideTitleInJsx(DECK, '0.0', '   ');
    expect(out).not.toContain('title=');
  });

  it('returns the source unchanged when the path is not a Slide', () => {
    expect(updateSlideTitleInJsx(DECK, '0', 'X')).toBe(DECK);      // SlideDeck, not Slide
    expect(updateSlideTitleInJsx(DECK, '9.9', 'X')).toBe(DECK);    // no such node
  });
});
