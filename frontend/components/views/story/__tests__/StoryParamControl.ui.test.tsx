// StoryParamControl — the reader-facing filter a story's <Param> renders to.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StoryParamControl from '../StoryParamControl';
import type { StoryParam } from '@/lib/data/story/story-params';

const city: StoryParam = { name: 'city', type: 'text', nullable: true };

describe('StoryParamControl', () => {
  it('renders a labelled input seeded with the current value', () => {
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={city} value="NYC" onChange={() => {}} />);
    expect((getByLabelText('param city') as HTMLInputElement).value).toBe('NYC');
  });

  it('reports a new value', () => {
    const onChange = vi.fn();
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={city} value="" onChange={onChange} />);
    fireEvent.change(getByLabelText('param city'), { target: { value: 'SF' } });
    expect(onChange).toHaveBeenCalledWith('SF');
  });

  it('reports null when cleared (nullable)', () => {
    const onChange = vi.fn();
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={city} value="NYC" onChange={onChange} />);
    fireEvent.change(getByLabelText('param city'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders Any as a shared nullable action and clears a plain text param', () => {
    const onChange = vi.fn();
    const view = renderWithProviders(<StoryParamControl param={city} value="NYC" onChange={onChange} />);
    const any = view.getByRole('button', { name: 'Any City' });
    expect(any).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(any);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows the active Any state with the teal treatment', () => {
    const view = renderWithProviders(<StoryParamControl param={city} value={null} onChange={() => {}} />);
    const any = view.getByRole('button', { name: 'Any City' });
    expect(any).toHaveAttribute('aria-pressed', 'true');
    expect(any).toHaveStyle({ borderColor: '#16a085', color: '#0f766e' });
  });

  it('uses a number input for a number param', () => {
    const { getByLabelText, queryByRole } = renderWithProviders(
      <StoryParamControl param={{ name: 'min_rev', type: 'number', nullable: false }} value={5} onChange={() => {}} />,
    );
    expect((getByLabelText('param min_rev') as HTMLInputElement).type).toBe('number');
    expect(queryByRole('button', { name: 'Any Min Rev' })).toBeNull();
  });

  it('humanizes the binding name by default and supports a custom styled label', () => {
    const automatic = renderWithProviders(
      <StoryParamControl
        param={{ name: 'immediate_parent', type: 'text', nullable: true }}
        value=""
        onChange={() => {}}
      />,
    );
    expect(automatic.getByText('Immediate Parent')).toBeInTheDocument();
    automatic.unmount();

    const custom = renderWithProviders(
      <StoryParamControl
        param={{ name: 'immediate_parent', label: 'Parent company', type: 'text', nullable: true, labelStyle: { color: 'rgb(12, 34, 56)' } }}
        value=""
        onChange={() => {}}
      />,
    );
    expect(custom.getByText('Parent company')).toHaveStyle({ color: 'rgb(12, 34, 56)' });
  });
});

