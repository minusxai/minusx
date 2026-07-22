/**
 * Story_Design_V2 §5 — `data-theme` stamping on the story root.
 *
 * The story's `content.theme` is threaded to AgentHtml (like colorMode) and stamped as a
 * `data-theme` attribute on the surface root, so the compiledCss's `[data-theme]` variable
 * blocks activate. Switching theme is an ATTRIBUTE CHANGE ONLY — same root element, no iframe
 * document rebuild, no recompile. The platform font CSS follows the theme.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/components/views/story/InlineNumber', async () => {
  const React = await import('react');
  const Fake = () => React.createElement('span', { 'aria-label': 'Inline number' }, '42');
  return { __esModule: true, default: Fake };
});

import AgentHtml from '../AgentHtml';
import { STORY_SVG_ATTR, STORY_ROOT_ATTR } from '@/lib/story-surface';

const JSX_STORY = '<p aria-label="para">Hello theme</p>';

const iframeDoc = () =>
  (screen.getByLabelText('Story document') as HTMLIFrameElement).contentDocument!;
const surfaceRoot = (doc: Document) =>
  doc.querySelector(`svg[${STORY_SVG_ATTR}] [${STORY_ROOT_ATTR}]`) as HTMLElement | null;

describe('data-theme stamping on the story root', () => {
  it('stamps content.theme as data-theme and swaps it WITHOUT rebuilding the document', async () => {
    const { rerender } = render(
      <AgentHtml html={JSX_STORY} format="jsx" width={800} colorMode="light" theme="nocturne" />,
    );
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());
    const root = surfaceRoot(doc)!;
    expect(root.getAttribute('data-theme')).toBe('nocturne');

    rerender(
      <AgentHtml html={JSX_STORY} format="jsx" width={800} colorMode="light" theme="organic" />,
    );
    await waitFor(() => expect(surfaceRoot(iframeDoc())!.getAttribute('data-theme')).toBe('organic'));
    // Attribute change only: the SAME root element (no doc rebuild, no remount).
    expect(surfaceRoot(iframeDoc())).toBe(root);

    rerender(<AgentHtml html={JSX_STORY} format="jsx" width={800} colorMode="light" theme={null} />);
    await waitFor(() => expect(surfaceRoot(iframeDoc())!.hasAttribute('data-theme')).toBe(false));
  });

  it('loads the THEME\'s platform font set (getStoryFontCss(theme)) in the data-mx-fonts node', async () => {
    render(
      <AgentHtml html={JSX_STORY} format="jsx" width={800} colorMode="light" theme="classical" />,
    );
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());
    const fonts = surfaceRoot(doc)!.querySelector('style[data-mx-fonts]');
    expect(fonts?.textContent).toContain('"Noto Serif"');
    // Classical is serif-only — the neutral fallback set (which carries Inter) would be wrong.
    expect(fonts?.textContent).not.toContain('"Inter"');
  });
});
