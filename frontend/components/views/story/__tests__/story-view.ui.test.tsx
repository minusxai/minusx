/**
 * StoryView — a single-page scrolling story: one agent-authored HTML
 * document on a fixed 1280px-wide canvas (any height), rendered into a
 * SHADOW ROOT on the story host. Scripts/handlers are stripped, but <style>
 * blocks, classes and web fonts are ALLOWED — the shadow tree scopes them
 * natively (no leakage either way), while CSS variables (color-mode tokens)
 * and document fonts still inherit, so embedded charts render correctly.
 * <div data-question-id="N"> placeholders hydrate into live charts via
 * portals into the shadow root. @import lines (web fonts) are hoisted to
 * document.head — font-faces don't load inside shadow trees.
 * Also hosts the JSON view (header eye/code toggle), like DashboardView —
 * read-only without a fileId, editable with one (full-content edits). All
 * element queries by aria-label per repo convention (the Monaco mock labels
 * the JsonEditor textarea "JSON editor").
 */
import React from 'react';
import { screen, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore, getOrCreateStore } from '@/store/store';
import { setFileEditMode } from '@/store/uiSlice';
import { addFile } from '@/store/filesSlice';
import type { StoryContent } from '@/lib/types';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ questionId }: { questionId: number }) =>
    React.createElement('div', { 'aria-label': `Embedded question ${questionId}` }),
}));

vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ question }: { question: { query: string; connection_name: string; vizSettings: { type: string } } }) =>
    React.createElement('div', { 'aria-label': `Inline question ${question.vizSettings.type}` }, question.query),
}));

vi.mock('@/components/views/story/InlineNumber', () => ({
  __esModule: true,
  default: ({ embed }: { embed: { id?: number; prefix?: string } }) =>
    React.createElement('span', { 'aria-label': `inline number ${embed.id ?? 'query'}` }, embed.prefix ?? ''),
}));

// StoryEmptyState (rendered when the story has no content) calls useConfigs() for the
// branding agentName. Mocked so its fire-and-forget /api/configs fetch never runs in jsdom.
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

import StoryView from '@/components/views/story/StoryView';

// Real-world Google Fonts @import — note the SEMICOLONS inside the URL
// (wght@0,700;0,900): the hoister must not cut the import short there, or the
// leftover URL garbage poisons the next CSS rule.
const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=Space+Mono:wght@400;700&display=swap');";

const STORY =
  `<style>${FONT_IMPORT}\n.hs{--ink:#e8dfc8;background:#06090e;color:var(--ink);}\n.hs h1{font-size:64px;color:#c8781a;}</style>` +
  '<div class="hs" style="padding:80px"><h1>The year demand went vertical</h1>' +
  '<p>Narrative paragraph.</p>' +
  '<div data-question-id="14" style="width:1100px;height:420px"></div></div>';

const content: StoryContent = {
  description: 'demo',
  story: STORY,
};

const emptyContent: StoryContent = { description: null, story: null };

// M4.2: headerEditMode/storyPath/storyName/colorMode are now sourced by the container
// (StoryContainerV2/SharePageClient) and passed down as props. These defaults match what a
// container would compute for a plain render with no fileId / no edit-mode dispatch.
const NOEDIT_PROPS = { headerEditMode: false, storyPath: undefined, storyName: undefined, colorMode: 'dark' as const };

/** The story renders inside a same-origin iframe (its contentDocument). */
function storyRoot(): HTMLElement {
  const iframe = screen.getByLabelText('Story document') as HTMLIFrameElement;
  return iframe.contentDocument!.body;
}

