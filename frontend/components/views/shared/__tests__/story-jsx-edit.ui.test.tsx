/**
 * WYSIWYG editing for format:'jsx' stories (Story_Design_V2 §2) — AgentHtml `format="jsx"`.
 *
 * Scoped contenteditable: HTML text hosts (elements with direct non-whitespace text and no
 * component/embed descendants) become editable; component chrome and embed-carrying hosts
 * stay locked. A blur (focusout) after REAL user input commits the edit by AST write-back
 * (applyDomEditsToJsx) and emits the new JSX source via onChange; serialize() returns the
 * source with pending edits applied (null when none). While a host has focus its rendered
 * subtree is frozen, so upstream re-renders (param changes, embed refetches) can never
 * clobber in-progress typing.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

vi.mock('@/components/views/story/InlineNumber', async () => {
  const React = await import('react');
  const Fake = () => React.createElement('span', { 'aria-label': 'Inline number' }, '42');
  return { __esModule: true, default: Fake };
});

import AgentHtml, { type AgentHtmlHandle } from '../AgentHtml';

const iframeDoc = () =>
  (screen.getByLabelText('Story document') as HTMLIFrameElement).contentDocument!;

const EDIT_JSX =
  '<Card aria-label="chrome"><CardTitle aria-label="title">Locked title</CardTitle></Card>' +
  '<p aria-label="para">Hello <strong>bold</strong> world</p>' +
  '<p aria-label="embed-para">Revenue <Number id={5} /> up</p>';

/** Simulate the user editing a contenteditable host: replace content, fire a real input. */
function typeInto(el: HTMLElement, mutate: (innerHtml: string) => string) {
  fireEvent.focusIn(el);
  el.innerHTML = mutate(el.innerHTML);
  fireEvent.input(el);
}

describe('AgentHtml format="jsx" — scoped contenteditable', () => {
  it('makes text hosts editable while locking component chrome and embed hosts', async () => {
    render(<AgentHtml html={EDIT_JSX} format="jsx" editable width={800} colorMode="light" />);
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());

    expect(within(doc.body).getByLabelText('para').getAttribute('contenteditable')).toBe('true');
    // Component chrome locked (the Card/CardTitle DOM must never be editable)…
    expect(within(doc.body).getByLabelText('chrome').getAttribute('contenteditable')).not.toBe('true');
    expect(within(doc.body).getByLabelText('title').getAttribute('contenteditable')).not.toBe('true');
    // …and so is a paragraph carrying an embed (its edit could not be written back).
    expect(within(doc.body).getByLabelText('embed-para').getAttribute('contenteditable')).not.toBe('true');
  });

  it('never sets contenteditable when not editable', async () => {
    render(<AgentHtml html={EDIT_JSX} format="jsx" width={800} colorMode="light" />);
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());
    expect(doc.querySelectorAll('[contenteditable="true"]').length).toBe(0);
  });
});

describe('AgentHtml format="jsx" — blur commits by AST write-back', () => {
  it('commits on blur after real user input: onChange fires with the updated JSX source', async () => {
    const onChange = vi.fn();
    const ref = createRef<AgentHtmlHandle>();
    render(
      <AgentHtml ref={ref} html={EDIT_JSX} format="jsx" editable width={800} colorMode="light" onChange={onChange} />,
    );
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());
    const para = within(doc.body).getByLabelText('para');

    expect(ref.current!.serialize()).toBeNull(); // no pending edits yet

    typeInto(para, h => h.replace('Hello', 'Goodbye').replace('>bold<', '>bolder<'));
    fireEvent.focusOut(para);

    expect(onChange).toHaveBeenCalled();
    const source = onChange.mock.calls.at(-1)![0] as string;
    expect(source).toContain('Goodbye');
    expect(source).toContain('<strong>bolder</strong>');
    expect(source).not.toContain('data-mx-ast');
    // Untouched parts of the story survive verbatim.
    expect(source).toContain('<Number id={5} />');
    expect(source).toContain('Locked title');
    // serialize() reports the same committed state.
    expect(ref.current!.serialize()).toBe(source);
  });

  it('does NOT commit on blur without user input (mirrors the legacy userEdited gate)', async () => {
    const onChange = vi.fn();
    render(
      <AgentHtml html={EDIT_JSX} format="jsx" editable width={800} colorMode="light" onChange={onChange} />,
    );
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());
    const para = within(doc.body).getByLabelText('para');

    fireEvent.focusIn(para);
    fireEvent.focusOut(para); // focus churn (embed mount/unmount) — no input, no echo
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('AgentHtml format="jsx" — render-during-edit guard', () => {
  it('typed text survives a prop-driven re-render while the host has focus', async () => {
    const { rerender } = render(
      <AgentHtml html={EDIT_JSX} format="jsx" editable width={800} colorMode="light" paramValues={{ region: 'EU' }} />,
    );
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());
    const para = within(doc.body).getByLabelText('para');

    typeInto(para, h => h.replace('Hello', 'Mid-edit'));

    // Upstream re-render while the host still has focus (param change → new props flow down).
    rerender(
      <AgentHtml html={EDIT_JSX} format="jsx" editable width={800} colorMode="light" paramValues={{ region: 'US' }} />,
    );
    await waitFor(() => expect(within(iframeDoc().body).getByLabelText('para')).toBeTruthy());

    expect(within(iframeDoc().body).getByLabelText('para').textContent).toContain('Mid-edit');
  });
});

describe('AgentHtml format="jsx" — edit round-trip', () => {
  it('edit → new source → re-render → identical text including the bolded word', async () => {
    const onChange = vi.fn();
    const first = render(
      <AgentHtml html={EDIT_JSX} format="jsx" editable width={800} colorMode="light" onChange={onChange} />,
    );
    const doc = iframeDoc();
    await waitFor(() => expect(within(doc.body).getByLabelText('para')).toBeTruthy());
    const para = within(doc.body).getByLabelText('para');

    typeInto(para, h => h.replace('Hello', 'Goodbye').replace('>bold<', '>bolder<'));
    fireEvent.focusOut(para);
    const source = onChange.mock.calls.at(-1)![0] as string;
    first.unmount();

    // Re-render the committed source fresh (what Save → reload does).
    render(<AgentHtml html={source} format="jsx" width={800} colorMode="light" />);
    const doc2 = iframeDoc();
    await waitFor(() => expect(within(doc2.body).getByLabelText('para')).toBeTruthy());
    const para2 = within(doc2.body).getByLabelText('para');
    expect(para2.textContent).toBe('Goodbye bolder world');
    const strong = para2.querySelector('strong')!;
    expect(strong).toBeTruthy();
    expect(strong.textContent).toBe('bolder');
  });
});
