/**
 * StoryJsxBody — className edits in the WYSIWYG edit session (typography toolbar commit path).
 *
 * Class edits are staged in the SAME edit session as contenteditable text edits, and every
 * commit composes BOTH kinds against the current source — the no-clobber invariant: a text-edit
 * blur landing after a typography apply must not re-derive the source without the class change
 * (and vice versa). Also covers the focus-change callback that anchors the toolbar.
 */
import React, { createRef } from 'react';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

import StoryJsxBody, { type StoryJsxEditApi } from '../StoryJsxBody';

const JSX_DOC = '<div className="p-8"><p className="text-base">Hello</p><h2>Head</h2></div>';

function renderBody(overrides: Partial<React.ComponentProps<typeof StoryJsxBody>> = {}) {
  const editApiRef = createRef<StoryJsxEditApi | null>();
  const onChange = vi.fn<(story: string) => void>();
  const utils = renderWithProviders(
    <StoryJsxBody
      doc={document}
      jsx={JSX_DOC}
      readOnly={false}
      editable
      onChange={onChange}
      editApiRef={editApiRef}
      {...overrides}
    />,
  );
  const host = (path: string) => {
    const el = utils.container.querySelector(`[data-mx-ast="${path}"]`) as HTMLElement | null;
    if (!el) throw new Error(`no element at ast path ${path}`);
    return el;
  };
  return { ...utils, editApiRef, onChange, host };
}

describe('StoryJsxBody — format edits in the edit session', () => {
  it('applyFormatEdit writes the className into the source and fires onChange immediately', () => {
    const { editApiRef, onChange } = renderBody();
    editApiRef.current!.applyFormatEdit('0.0', { className: 'text-2xl font-bold' });
    expect(onChange).toHaveBeenLastCalledWith(
      '<div className="p-8"><p className="text-2xl font-bold">Hello</p><h2>Head</h2></div>',
    );
  });

  it('an empty className removes the attribute', () => {
    const { editApiRef, onChange } = renderBody();
    editApiRef.current!.applyFormatEdit('0.0', { className: '' });
    expect(onChange).toHaveBeenLastCalledWith('<div className="p-8"><p>Hello</p><h2>Head</h2></div>');
  });

  it('style edits (color picker) land in the source beside class edits', () => {
    const { editApiRef, onChange } = renderBody();
    editApiRef.current!.applyFormatEdit('0.0', { className: 'text-base', style: 'color: rgb(255, 0, 0);' });
    expect(onChange).toHaveBeenLastCalledWith(
      '<div className="p-8"><p className="text-base" style="color: rgb(255, 0, 0);">Hello</p><h2>Head</h2></div>',
    );
  });

  it('serialize() includes staged class edits', () => {
    const { editApiRef } = renderBody();
    editApiRef.current!.applyFormatEdit('0.1', { className: 'text-3xl' });
    expect(editApiRef.current!.serialize()).toBe(
      '<div className="p-8"><p className="text-base">Hello</p><h2 className="text-3xl">Head</h2></div>',
    );
  });

  it('no-clobber: a text-edit blur after a class edit keeps BOTH changes', () => {
    const { editApiRef, onChange, host } = renderBody();
    editApiRef.current!.applyFormatEdit('0.0', { className: 'text-2xl' });
    const p = host('0.0');
    fireEvent.focus(p);
    p.innerHTML = 'Goodbye';
    fireEvent.input(p);
    fireEvent.blur(p);
    expect(onChange).toHaveBeenLastCalledWith(
      '<div className="p-8"><p className="text-2xl">Goodbye</p><h2>Head</h2></div>',
    );
  });

  it('no-clobber: a class edit after a committed text edit keeps BOTH changes', () => {
    const { editApiRef, onChange, host } = renderBody();
    const p = host('0.0');
    fireEvent.focus(p);
    p.innerHTML = 'Goodbye';
    fireEvent.input(p);
    fireEvent.blur(p);
    editApiRef.current!.applyFormatEdit('0.0', { className: 'text-2xl' });
    expect(onChange).toHaveBeenLastCalledWith(
      '<div className="p-8"><p className="text-2xl">Goodbye</p><h2>Head</h2></div>',
    );
  });

  it('a class edit lands while a text edit is still IN PROGRESS (no blur yet) — serialize has both', () => {
    const { editApiRef, host } = renderBody();
    const p = host('0.0');
    fireEvent.focus(p);
    p.innerHTML = 'Typing…';
    fireEvent.input(p);
    editApiRef.current!.applyFormatEdit('0.0', { className: 'font-bold' });
    expect(editApiRef.current!.serialize()).toBe(
      '<div className="p-8"><p className="font-bold">Typing…</p><h2>Head</h2></div>',
    );
  });
});

describe('StoryJsxBody — text-host focus reporting (toolbar anchor)', () => {
  it('reports focus/blur of editable text hosts with their AST path and element', () => {
    const onTextHostFocusChange = vi.fn();
    const { host } = renderBody({ onTextHostFocusChange });
    const p = host('0.0');
    fireEvent.focus(p);
    expect(onTextHostFocusChange).toHaveBeenLastCalledWith({ astPath: '0.0', el: p });
    fireEvent.blur(p);
    expect(onTextHostFocusChange).toHaveBeenLastCalledWith(null);
  });
});
