import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlideDeck, Slide } from '@/components/kit/slides';

// The deck is pure stacked flow — slides render in source order, each a full-viewport
// section. The data-mx-slide stamps are the render-side contract the parent document's
// slide navigation (birds-eye rail, present controls) discovers slides through; they are
// render artifacts, stripped from any WYSIWYG write-back by the data-mx-* prefix rule.
function renderDeck() {
  return render(
    <SlideDeck aria-label="deck">
      <Slide title="Cover" aria-label="slide-1">
        <h1>Retention pays for the price increase</h1>
      </Slide>
      <Slide aria-label="slide-2" className="justify-center">
        <h2>Act one</h2>
      </Slide>
    </SlideDeck>,
  );
}

describe('kit SlideDeck / Slide', () => {
  it('stamps every slide with data-mx-slide, in source order', () => {
    renderDeck();
    const deck = screen.getByLabelText('deck');
    const slides = deck.querySelectorAll('[data-mx-slide]');
    expect(slides.length).toBe(2);
    expect(slides[0]).toBe(screen.getByLabelText('slide-1'));
    expect(slides[1]).toBe(screen.getByLabelText('slide-2'));
  });

  it('carries the authored title as data-mx-slide-title; absent when untitled', () => {
    renderDeck();
    expect(screen.getByLabelText('slide-1').getAttribute('data-mx-slide-title')).toBe('Cover');
    expect(screen.getByLabelText('slide-2').hasAttribute('data-mx-slide-title')).toBe(false);
  });

  it('fills the real viewport height via --mx-vh with the headless fallback', () => {
    renderDeck();
    expect(screen.getByLabelText('slide-1').className).toContain('min-h-[var(--mx-vh,760px)]');
  });

  it('merges authored className after the defaults', () => {
    renderDeck();
    expect(screen.getByLabelText('slide-2').className).toContain('justify-center');
  });

  it('deck provides the container-query context slides respond to', () => {
    renderDeck();
    expect(screen.getByLabelText('deck').className).toContain('@container');
  });
});
