// StoryParamControl — the reader-facing filter a story's <Param> renders to.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StoryParamControl from '../StoryParamControl';
import type { StoryParam } from '@/lib/data/story-params';

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

  it('uses a number input for a number param', () => {
    const { getByLabelText } = renderWithProviders(
      <StoryParamControl param={{ name: 'min_rev', type: 'number', nullable: false }} value={5} onChange={() => {}} />,
    );
    expect((getByLabelText('param min_rev') as HTMLInputElement).type).toBe('number');
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

  it('applies the agent <Param style={{…}}> override to the input (source-less + sourced)', () => {
    const plain: StoryParam = { name: 'region', type: 'text', nullable: true, style: { width: '250px', fontStyle: 'italic' } };
    const { getByLabelText, unmount } = renderWithProviders(<StoryParamControl param={plain} value="" onChange={() => {}} />);
    const input = getByLabelText('param region') as HTMLInputElement;
    expect(input.style.width).toBe('250px');
    expect(input.style.fontStyle).toBe('italic');
    unmount();

    const sourced: StoryParam = { name: 'region', type: 'text', nullable: true, source: { questionId: 5, column: 'region' }, style: { width: '250px' } };
    const { getByLabelText: get2 } = renderWithProviders(<StoryParamControl param={sourced} value="" onChange={() => {}} />);
    expect((get2('param region') as HTMLInputElement).style.width).toBe('250px');
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