describe('StoryView', () => {
  it('shows the empty state when there is no story', () => {
    renderWithProviders(<StoryView content={emptyContent} {...NOEDIT_PROPS} />);
    expect(screen.getByLabelText('No story')).toBeInTheDocument();
  });

  it('renders the story HTML inside the story shadow root', async () => {
    renderWithProviders(<StoryView content={content} {...NOEDIT_PROPS} />);
    expect(screen.getByLabelText('Story page')).toBeInTheDocument();
    await waitFor(() => {
      expect(storyRoot().textContent).toContain('The year demand went vertical');
      expect(storyRoot().textContent).toContain('Narrative paragraph.');
    });
  });

  it('preserves agent <style> blocks inside the shadow root', async () => {
    renderWithProviders(<StoryView content={content} {...NOEDIT_PROPS} />);
    await waitFor(() => {
      const styles = Array.from(storyRoot().querySelectorAll('style'));
      expect(styles.some(s => s.textContent?.includes('.hs h1'))).toBe(true);
    });
  });

  it('keeps the @import (web fonts) intact inside the iframe story styles (loaded natively)', async () => {
    // Unlike a shadow root, an iframe document loads @import web-fonts natively, so the import stays
    // in place. The complete import — including the part after the in-URL semicolons — must survive
    // intact. (For CAPTURE, the import is separately resolved to real @font-face in the top
    // document.head — see resolve-story-fonts; that path is network-driven and unit-tested there.)
    renderWithProviders(<StoryView content={content} {...NOEDIT_PROPS} />);
    await waitFor(() => {
      const storyStyle = Array.from(storyRoot().querySelectorAll('style'))
        .find(s => s.textContent?.includes('.hs h1'));
      expect(storyStyle?.textContent).toContain(FONT_IMPORT);
      expect(storyStyle?.textContent).toContain('.hs{--ink:#e8dfc8;');
    });
  });

  it('hydrates chart placeholders with live embedded questions', async () => {
    renderWithProviders(<StoryView content={content} {...NOEDIT_PROPS} />);
    await waitFor(() => {
      expect(within(storyRoot() as unknown as HTMLElement).getByLabelText('Embedded question 14')).toBeTruthy();
    });
  });

  it('hydrates an INLINE <Question query=…> placeholder with a live embedded question', async () => {
    const inlineStory =
      '<div class="hs"><h2>Live KPI</h2>' +
      '<div data-question-inline="{&quot;query&quot;:&quot;SELECT SUM(mrr) AS mrr FROM metrics&quot;,&quot;connection_name&quot;:&quot;duckdb&quot;,&quot;vizSettings&quot;:{&quot;type&quot;:&quot;single_value&quot;}}" style="width:100%;height:200px"></div></div>';
    renderWithProviders(<StoryView content={{ description: null, story: inlineStory }} {...NOEDIT_PROPS} />);
    await waitFor(() => {
      const el = within(storyRoot() as unknown as HTMLElement).getByLabelText('Inline question single_value');
      expect(el.textContent).toContain('SELECT SUM(mrr) AS mrr FROM metrics');
    });
  });

  it('sizes an inline single_value embed COMPACT — honors a small height, no 340px chart floor', async () => {
    const story =
      '<div class="hs"><div data-question-inline="{&quot;query&quot;:&quot;SELECT 1&quot;,&quot;connection_name&quot;:&quot;duckdb&quot;,&quot;vizSettings&quot;:{&quot;type&quot;:&quot;single_value&quot;}}" style="width:100%;height:90px"></div></div>';
    renderWithProviders(<StoryView content={{ description: null, story }} {...NOEDIT_PROPS} />);
    await waitFor(() => {
      const div = storyRoot().querySelector('[data-question-inline]') as HTMLElement;
      expect(div?.style.height).toBe('90px'); // honored, NOT clamped up to 340px
    });
  });

  it('still applies the 340px chart floor to a NON-single_value inline embed', async () => {
    const story =
      '<div class="hs"><div data-question-inline="{&quot;query&quot;:&quot;SELECT 1&quot;,&quot;connection_name&quot;:&quot;duckdb&quot;,&quot;vizSettings&quot;:{&quot;type&quot;:&quot;table&quot;}}" style="width:100%;height:90px"></div></div>';
    renderWithProviders(<StoryView content={{ description: null, story }} {...NOEDIT_PROPS} />);
    await waitFor(() => {
      const div = storyRoot().querySelector('[data-question-inline]') as HTMLElement;
      expect(div?.style.height).toBe('340px'); // clamped up to the chart floor
    });
  });

  it('marks the story with data-file-id so FileView capture (Dev Tools "Download Image") finds it', async () => {
    // Regression: stories rendered without data-file-id, so useScreenshot.captureFileView threw
    // "FileView with id N not found" (questions/dashboards set it on their content region).
    renderWithProviders(<StoryView content={content} fileId={1029} {...NOEDIT_PROPS} />);
    await waitFor(() => {
      expect(document.querySelector('[data-file-id="1029"]')).toBeTruthy();
    });
  });

  it('hydrates a <Number> placeholder into an INLINE figure span (not a chart card)', async () => {
    const story = '<div class="hs"><p>Latest MRR is <span data-number-inline="{&quot;id&quot;:1026,&quot;prefix&quot;:&quot;$&quot;}"></span>.</p></div>';
    renderWithProviders(<StoryView content={{ description: null, story }} {...NOEDIT_PROPS} />);
    await waitFor(() => {
      const el = within(storyRoot() as unknown as HTMLElement).getByLabelText('inline number 1026');
      expect(el.tagName).toBe('SPAN'); // inline in the prose, not a block embed
    });
  });

  it('renders the new story when content changes (AgentHtml remounts on a content hash)', async () => {
    // The real bug this guards against — a portal "removeChild: not a child" crash when content.story
    // changes under mounted portals — only reproduces in a real browser (jsdom's react-dom tolerates
    // the portal-host removal). So this is a smoke check that a content change cleanly shows the new
    // story; the crash fix (keying AgentHtml on a content hash → REMOUNT instead of resetting
    // innerHTML under live portals) is verified in the browser.
    const { rerender } = renderWithProviders(<StoryView content={content} fileId={1} {...NOEDIT_PROPS} />);
    await waitFor(() => expect(storyRoot().textContent).toContain('The year demand went vertical'));
    const next: StoryContent = { ...content, story: STORY.replace('The year demand went vertical', 'A brand-new headline') };
    expect(() => rerender(<StoryView content={next} fileId={1} {...NOEDIT_PROPS} />)).not.toThrow();
    await waitFor(() => expect(storyRoot().textContent).toContain('A brand-new headline'));
  });

  it('renders agent content that arrives WHILE in edit mode (new draft opens in edit mode empty)', async () => {
    // Repro of the "agent-created story shows blank" bug: a NEW story draft opens in edit mode
    // with empty content, so StoryView freezes its render snapshot at edit-entry (empty). The agent
    // then streams content.story in via EditFile. The frozen edit-session snapshot must NOT swallow
    // that content — the story has to render, not stay blank until Save+refresh.
    const store = makeStore();
    store.dispatch(setFileEditMode({ fileId: 7, editMode: true }));
    const { rerender } = renderWithProviders(<StoryView content={emptyContent} fileId={7} headerEditMode storyPath={undefined} storyName={undefined} colorMode="dark" />, { store });
    // Fresh empty draft in edit mode → empty state (no story yet).
    expect(screen.getByLabelText('No story')).toBeInTheDocument();
    // Agent's EditFile lands: content.story is now populated (still in edit mode).
    rerender(<StoryView content={content} fileId={7} headerEditMode storyPath={undefined} storyName={undefined} colorMode="dark" />);
    await waitFor(() => {
      expect(storyRoot().textContent).toContain('The year demand went vertical');
      expect(storyRoot().textContent).toContain('Narrative paragraph.');
    });
  });

  it('a programmatic focusout with NO user input never echo-overwrites the story (agent-edit wipe)', async () => {
    // The live wipe: in edit mode the iframe streams inline edits out via input/focusout. Embedded
    // React controls mounting/unmounting inside the iframe fire focusout PROGRAMMATICALLY — with no
    // user edit — and the resulting serialize-echo, taken mid-hydration (embeds half-mounted, DOM
    // partial), REPLACED the agent's freshly staged content wholesale via applyStoryHtmlEdit →
    // setFullContent (the "story goes blank after EditFile" bug). An echo must only ever follow a
    // REAL user input event. applyStoryHtmlEdit dispatches to the GLOBAL store, so use it here.
    const store = getOrCreateStore();
    store.dispatch(addFile({
      id: 7, name: '', path: '/org/x1y2z3', type: 'story',
      content: { description: 'demo', story: STORY }, references: [], draft: true,
      version: 1, last_edit_id: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    } as never));
    store.dispatch(setFileEditMode({ fileId: 7, editMode: true }));
    renderWithProviders(<StoryView content={content} fileId={7} headerEditMode storyPath="/org/x1y2z3" storyName="" colorMode="dark" />, { store });
    await waitFor(() => expect(storyRoot().textContent).toContain('The year demand went vertical'));

    // Simulate the mid-hydration moment: the DOM is partial (headline gone) when focusout fires.
    storyRoot().querySelector('h1')!.remove();
    storyRoot().dispatchEvent(new Event('focusout', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getState().files.files[7]?.persistableChanges ?? {}).toEqual({});
  });

  it('a REAL user edit still syncs out (input → focusout flush stages the edited story)', async () => {
    const store = getOrCreateStore();
    store.dispatch(addFile({
      id: 8, name: '', path: '/org/x1y2z4', type: 'story',
      content: { description: 'demo', story: STORY }, references: [], draft: true,
      version: 1, last_edit_id: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    } as never));
    store.dispatch(setFileEditMode({ fileId: 8, editMode: true }));
    renderWithProviders(<StoryView content={content} fileId={8} headerEditMode storyPath="/org/x1y2z4" storyName="" colorMode="dark" />, { store });
    await waitFor(() => expect(storyRoot().textContent).toContain('The year demand went vertical'));

    const h1 = storyRoot().querySelector('h1')!;
    h1.textContent = 'User edited headline';
    storyRoot().dispatchEvent(new Event('input', { bubbles: true }));
    storyRoot().dispatchEvent(new Event('focusout', { bubbles: true }));
    await waitFor(() => {
      const staged = store.getState().files.files[8]?.persistableChanges as { story?: string } | undefined;
      expect(staged?.story).toContain('User edited headline');
    });
  });

  it('fluid shim caps INLINE embeds too (data-question-inline / data-number-inline), not just saved embeds', async () => {
    // Regression: the fluid shim only capped [data-question-id], so an inline chart embed authored
    // wider than the viewport (e.g. width:1100px) overflowed the canvas and got cut off (measured live).
    renderWithProviders(<StoryView content={content} {...NOEDIT_PROPS} />);
    await waitFor(() => {
      const shim = storyRoot().querySelector('[data-mx-fluid-shim]');
      expect(shim).toBeTruthy();
      const css = shim!.textContent || '';
      expect(css).toContain('[data-question-inline]'); // inline charts now capped like saved ones
      expect(css).toContain('[data-number-inline]');    // inline numbers clamped in prose
      expect(css).toContain('overflow-x:hidden');        // page can't be forced into horizontal cutoff
    });
  });

  it('sanitizes hostile HTML', async () => {
    renderWithProviders(
      <StoryView content={{ ...emptyContent, story: '<script>window.__pwned = true;</script><div onclick="alert(1)">Safe</div>' }} {...NOEDIT_PROPS} />
    );
    await waitFor(() => {
      expect(storyRoot().textContent).toContain('Safe');
    });
    expect(storyRoot().querySelector('script')).toBeNull();
    expect(storyRoot().querySelector('[onclick]')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  // colorMode (M4.2): sourced by the container (StoryContainerV2/SharePageClient) and threaded
  // as a prop through StoryView -> AgentHtml, which toggles a dark/light class on the iframe's
  // own contentDocument (colorMode-token CSS keys off html.dark/html.light).
  describe('colorMode', () => {
    it('applies the dark class to the iframe document when colorMode is dark', async () => {
      renderWithProviders(<StoryView content={content} {...NOEDIT_PROPS} colorMode="dark" />);
      await waitFor(() => {
        const iframe = screen.getByLabelText('Story document') as HTMLIFrameElement;
        expect(iframe.contentDocument!.documentElement.classList.contains('dark')).toBe(true);
        expect(iframe.contentDocument!.documentElement.classList.contains('light')).toBe(false);
      });
    });

    it('applies the light class to the iframe document when colorMode is light', async () => {
      renderWithProviders(<StoryView content={content} {...NOEDIT_PROPS} colorMode="light" />);
      await waitFor(() => {
        const iframe = screen.getByLabelText('Story document') as HTMLIFrameElement;
        expect(iframe.contentDocument!.documentElement.classList.contains('light')).toBe(true);
        expect(iframe.contentDocument!.documentElement.classList.contains('dark')).toBe(false);
      });
    });
  });

  // The JSON/XML "Code view" moved out of StoryView into the shared CodeView
  // (rendered centrally by FileView) — see components/views/__tests__/code-view.ui.test.tsx.
  it('renders the story visual canvas (never a code editor)', () => {
    renderWithProviders(<StoryView content={content} {...NOEDIT_PROPS} />);
    expect(screen.getByLabelText('Story page')).toBeInTheDocument();
    expect(screen.queryByLabelText('JSON editor')).not.toBeInTheDocument();
  });
});
