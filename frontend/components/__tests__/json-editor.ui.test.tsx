/**
 * JsonEditor component unit tests (jsdom).
 *
 * Monaco is mocked to a <textarea> in vitest.setup.ui.ts; the mock honors
 * `options.readOnly` and labels the textarea from `options.ariaLabel`.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import JsonEditor from '@/components/slides/JsonEditor';

const VALID_JSON = JSON.stringify({ query: 'SELECT 1' }, null, 2);

describe('JsonEditor', () => {
  it('is read-only by default', () => {
    renderWithProviders(<JsonEditor value={VALID_JSON} onChange={vi.fn()} />);
    const editor = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(editor.readOnly).toBe(true);
  });

  it('is editable when readOnly is false and forwards valid JSON to onChange', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonEditor value={VALID_JSON} onChange={onChange} readOnly={false} />);
    const editor = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;
    expect(editor.readOnly).toBe(false);

    const next = JSON.stringify({ query: 'SELECT 42' });
    fireEvent.change(editor, { target: { value: next } });
    expect(onChange).toHaveBeenCalledWith(next);
  });

  it('shows a parse error and does not call onChange for malformed JSON', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonEditor value={VALID_JSON} onChange={onChange} readOnly={false} />);
    const editor = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;

    fireEvent.change(editor, { target: { value: '{ nope' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('JSON editor error')).toBeTruthy();
  });

  it('shows an external error passed via the error prop', () => {
    renderWithProviders(
      <JsonEditor value={VALID_JSON} onChange={vi.fn()} readOnly={false} error="Invalid question content" />
    );
    const banner = screen.getByLabelText('JSON editor error');
    expect(banner.textContent).toContain('Invalid question content');
  });

  it('keeps Monaco find controls above hover overlays', () => {
    renderWithProviders(<JsonEditor value={VALID_JSON} onChange={vi.fn()} readOnly={false} />);
    const editor = screen.getByLabelText('JSON editor') as HTMLTextAreaElement;

    expect(editor.dataset.fixedOverflowWidgets).toBe('true');
    expect(editor.dataset.hoverSticky).toBe('false');
    expect(editor.dataset.hoverHidingDelay).toBe('0');
    expect(
      Array.from(document.querySelectorAll('style')).some(style =>
        style.textContent?.includes('body:has(.json-monaco-editor .monaco-editor .find-widget.visible) .workbench-hover-container')
      )
    ).toBe(true);
  });
});
