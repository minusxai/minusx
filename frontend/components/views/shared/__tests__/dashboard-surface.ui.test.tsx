/**
 * DashboardSurface (Renderer_v2 Phase 8b — self-contained dashboards): the dashboard renders in
 * a same-origin IFRAME whose document carries everything it needs (chrome css, fonts mirror) —
 * live render and capture read the same style universe by construction.
 *
 * Contracts under test:
 *  - children render INSIDE the iframe's svg surface root (nested React root, story machinery);
 *  - the svg carries STORY_SVG_ATTR, so the story capture path picks dashboards up unchanged;
 *  - the chrome stylesheet is injected IN-ROOT (travels with a serialized capture);
 *  - color mode stamps html.dark/.light and re-syncs WITHOUT rebuilding the document;
 *  - the surface root is busy-stamped until the nested root commits (readiness gate contract).
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { within } from '@testing-library/dom';
import DashboardSurface from '../DashboardSurface';
import { STORY_SVG_ATTR, STORY_ROOT_ATTR } from '@/lib/story-surface';

function getSurfaceParts(container: HTMLElement) {
  const iframe = container.querySelector('iframe') as HTMLIFrameElement | null;
  const doc = iframe?.contentDocument ?? null;
  const svg = doc?.querySelector(`svg[${STORY_SVG_ATTR}]`) ?? null;
  const root = doc?.querySelector(`[${STORY_ROOT_ATTR}]`) as HTMLElement | null;
  return { iframe, doc, svg, root };
}

describe('DashboardSurface', () => {
  it('renders children inside the iframe svg surface (nested root)', async () => {
    const { container } = render(
      <DashboardSurface colorMode="light">
        <div aria-label="Surface payload">payload</div>
      </DashboardSurface>,
    );
    const { svg, root } = getSurfaceParts(container);
    expect(svg).not.toBeNull();
    expect(root).not.toBeNull();
    await waitFor(() => {
      expect(within(root!).getByLabelText('Surface payload')).toBeTruthy();
    });
  });

  it('injects the chrome stylesheet in-root so captures carry it', async () => {
    const { container } = render(
      <DashboardSurface colorMode="light">
        <div aria-label="Surface payload">payload</div>
      </DashboardSurface>,
    );
    const { root } = getSurfaceParts(container);
    const tw = root!.querySelector('style[data-mx-tw]');
    expect(tw).not.toBeNull();
    expect(tw!.textContent).toContain('.react-grid-item');
    // The app-styles mirror tag exists in-root too (fonts residue; filled by mirrorAppStyles).
    expect(root!.querySelector('style[data-mx-app-styles]')).not.toBeNull();
  });

  it('stamps html color-mode classes and re-syncs without rebuilding the document', async () => {
    const { container, rerender } = render(
      <DashboardSurface colorMode="dark">
        <div aria-label="Surface payload">payload</div>
      </DashboardSurface>,
    );
    const { doc } = getSurfaceParts(container);
    expect(doc!.documentElement.classList.contains('dark')).toBe(true);
    const docIdentity = doc!.body;
    rerender(
      <DashboardSurface colorMode="light">
        <div aria-label="Surface payload">payload</div>
      </DashboardSurface>,
    );
    await waitFor(() => {
      expect(doc!.documentElement.classList.contains('light')).toBe(true);
      expect(doc!.documentElement.classList.contains('dark')).toBe(false);
    });
    // Same body node — mode switch must not doc.open() a fresh document.
    expect(doc!.body).toBe(docIdentity);
  });

  it('clears the busy stamp only after the nested root commits (readiness contract)', async () => {
    const { container } = render(
      <DashboardSurface colorMode="light">
        <div aria-label="Surface payload">payload</div>
      </DashboardSurface>,
    );
    const { root } = getSurfaceParts(container);
    // After the nested root's first commit the stamp must be gone.
    await waitFor(() => {
      expect(root!.getAttribute('data-mx-busy')).toBeNull();
    });
  });
});
