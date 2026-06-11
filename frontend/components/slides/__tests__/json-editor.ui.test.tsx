/**
 * JsonEditor — editable JSON view. The Monaco mock (vitest.setup.ui.ts)
 * renders a textarea labeled "SQL editor"; readOnly comes from options.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

import JsonEditor from '@/components/slides/JsonEditor';

const editor = () => screen.getByLabelText('SQL editor') as HTMLTextAreaElement;

describe('JsonEditor', () => {
  it('is read-only by default', () => {
    renderWithProviders(<JsonEditor value={'{"a": 1}'} onChange={vi.fn()} />);
    expect(editor().readOnly).toBe(true);
  });

  it('is editable when readOnly={false}: valid JSON edits propagate', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonEditor value={'{"a": 1}'} onChange={onChange} readOnly={false} />);
    expect(editor().readOnly).toBe(false);
    fireEvent.change(editor(), { target: { value: '{"a": 2}' } });
    expect(onChange).toHaveBeenCalledWith('{"a": 2}');
  });

  it('does not propagate invalid JSON and shows a parse error', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonEditor value={'{"a": 1}'} onChange={onChange} readOnly={false} />);
    fireEvent.change(editor(), { target: { value: '{"a": ' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('JSON error')).toBeInTheDocument();
  });

  it('shows an error returned by onChange (e.g. schema validation)', () => {
    const onChange = vi.fn().mockReturnValue('Invalid dashboard content: assets is required');
    renderWithProviders(<JsonEditor value={'{"a": 1}'} onChange={onChange} readOnly={false} />);
    fireEvent.change(editor(), { target: { value: '{"a": 2}' } });
    const error = screen.getByLabelText('JSON error');
    expect(error.textContent).toContain('assets is required');
  });

  it('clears the error once a subsequent edit is accepted', () => {
    const onChange = vi.fn().mockReturnValue(undefined);
    renderWithProviders(<JsonEditor value={'{"a": 1}'} onChange={onChange} readOnly={false} />);
    fireEvent.change(editor(), { target: { value: '{"a": ' } });
    expect(screen.getByLabelText('JSON error')).toBeInTheDocument();
    fireEvent.change(editor(), { target: { value: '{"a": 3}' } });
    expect(screen.queryByLabelText('JSON error')).toBeNull();
  });

  it('does not clobber locally-typed text when the value prop round-trips with different formatting', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <JsonEditor value={'{\n  "a": 1\n}'} onChange={onChange} readOnly={false} />
    );
    // User types a compact but semantically-different doc
    fireEvent.change(editor(), { target: { value: '{"a":2}' } });
    // Redux echoes it back pretty-printed — semantically equal to local text
    rerender(<JsonEditor value={'{\n  "a": 2\n}'} onChange={onChange} readOnly={false} />);
    expect(editor().value).toBe('{"a":2}');
  });

  it('adopts external value changes that are semantically different (e.g. agent edit)', () => {
    const { rerender } = renderWithProviders(
      <JsonEditor value={'{"a": 1}'} onChange={vi.fn()} readOnly={false} />
    );
    rerender(<JsonEditor value={'{"a": 99}'} onChange={vi.fn()} readOnly={false} />);
    expect(editor().value).toBe('{"a": 99}');
  });
});
