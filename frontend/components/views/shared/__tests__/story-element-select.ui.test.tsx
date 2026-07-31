/**
 * StoryJsxBody — click-to-select format targets (Phase 2 of the WYSIWYG toolbar).
 *
 * In edit mode, clicking a PLAIN, non-text-host element (a section, a wrapper div, an
 * embed-carrying heading) selects it as a format target: the element is stamped
 * `data-mx-selected` (outline via injected CSS; the attr is a render artifact the sanitizer
 * already strips) and reported via `onElementSelectChange` — the same target shape the
 * typography toolbar anchors on. Text hosts keep the contenteditable-focus path; component
 * embeds are never selected (their chrome is interactive); the story ROOT is excluded.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

vi.mock('@/components/views/story/InlineNumber', async () => {
  const React = await import('react');
  return {
    __esModule: true,
    default: () => React.createElement('button', { 'aria-label': 'Number chrome' }, '42'),
  };
});

import StoryJsxBody from '../StoryJsxBody';

// Paths: root div=0 → [section=0.0 → [p=0.0.0, h2=0.0.1 → [text, Number=0.0.1.1, text]], hr=0.1]
const JSX_DOC =
  '<div className="p-8"><section className="py-14"><p>text</p>' +
  '<h2>Head <Number query={`SELECT 1`} connection="duckdb" /> after</h2></section><hr /></div>';

function renderBody(overrides: Partial<React.ComponentProps<typeof StoryJsxBody>> = {}) {
  const onElementSelectChange = vi.fn();
  const utils = renderWithProviders(
    <StoryJsxBody
      doc={document}
      jsx={JSX_DOC}
      readOnly={false}
      editable
      onElementSelectChange={onElementSelectChange}
      {...overrides}
    />,
  );
  const at = (path: string) => {
    const el = utils.container.querySelector(`[data-mx-ast="${path}"]`) as HTMLElement | null;
    if (!el) throw new Error(`no element at ast path ${path}`);
    return el;
  };
  return { ...utils, onElementSelectChange, at };
}

describe('StoryJsxBody — element selection (format targets)', () => {
  it('clicking a plain container selects it and stamps data-mx-selected', () => {
    const { onElementSelectChange, at } = renderBody();
    const section = at('0.0');
    fireEvent.click(section);
    expect(onElementSelectChange).toHaveBeenLastCalledWith({ astPath: '0.0', el: section, ancestors: [] });
    expect(section.hasAttribute('data-mx-selected')).toBe(true);
  });

  it('an embed-carrying heading (locked from text editing) is selectable for formatting', () => {
    const { onElementSelectChange, at } = renderBody();
    const h2 = at('0.0.1');
    expect(h2.getAttribute('contenteditable')).not.toBe('true'); // component descendant → no text editing
    fireEvent.click(h2);
    expect(onElementSelectChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ astPath: '0.0.1', el: h2 }),
    );
  });

  it('clicking a text host clears the selection (focus owns text hosts)', () => {
    const { onElementSelectChange, at } = renderBody();
    const section = at('0.0');
    fireEvent.click(section);
    fireEvent.click(at('0.0.0')); // the contenteditable <p>
    expect(onElementSelectChange).toHaveBeenLastCalledWith(null);
    expect(section.hasAttribute('data-mx-selected')).toBe(false);
  });

  it('clicks inside component chrome neither select nor clear', () => {
    const { onElementSelectChange, at, getByLabelText } = renderBody();
    fireEvent.click(at('0.0'));
    onElementSelectChange.mockClear();
    fireEvent.click(getByLabelText('Number chrome'));
    expect(onElementSelectChange).not.toHaveBeenCalled();
    expect(at('0.0').hasAttribute('data-mx-selected')).toBe(true);
  });

  it('selection moves between elements (single stamp) and Escape clears it', () => {
    const { onElementSelectChange, at } = renderBody();
    const section = at('0.0');
    fireEvent.click(section);
    const hr = at('0.1');
    fireEvent.click(hr);
    expect(section.hasAttribute('data-mx-selected')).toBe(false);
    expect(hr.hasAttribute('data-mx-selected')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onElementSelectChange).toHaveBeenLastCalledWith(null);
    expect(hr.hasAttribute('data-mx-selected')).toBe(false);
  });

  it('the story ROOT element is never selectable (page-level design contract)', () => {
    const { onElementSelectChange, at } = renderBody();
    fireEvent.click(at('0'));
    expect(onElementSelectChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ astPath: '0' }),
    );
  });

  it('no selection wiring outside edit mode', () => {
    const { onElementSelectChange, at } = renderBody({ editable: false });
    fireEvent.click(at('0.0'));
    expect(onElementSelectChange).not.toHaveBeenCalled();
  });
});

describe('StoryJsxBody — selection context (breadcrumb + hover preview)', () => {
  it('a selection reports its selectable ancestor chain, outermost first', () => {
    const { onElementSelectChange, at } = renderBody();
    const h2 = at('0.0.1');
    fireEvent.click(h2);
    expect(onElementSelectChange).toHaveBeenLastCalledWith({
      astPath: '0.0.1',
      el: h2,
      // The root div (path '0') is excluded — page-level contract; the section qualifies.
      ancestors: [{ astPath: '0.0', tag: 'section', hint: '' }],
    });
  });

  it('editApi.selectElement re-anchors the selection to an ancestor (breadcrumb click)', () => {
    const editApiRef = { current: null } as React.RefObject<import('../StoryJsxBody').StoryJsxEditApi | null>;
    const { onElementSelectChange, at } = renderBody({ editApiRef });
    fireEvent.click(at('0.0.1'));
    editApiRef.current!.selectElement('0.0');
    const section = at('0.0');
    expect(onElementSelectChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ astPath: '0.0', el: section }),
    );
    expect(section.hasAttribute('data-mx-selected')).toBe(true);
    expect(at('0.0.1').hasAttribute('data-mx-selected')).toBe(false);
  });

  it('hovering stamps a preview of what a click would select; text hosts clear it', () => {
    const { at } = renderBody();
    const section = at('0.0');
    fireEvent.mouseMove(section);
    expect(section.hasAttribute('data-mx-hover')).toBe(true);
    fireEvent.mouseMove(at('0.0.0')); // contenteditable <p> — click would focus, not select
    expect(section.hasAttribute('data-mx-hover')).toBe(false);
  });
});
