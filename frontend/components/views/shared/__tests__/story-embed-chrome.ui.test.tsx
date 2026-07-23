/**
 * Story embed wrapper chrome — SELF-CONTAINED styling contract (staging regression, Jul 2026).
 *
 * The story iframe's only style sources are the compiled story CSS + the @font-face mirror —
 * Chakra/emotion rules live in the TOP document and never reach it (the Renderer_v2 §6a mirror
 * shrink). The embed WRAPPERS in StoryJsxBody/StoryEmbeds were still Chakra `Box`es, so their
 * height/bg/border resolved to NOTHING inside the iframe: every chart collapsed to a shallow
 * strip no matter what `height` the agent wrote, clipping content ("the renderer is still
 * forcing every story chart into a shallow strip despite the explicit 430px height").
 *
 * The contract these tests pin down:
 *  - SIZING is inline style (width/height on the element) — works in ANY document, no CSS needed.
 *  - CARD CHROME is Tailwind token classes (bg-card / border-border / rounded-md) — compiled
 *    into every story's CSS because these files are in EMBED_CHROME_FILES (see the node-side
 *    coverage test in lib/story-ui/__tests__/embed-chrome-coverage.test.ts).
 *  - NO emotion classes (`css-*`) on the wrappers — that channel is structurally dead in the iframe.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', async () => {
  const React = await import('react');
  return {
    __esModule: true,
    default: ({ questionId }: { questionId: number }) =>
      React.createElement('div', { 'aria-label': `Embedded question ${questionId}` }),
  };
});
vi.mock('@/components/containers/EmbeddedQuestionContainer', async () => {
  const React = await import('react');
  return {
    __esModule: true,
    default: () => React.createElement('div', { 'aria-label': 'Embedded question body' }),
  };
});
vi.mock('@/components/views/story/InlineNumber', async () => {
  const React = await import('react');
  return { __esModule: true, default: () => React.createElement('span', { 'aria-label': 'Inline number' }) };
});
vi.mock('@/components/views/story/StoryParamControl', async () => {
  const React = await import('react');
  return { __esModule: true, default: () => React.createElement('div', { 'aria-label': 'Story param control' }) };
});

import StoryJsxBody from '../StoryJsxBody';
import StoryEmbeds from '../StoryEmbeds';

const CARD_CLASSES = ['bg-card', 'border-border', 'rounded-md'];

function renderJsx(jsx: string) {
  return render(
    <StoryJsxBody doc={document} jsx={jsx} readOnly={true} colorMode="light" />,
  );
}

/** The wrapper around a mounted embed, located per the aria-label-only convention. */
function wrapperOf(label: string): HTMLElement {
  return screen.getByLabelText(label).parentElement as HTMLElement;
}

describe('StoryJsxBody <Question> wrapper — self-contained sizing + chrome', () => {
  it('applies an explicit height as an INLINE style (env-independent), with card token classes', () => {
    renderJsx('<Question id={42} height="500px" />');
    const wrap = screen.getByLabelText('Question embed');
    expect(wrap.style.height).toBe('500px');
    expect(wrap.style.width).toBe('100%');
    for (const c of CARD_CLASSES) expect(wrap.className).toContain(c);
    expect(wrap.className).not.toMatch(/\bcss-/);
    expect(wrapperOf('Embedded question 42')).toBe(wrap);
  });

  it('defaults a missing height to 430px (the documented skill contract)', () => {
    renderJsx('<Question id={42} />');
    expect(screen.getByLabelText('Question embed').style.height).toBe('430px');
  });

  it('clamps a below-minimum height UP to 340px', () => {
    renderJsx('<Question id={42} height="100px" />');
    expect(screen.getByLabelText('Question embed').style.height).toBe('340px');
  });

  it('inline single_value embeds stay bare (no card chrome) at their own default height', () => {
    renderJsx('<Question query={`select 1`} connection="duck" viz={{"type":"single_value","channels":{}}} />');
    const wrap = screen.getByLabelText('Question embed');
    expect(wrap.style.height).toBe('120px');
    for (const c of CARD_CLASSES) expect(wrap.className).not.toContain(c);
    expect(wrap.className).toContain('relative');
    expect(wrap.className).not.toMatch(/\bcss-/);
  });

  it('inline chart embeds get the card chrome AND inline sizing', () => {
    renderJsx('<Question query={`select 1`} connection="duck" height="380px" />');
    const wrap = screen.getByLabelText('Question embed');
    expect(wrap.style.height).toBe('380px');
    for (const c of CARD_CLASSES) expect(wrap.className).toContain(c);
  });
});

describe('StoryEmbeds legacy portal wrappers — token-class chrome (size rides the placeholder)', () => {
  it('saved-question cards carry mx-chart-fill + card token classes, no emotion classes, no own height', () => {
    const el = document.createElement('div');
    el.style.cssText = 'width:100%;height:430px';
    document.body.appendChild(el);
    render(
      <StoryEmbeds
        doc={document}
        targets={[{ el, questionId: 42 }]}
        inlineTargets={[]}
        numberTargets={[]}
        paramTargets={[]}
        readOnly={true}
        editable={false}
        colorMode="light"
      />,
    );
    const wrap = screen.getByLabelText('Question embed');
    expect(wrap.parentElement).toBe(el);
    expect(wrap.className).toContain('mx-chart-fill');
    for (const c of CARD_CLASSES) expect(wrap.className).toContain(c);
    expect(wrap.className).not.toMatch(/\bcss-/);
    expect(wrap.style.height).toBe(''); // the placeholder's inline height governs
    el.remove();
  });
});
