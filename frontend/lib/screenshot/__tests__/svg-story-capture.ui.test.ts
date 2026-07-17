/**
 * The SVG story capture path must be STORY-ONLY. Stories drop snapdom entirely; dashboards/questions/
 * notebooks/reports keep it, because their styles live in the PARENT document's stylesheets and would
 * serialize unstyled. `findStorySvg` is the gate that decides — so its contract is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { findStorySvg } from '@/lib/story-surface/serialize';
import { mountStorySurface, STORY_SVG_ATTR } from '@/lib/story-surface';

/** Build a host element containing an iframe whose document hosts the given surface kind. */
function hostWithSurface(kind: 'dom' | 'svg'): HTMLElement {
  const host = document.createElement('div');
  const iframe = document.createElement('iframe');
  host.appendChild(iframe);
  document.body.appendChild(host);
  const doc = iframe.contentDocument!;
  mountStorySurface(doc, kind, 1280);
  return host;
}

describe('findStorySvg — the story-only gate', () => {
  it('finds the live story svg inside an SVG-rendered story', () => {
    const host = hostWithSurface('svg');
    const svg = findStorySvg(host);
    expect(svg).not.toBeNull();
    expect(svg!.hasAttribute(STORY_SVG_ATTR)).toBe(true);
  });

  it('returns null for a DOM-rendered story → capture falls back to snapdom', () => {
    expect(findStorySvg(hostWithSurface('dom'))).toBeNull();
  });

  it('returns null for a non-story element (dashboard/question) → snapdom', () => {
    const el = document.createElement('div');
    el.innerHTML = '<div class="dashboard"><svg><rect /></svg></div>';
    document.body.appendChild(el);
    // A plain chart <svg> must NOT be mistaken for a story surface.
    expect(findStorySvg(el)).toBeNull();
  });

  it('accepts the iframe element itself as the host', () => {
    const host = hostWithSurface('svg');
    const iframe = host.querySelector('iframe') as HTMLElement;
    expect(findStorySvg(iframe)).not.toBeNull();
  });
});
