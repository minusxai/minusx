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