describe('StoryParamControl — slider widget (<Param widget="slider">)', () => {
  const slider: StoryParam = { name: 'limit', type: 'number', nullable: false, widget: 'slider', min: 0, max: 100, step: 5 };

  it('renders a range input with the declared bounds', () => {
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={slider} value={20} onChange={() => {}} />);
    const input = getByLabelText('param limit') as HTMLInputElement;
    expect(input.type).toBe('range');
    expect(input.min).toBe('0');
    expect(input.max).toBe('100');
    expect(input.step).toBe('5');
    expect(input.value).toBe('20');
  });

  it('reports the new value as the slider moves', () => {
    const onChange = vi.fn();
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={slider} value={20} onChange={onChange} />);
    fireEvent.change(getByLabelText('param limit'), { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith('45');
  });

  it('offers the shared Any action for a nullable slider', () => {
    const onChange = vi.fn();
    const nullableSlider = { ...slider, nullable: true };
    const view = renderWithProviders(
      <StoryParamControl param={nullableSlider} value={20} onChange={onChange} />,
    );
    fireEvent.click(view.getByRole('button', { name: 'Any Limit' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('falls back to a plain input when widget="slider" is set on a non-number param', () => {
    const bad: StoryParam = { name: 'city', type: 'text', nullable: true, widget: 'slider' };
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={bad} value="" onChange={() => {}} />);
    expect((getByLabelText('param city') as HTMLInputElement).type).not.toBe('range');
  });

  it('applies the agent style override to the slider', () => {
    const styled: StoryParam = { ...slider, style: { accentColor: '#c8781a' } };
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={styled} value={10} onChange={() => {}} />);
    expect((getByLabelText('param limit') as HTMLInputElement).style.accentColor).toBe('#c8781a');
  });
});

describe('StoryParamControl — autocomplete (param with a question source)', () => {
  it('renders the source autocomplete combobox (not a plain input) when the param imports a question column', () => {
    const sourced: StoryParam = { name: 'city', type: 'text', nullable: true, source: { questionId: 5, column: 'city' } };
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={sourced} value="" onChange={() => {}} />);
    // The labelled input rendered (positive proof the widget mounted) AND it's a combobox —
    // i.e. the autocomplete path, not the plain <input type="text"> the source-less branch uses.
    const input = getByLabelText('param city') as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('combobox');
  });

  it('source-less param renders a plain (non-combobox) input', () => {
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={city} value="" onChange={() => {}} />);
    expect((getByLabelText('param city') as HTMLInputElement).getAttribute('role')).not.toBe('combobox');
  });

  it('keeps authored input styling while stretching controls to the full parameter width', () => {
    const plain: StoryParam = { name: 'region', type: 'text', nullable: true, style: { width: '250px', fontStyle: 'italic' } };
    const { getByLabelText, unmount } = renderWithProviders(<StoryParamControl param={plain} value="" onChange={() => {}} />);
    const input = getByLabelText('param region') as HTMLInputElement;
    expect(input.style.width).toBe('100%');
    expect(input.style.fontStyle).toBe('italic');
    unmount();

    const sourced: StoryParam = { name: 'region', type: 'text', nullable: true, source: { questionId: 5, column: 'region' }, style: { width: '250px' } };
    const { getByLabelText: get2 } = renderWithProviders(<StoryParamControl param={sourced} value="" onChange={() => {}} />);
    expect((get2('param region') as HTMLInputElement).style.width).toBe('100%');
  });

  it('does NOT remount the source input when the committed value changes (focus-loss regression)', () => {
    // Each keystroke commits the value live; if the widget is keyed on value it remounts and the
    // field loses focus mid-type. Assert the SAME input DOM node survives a value change.
    const sourced: StoryParam = { name: 'region', type: 'text', nullable: true, source: { questionId: 5, column: 'region' } };
    const { getByLabelText, rerender } = renderWithProviders(<StoryParamControl param={sourced} value="" onChange={() => {}} />);
    const before = getByLabelText('param region');
    rerender(<StoryParamControl param={sourced} value="No" onChange={() => {}} />);
    const after = getByLabelText('param region');
    expect(after).toBe(before); // same node identity → not remounted → focus preserved
  });
});

describe('StoryParamControl — autocomplete (param with an inline SQL source)', () => {
  const sourced: StoryParam = {
    name: 'region', type: 'text', nullable: true,
    source: { query: 'SELECT DISTINCT region FROM sales', connection: 'warehouse' },
  };

  it('renders an inline-SQL combobox and commits a typed value on Enter', () => {
    const onChange = vi.fn();
    const { getByLabelText } = renderWithProviders(
      <StoryParamControl param={sourced} value="" filePath="/org/story" onChange={onChange} />,
    );
    const input = getByLabelText('param region') as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('combobox');
    fireEvent.change(input, { target: { value: 'West' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('West');
  });

  it('keeps story-authored input styles while stretching to the parameter width', () => {
    const styled = { ...sourced, style: { width: '260px' } } as StoryParam;
    const { getByLabelText } = renderWithProviders(<StoryParamControl param={styled} value="" onChange={() => {}} />);
    expect((getByLabelText('param region') as HTMLInputElement).style.width).toBe('100%');
  });

  it('uses the story-safe Radix popover and lets complete option labels widen or wrap', () => {
    const { getByLabelText, getByRole } = renderWithProviders(
      <StoryParamControl param={sourced} value="" onChange={() => {}} />,
    );
    fireEvent.click(getByLabelText('param region'));
    const options = getByRole('listbox');
    expect(options).toHaveAttribute('data-story-floating');
    expect(options).toHaveClass('w-max');
    expect(options).toHaveClass('min-w-[var(--radix-popover-trigger-width)]');
    expect(options).toHaveClass('max-w-[min(420px,calc(100vw-16px))]');
    expect(options).toHaveClass('overflow-y-auto');
  });

  it('keeps Any outside the SQL option list', () => {
    const onChange = vi.fn();
    const { getByLabelText, getByRole } = renderWithProviders(
      <StoryParamControl param={sourced} value="West" onChange={onChange} />,
    );
    fireEvent.click(getByLabelText('param region'));
    expect(getByRole('listbox')).not.toHaveTextContent('Don’t filter');
    fireEvent.click(getByRole('button', { name: 'Any Region' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('does not offer the shared Any action when nullable is false', () => {
    const required = { ...sourced, nullable: false };
    const { queryByRole } = renderWithProviders(
      <StoryParamControl param={required} value="West" onChange={() => {}} />,
    );
    expect(queryByRole('button', { name: 'Any Region' })).toBeNull();
  });

  it('shows the SQL edit action only when author edit mode supplies a handler', () => {
    const onRequestEdit = vi.fn();
    const view = renderWithProviders(
      <StoryParamControl param={sourced} value="" onChange={() => {}} onRequestEdit={onRequestEdit} />,
    );
    fireEvent.click(view.getByLabelText('Edit region options query'));
    expect(onRequestEdit).toHaveBeenCalledOnce();
    view.unmount();

    const reader = renderWithProviders(<StoryParamControl param={sourced} value="" onChange={() => {}} />);
    expect(reader.queryByLabelText('Edit region options query')).toBeNull();
  });
});
