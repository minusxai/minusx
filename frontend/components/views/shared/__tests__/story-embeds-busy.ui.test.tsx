/**
 * Screenshot readiness ↔ story embeds handshake. AgentHtml stamps `data-mx-busy="true"` on every
 * embed placeholder when it empties them at discovery (they'd otherwise read as calm blank boxes
 * and the post-edit screenshot would capture a half-hydrated story — the judge then "sees" blank
 * panels). StoryEmbeds must clear that stamp once the embeds actually mount, at which point a
 * still-loading embed carries its OWN busy marker (query spinner / InlineNumber).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StoryEmbeds from '../StoryEmbeds';
import type { StoryParam } from '@/lib/data/story/story-params';

const city: StoryParam = { name: 'city', type: 'text', nullable: true };

function placeholder(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.setAttribute('data-mx-busy', 'true'); // as stamped by AgentHtml's discovery
  document.body.appendChild(el);
  return el;
}

describe('StoryEmbeds — placeholder busy stamps', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('clears the discovery busy stamp on every placeholder once the embeds mount', async () => {
    const paramEl = placeholder({ 'data-param-name': 'city' });
    renderWithProviders(
      <StoryEmbeds
        doc={document}
        targets={[]}
        inlineTargets={[]}
        numberTargets={[]}
        paramTargets={[{ el: paramEl, param: city }]}
        readOnly
        editable={false}
      />,
    );
    await waitFor(() => expect(paramEl.getAttribute('data-mx-busy')).toBeNull());
    // the mounted control is inside the placeholder — it was cleared AFTER content committed
    expect(paramEl.childElementCount).toBeGreaterThan(0);
  });
});
