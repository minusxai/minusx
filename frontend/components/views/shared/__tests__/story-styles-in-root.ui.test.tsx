/**
 * Story_Design_V2 §4 — self-contained story document on the (now default) svg surface:
 *
 *  1. The svg surface is the DEFAULT: AgentHtml mounts the story body inside <svg><foreignObject>
 *     with no explicit `surface` prop (there is no user-facing renderer setting anymore).
 *  2. Injected styles live INSIDE the story root as data-mx-*-tagged <style> nodes — compiledCss
 *     (data-mx-tw), the mirrored app styles (data-mx-app-styles), the jsx floating css
 *     (data-mx-floating), and the platform font css (data-mx-fonts) — NOT in the iframe <head>,
 *     so the serialized <svg> carries them without head-cloning.
 *  3. Byte-identity: rendering a story and saving it back leaves `content.story` unchanged
 *     byte-for-byte (every save path drops the injected data-mx-* nodes). Covered for the legacy
 *     serializer path AND the jsx AST path.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/components/views/story/InlineNumber', async () => {
  const React = await import('react');
  const Fake = () => React.createElement('span', { 'aria-label': 'Inline number' }, '42');
  return { __esModule: true, default: Fake };
});

import AgentHtml, { type AgentHtmlHandle } from '../AgentHtml';
import { STORY_SVG_ATTR, STORY_ROOT_ATTR } from '@/lib/story-surface';

const iframeDoc = () =>
  (screen.getByLabelText('Story document') as HTMLIFrameElement).contentDocument!;

const LEGACY_STORY = '<style>.s{color:blue}</style><h1>Hello</h1><p class="s">World</p>';
const JSX_STORY = '<Card aria-label="chrome"><CardTitle aria-label="title">Title</CardTitle></Card><p aria-label="para">Hello world</p>';

/** The story surface root — the element the serialized <svg> subtree carries. */
const surfaceRoot = (doc: Document) =>
  doc.querySelector(`svg[${STORY_SVG_ATTR}] [${STORY_ROOT_ATTR}]`) as HTMLElement | null;

describe('svg surface is the DEFAULT story surface (no renderer setting)', () => {
  it('mounts the story inside <svg><foreignObject> without an explicit surface prop', async () => {
    render(<AgentHtml html={LEGACY_STORY} width={800} colorMode="light" />);
    const doc = iframeDoc();
    await waitFor(() => expect(doc.querySelector(`svg[${STORY_SVG_ATTR}]`)).toBeTruthy());
    expect(surfaceRoot(doc)).toBeTruthy();
    // The story body renders inside the surface root, not directly on the body.
    expect(surfaceRoot(doc)!.textContent).toContain('Hello');
  });
});

describe('injected styles live INSIDE the story root (self-contained serialized SVG)', () => {
  it('compiledCss + app-styles mirror land in-root as data-mx-* nodes, not in <head>', async () => {
    render(<AgentHtml html={LEGACY_STORY} compiledCss=".tw{display:flex}" fluid width={800} colorMode="light" />);
    const doc = iframeDoc();
    await waitFor(() => expect(surfaceRoot(doc)).toBeTruthy());
    const root = surfaceRoot(doc)!;
    expect(root.querySelector('style[data-mx-tw]')?.textContent).toBe('.tw{display:flex}');
    expect(root.querySelector('style[data-mx-app-styles]')).toBeTruthy();
    expect(doc.head.querySelector('style[data-mx-tw]')).toBeNull();
    expect(doc.head.querySelector('style[data-mx-app-styles]')).toBeNull();
  });

  it('jsx stories additionally carry the floating css and platform font css in-root', async () => {
    render(<AgentHtml html={JSX_STORY} format="jsx" compiledCss=".tw{display:flex}" width={800} colorMode="light" />);
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());
    const root = surfaceRoot(doc)!;
    expect(root.querySelector('style[data-mx-floating]')).toBeTruthy();
    expect(doc.head.querySelector('style[data-mx-floating]')).toBeNull();
    // Platform-provided fonts (neutral default): @font-face rules pointing at URL-loaded assets.
    const fonts = root.querySelector('style[data-mx-fonts]');
    expect(fonts?.textContent).toContain('@font-face');
    expect(fonts?.textContent).not.toContain('data:'); // live form is URL-loaded, never data-URI
  });
});

describe('byte-identity: render → save → content.story unchanged', () => {
  it('legacy story: serialize() returns the exact input bytes despite in-root injected styles', async () => {
    const ref = createRef<AgentHtmlHandle>();
    render(
      <AgentHtml ref={ref} html={LEGACY_STORY} editable compiledCss=".tw{display:flex}" fluid width={800} colorMode="light" />,
    );
    const doc = iframeDoc();
    await waitFor(() => expect(surfaceRoot(doc)?.textContent).toContain('Hello'));
    expect(ref.current!.serialize()).toBe(LEGACY_STORY);
  });

  it('jsx story: serialize() reports no change (null) when nothing was edited', async () => {
    const ref = createRef<AgentHtmlHandle>();
    render(<AgentHtml ref={ref} html={JSX_STORY} format="jsx" editable width={800} colorMode="light" />);
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());
    expect(ref.current!.serialize()).toBeNull();
  });
});
