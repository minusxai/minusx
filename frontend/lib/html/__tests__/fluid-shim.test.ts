/**
 * Fluid (mobile) shim CSS — the responsive cap AgentHtml injects into a story iframe so authored
 * layouts never force horizontal scroll on a phone.
 *
 * The contract that matters for widget RESIZE: the shim must CAP an embed's width to the viewport
 * (`max-width:100%`) but must NOT force `width:100%` on chart embeds — forcing it overrides an
 * authored/resized inline px width (proven live: `width:640px` rendered at 1104px because
 * `width:100%!important` won). Capping without forcing lets a resized px width be honored while
 * still never overflowing the viewport.
 */
import { describe, it, expect } from 'vitest';
import { buildFluidShimCss } from '../fluid-shim';

describe('buildFluidShimCss', () => {
  const css = buildFluidShimCss();

  it('caps chart embeds to the viewport (max-width) without forcing their width', () => {
    // The embed rule must cap max-width…
    expect(css).toMatch(/\[data-question-id\][^{]*,[^{]*\[data-question-inline\]\s*\{[^}]*max-width:\s*100%/);
    // …but must NOT force width:100% on those embeds (that override is what breaks px resize).
    const embedRule = css.match(/\[data-question-id\][^{]*\{[^}]*\}/)?.[0] ?? '';
    expect(embedRule).not.toMatch(/[^-]width:\s*100%/);
  });

  it('still prevents the document from forcing horizontal scroll', () => {
    expect(css).toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*hidden/);
    expect(css).toMatch(/max-width:\s*100%/);
  });

  it('still clamps inline numbers and media widths', () => {
    expect(css).toMatch(/\[data-number-inline\]\s*\{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/img,\s*svg,\s*video,\s*table,\s*pre\s*\{[^}]*max-width:\s*100%/);
  });
});
