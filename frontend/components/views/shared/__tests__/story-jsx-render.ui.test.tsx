/**
 * JSX story render path (Story_Design_V2 §2) — AgentHtml `format="jsx"`.
 *
 * A new-format story's `content.story` holds STATIC JSX source; AgentHtml parses it
 * (lib/jsx) and renders it through the story interpreter (lib/story-ui) into the same
 * nested-in-iframe React root architecture the legacy placeholder path uses (StoryEmbeds),
 * so Radix interactivity (Tabs, Accordion, …) works through real event delegation, and the
 * embed adapters (<Question>, <Number>, <Param>) mount the SAME embed components the
 * legacy `data-*` placeholders resolve to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

const captured = vi.hoisted(() => ({
  smart: [] as Record<string, unknown>[],
  embedded: [] as Record<string, unknown>[],
  numbers: [] as Record<string, unknown>[],
  params: [] as Record<string, unknown>[],
}));

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    captured.smart.push(props);
    return React.createElement('div', { 'aria-label': 'Embedded question' });
  };
  return { __esModule: true, default: Fake };
});

vi.mock('@/components/containers/EmbeddedQuestionContainer', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    captured.embedded.push(props);
    return React.createElement('div', { 'aria-label': 'Embedded question body' });
  };
  return { __esModule: true, default: Fake };
});

vi.mock('@/components/views/story/InlineNumber', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    captured.numbers.push(props);
    return React.createElement('span', { 'aria-label': 'Inline number' });
  };
  return { __esModule: true, default: Fake };
});

vi.mock('@/components/views/story/StoryParamControl', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    captured.params.push(props);
    return React.createElement('div', { 'aria-label': 'Story param control' });
  };
  return { __esModule: true, default: Fake };
});

import AgentHtml, { type AgentHtmlHandle } from '../AgentHtml';
import { savedQuestionToPlaceholder } from '@/lib/data/story/story-question';

const iframeDoc = () =>
  (screen.getByLabelText('Story document') as HTMLIFrameElement).contentDocument!;

beforeEach(() => {
  captured.smart.length = 0;
  captured.embedded.length = 0;
  captured.numbers.length = 0;
  captured.params.length = 0;
});

describe('AgentHtml format="jsx" — shadcn components in the iframe', () => {
  const TABS_JSX =
    '<Card aria-label="jsx-card"><CardTitle>T</CardTitle></Card>' +
    '<Tabs defaultValue="a"><TabsList>' +
    '<TabsTrigger value="a" aria-label="tab-a">A</TabsTrigger>' +
    '<TabsTrigger value="b" aria-label="tab-b">B</TabsTrigger>' +
    '</TabsList>' +
    '<TabsContent value="a" aria-label="panel-a">panel-a</TabsContent>' +
    '<TabsContent value="b" aria-label="panel-b">panel-b</TabsContent>' +
    '</Tabs>';

  it('renders shadcn Card + Tabs inside the iframe, and clicking a tab switches panels', async () => {
    render(<AgentHtml html={TABS_JSX} format="jsx" width={800} colorMode="light" />);

    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('jsx-card')).toBeTruthy());
    expect(within(doc.body).getByLabelText('jsx-card').textContent).toContain('T');

    // Radix Tabs (defaultValue="a"): panel a active with content; panel b's container is
    // kept in the DOM but hidden and childless (Radix renders children only when selected).
    const tabA = within(doc.body).getByLabelText('tab-a');
    const tabB = within(doc.body).getByLabelText('tab-b');
    expect(tabA.getAttribute('data-state')).toBe('active');
    expect(within(doc.body).getByLabelText('panel-a').textContent).toBe('panel-a');
    const panelB = within(doc.body).getByLabelText('panel-b');
    expect(panelB.hasAttribute('hidden')).toBe(true);
    expect(panelB.textContent).toBe('');

    // Real Radix interactivity through the nested-in-iframe root's event delegation.
    fireEvent.mouseDown(tabB, { button: 0 });
    fireEvent.click(tabB);
    await waitFor(() => expect(within(doc.body).getByLabelText('panel-b').textContent).toBe('panel-b'));
    expect(within(doc.body).getByLabelText('panel-b').hasAttribute('hidden')).toBe(false);
    const panelA = within(doc.body).getByLabelText('panel-a');
    expect(panelA.hasAttribute('hidden')).toBe(true);
    expect(panelA.textContent).toBe('');
    expect(tabB.getAttribute('data-state')).toBe('active');
  });

  it('injects the floating-element CSS inside the story root (absolute-positioned poppers)', async () => {
    // In-root, not head (Story_Design_V2 §4): the serialized <svg> subtree must carry it.
    render(<AgentHtml html={TABS_JSX} format="jsx" width={800} colorMode="light" />);
    const doc = iframeDoc();
    await waitFor(() => expect(doc.querySelector('[data-mx-story-root] style[data-mx-floating]')).toBeTruthy());
    expect(doc.querySelector('[data-mx-story-root] style[data-mx-floating]')!.textContent).toContain('data-radix-popper-content-wrapper');
    expect(doc.head.querySelector('style[data-mx-floating]')).toBeNull();
  });
});

describe('AgentHtml format="jsx" — embed adapters mount the SAME embed components', () => {
  it('<Question id> renders SmartEmbeddedQuestionContainer with the saved-question plumbing', async () => {
    render(
      <AgentHtml
        html='<Question id={42} height="300px" />'
        format="jsx"
        width={800}
        colorMode="light"
        readOnly
        filePath="/org/My-Story"
      />,
    );
    await waitFor(() => expect(captured.smart.length).toBeGreaterThan(0));
    const doc = iframeDoc();
    expect(within(doc.body).getByLabelText('Embedded question')).toBeTruthy();
    const props = captured.smart.at(-1)!;
    expect(props.questionId).toBe(42);
    expect(props.readOnly).toBe(true);
    expect(props.enableDrilldown).toBe(false);
  });

  it('<Question id> mounts the same embed component as the legacy placeholder path', async () => {
    // Legacy: the data-question-id placeholder discovered from the DOM.
    const legacy = render(
      <AgentHtml
        html={`<div>${savedQuestionToPlaceholder(42, '300px')}</div>`}
        width={800}
        colorMode="light"
      />,
    );
    await waitFor(() => expect(captured.smart.length).toBeGreaterThan(0));
    const legacyProps = captured.smart.at(-1)!;
    legacy.unmount();
    captured.smart.length = 0;

    // JSX: the interpreter's <Question> adapter.
    render(<AgentHtml html='<Question id={42} height="300px" />' format="jsx" width={800} colorMode="light" />);
    await waitFor(() => expect(captured.smart.length).toBeGreaterThan(0));
    const jsxProps = captured.smart.at(-1)!;

    expect(jsxProps.questionId).toBe(legacyProps.questionId);
    expect(jsxProps.enableDrilldown).toBe(legacyProps.enableDrilldown);
  });

  it('inline <Question query>, <Number> and <Param> map their JSX attrs onto the embed components', async () => {
    const jsx =
      '<Param name="region" type="text" />' +
      '<Question query={`SELECT 1 AS x`} connection="duckdb" height="200px" />' +
      '<Number id={7} suffix="%" />';
    render(<AgentHtml html={jsx} format="jsx" width={800} colorMode="light" paramValues={{ region: 'EU' }} />);

    await waitFor(() => {
      expect(captured.embedded.length).toBeGreaterThan(0);
      expect(captured.numbers.length).toBeGreaterThan(0);
      expect(captured.params.length).toBeGreaterThan(0);
    });

    // Inline question: query/connection ride into QuestionContent; story params flow as externals.
    const q = captured.embedded.at(-1)!;
    expect((q.question as { query: string }).query).toBe('SELECT 1 AS x');
    expect((q.question as { connection_name: string }).connection_name).toBe('duckdb');
    expect((q.externalParameters as { name: string }[]).map(p => p.name)).toEqual(['region']);
    expect((q.externalParamValues as Record<string, unknown>).region).toBe('EU');

    // Number: id + suffix arrive as the InlineNumberEmbed.
    const n = captured.numbers.at(-1)!;
    expect((n.embed as { id: number }).id).toBe(7);
    expect((n.embed as { suffix: string }).suffix).toBe('%');

    // Param: name/type resolved via the same paramFromJsxAttrs contract; seeded value flows in.
    const p = captured.params.at(-1)!;
    expect((p.param as { name: string }).name).toBe('region');
    expect(p.value).toBe('EU');
  });
});

describe('AgentHtml format="jsx" — WYSIWYG scoping (component chrome stays locked)', () => {
  // Scoped contenteditable + write-back behavior is covered in story-jsx-edit.ui.test.tsx;
  // this guards the LOCKED side: an all-component story has no HTML text hosts, so editable
  // mode makes nothing editable, and serialize() reports "no pending edits" (null).
  it('serialize() returns null with no edits, and component chrome never gets contenteditable', async () => {
    const ref = createRef<AgentHtmlHandle>();
    render(
      <AgentHtml
        ref={ref}
        html='<Card aria-label="jsx-card"><CardTitle>T</CardTitle></Card>'
        format="jsx"
        editable
        width={800}
        colorMode="light"
      />,
    );
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('jsx-card')).toBeTruthy());

    expect(ref.current!.serialize()).toBeNull();
    const card = within(doc.body).getByLabelText('jsx-card');
    expect(card.getAttribute('contenteditable')).not.toBe('true');
    expect(doc.querySelectorAll('[contenteditable="true"]').length).toBe(0);
  });
});
