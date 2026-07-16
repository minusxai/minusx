import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SearchableSelect, SearchableMultiSelect } from '@/components/selectors/SearchableSelect';

const OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', subtitle: 'claude-sonnet-4-6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', subtitle: 'claude-haiku-4-5' },
  { value: 'gpt-4.1', label: 'GPT-4.1', subtitle: 'gpt-4.1' },
];

describe('SearchableSelect', () => {
  it('shows the selected label on the trigger, placeholder when empty', () => {
    const { unmount } = renderWithProviders(
      <SearchableSelect value="gpt-4.1" onChange={() => {}} options={OPTIONS} label="Model picker" />,
    );
    expect(screen.getByLabelText('Model picker')).toHaveTextContent('GPT-4.1');
    unmount();

    renderWithProviders(
      <SearchableSelect value="" onChange={() => {}} options={OPTIONS} label="Model picker" placeholder="Pick a model…" />,
    );
    expect(screen.getByLabelText('Model picker')).toHaveTextContent('Pick a model…');
  });

  it('opens on click, filters via the search input, and selects on click', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SearchableSelect value="" onChange={onChange} options={OPTIONS} label="Model picker" />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Model picker'));
    // All options visible before typing.
    expect(await screen.findByLabelText('Claude Sonnet 4.6')).toBeInTheDocument();
    expect(screen.getByLabelText('GPT-4.1')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Model picker search'), 'haiku');
    expect(screen.queryByLabelText('GPT-4.1')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Claude Haiku 4.5'));
    expect(onChange).toHaveBeenCalledWith('claude-haiku-4-5');
    // Single-select closes after picking.
    await waitFor(() => {
      expect(screen.queryByLabelText('Model picker search')).not.toBeInTheDocument();
    });
  });

  it('matches against the subtitle (model id) too, and shows an empty message on no hit', async () => {
    renderWithProviders(
      <SearchableSelect value="" onChange={() => {}} options={OPTIONS} label="Model picker" />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Model picker'));

    await user.type(screen.getByLabelText('Model picker search'), '4-6');
    expect(screen.getByLabelText('Claude Sonnet 4.6')).toBeInTheDocument();
    expect(screen.queryByLabelText('GPT-4.1')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Model picker search'));
    await user.type(screen.getByLabelText('Model picker search'), 'nope');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('supports keyboard selection: arrows move the highlight, Enter picks', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SearchableSelect value="" onChange={onChange} options={OPTIONS} label="Model picker" />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Model picker'));
    const search = screen.getByLabelText('Model picker search');
    await user.type(search, 'claude');
    // Highlight starts on the first filtered option; ArrowDown moves to the second.
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('claude-haiku-4-5');
  });
});

describe('SearchableMultiSelect', () => {
  it('summarizes the selection on the trigger', () => {
    const { unmount } = renderWithProviders(
      <SearchableMultiSelect values={[]} onChange={() => {}} options={OPTIONS} label="Allowed models" placeholder="All models" />,
    );
    expect(screen.getByLabelText('Allowed models')).toHaveTextContent('All models');
    unmount();

    renderWithProviders(
      <SearchableMultiSelect values={['gpt-4.1', 'claude-haiku-4-5']} onChange={() => {}} options={OPTIONS} label="Allowed models" />,
    );
    expect(screen.getByLabelText('Allowed models')).toHaveTextContent('2 selected');
  });

  it('toggles membership without closing', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SearchableMultiSelect values={['gpt-4.1']} onChange={onChange} options={OPTIONS} label="Allowed models" />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Allowed models'));
    await user.click(await screen.findByLabelText('Claude Sonnet 4.6'));
    expect(onChange).toHaveBeenCalledWith(['gpt-4.1', 'claude-sonnet-4-6']);

    // Deselecting an already-selected value removes it.
    await user.click(screen.getByLabelText('GPT-4.1'));
    expect(onChange).toHaveBeenCalledWith([]);

    // Popover stayed open throughout.
    expect(screen.getByLabelText('Allowed models search')).toBeInTheDocument();
  });
});
