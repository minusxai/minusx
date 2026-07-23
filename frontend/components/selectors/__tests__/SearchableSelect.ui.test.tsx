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

    // The popover moves focus to the search input ASYNC after opening (Ark autofocus) — typing
    // before that lands loses keystrokes to the focus steal. Settle focus first, then poll the
    // filter result (state → re-render is async under userEvent's realistic event stream).
    const search = screen.getByLabelText('Model picker search');
    await waitFor(() => expect(search).toHaveFocus());
    await user.type(search, 'haiku');
    await waitFor(() => expect(screen.queryByLabelText('GPT-4.1')).not.toBeInTheDocument());

    await user.click(screen.getByLabelText('Claude Haiku 4.5'));
    expect(onChange).toHaveBeenCalledWith('claude-haiku-4-5');
    // Single-select closes after picking.
    await waitFor(() => {
      expect(screen.queryByLabelText('Model picker search')).not.toBeInTheDocument();
    });
  });

  // Regression: the popover renders in a Portal that sits at the document
  // origin for a frame before floating-ui positions it. React's `autoFocus`
  // fires in that frame and cannot opt out of scroll-into-view, so opening a
  // picker near the bottom of a long page scrolled the page to the top. The
  // input must be focused manually with { preventScroll: true } instead.
  it('focuses the search input on open without scrolling the page', async () => {
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus');
    renderWithProviders(
      <SearchableSelect value="" onChange={() => {}} options={OPTIONS} label="Model picker" />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Model picker'));
    const search = await screen.findByLabelText('Model picker search');
    await waitFor(() => expect(search).toHaveFocus());
    // Every programmatic focus of the search input must carry preventScroll.
    const inputFocusCalls = focusSpy.mock.instances
      .map((instance, i) => ({ instance, args: focusSpy.mock.calls[i] }))
      .filter(({ instance }) => instance === search);
    expect(inputFocusCalls.length).toBeGreaterThan(0);
    for (const { args } of inputFocusCalls) {
      expect(args[0]).toMatchObject({ preventScroll: true });
    }
    focusSpy.mockRestore();
  });

  it('renders an option description on its own line under the label', async () => {
    renderWithProviders(
      <SearchableSelect
        value=""
        onChange={() => {}}
        options={[
          { value: 'core', label: 'Core', description: 'Optimized for everyday analysis.' },
          { value: 'lite', label: 'Lite' },
        ]}
        label="Grade picker"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Grade picker'));
    const option = await screen.findByLabelText('Core');
    expect(option).toHaveTextContent('Optimized for everyday analysis.');
    expect(screen.getByLabelText('Lite')).not.toHaveTextContent('Optimized');
  });

  it('matches against the subtitle (model id) too, and shows an empty message on no hit', async () => {
    renderWithProviders(
      <SearchableSelect value="" onChange={() => {}} options={OPTIONS} label="Model picker" />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Model picker'));

    // Same focus-settle + poll pattern as above: Ark autofocus races user.type.
    const search = screen.getByLabelText('Model picker search');
    await waitFor(() => expect(search).toHaveFocus());
    await user.type(search, '4-6');
    await waitFor(() => expect(screen.queryByLabelText('GPT-4.1')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Claude Sonnet 4.6')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'nope');
    await waitFor(() => expect(screen.getByText('No matches')).toBeInTheDocument());
  });

  it('supports keyboard selection: arrows move the highlight, Enter picks', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SearchableSelect value="" onChange={onChange} options={OPTIONS} label="Model picker" />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Model picker'));
    const search = screen.getByLabelText('Model picker search');
    // Focus settles async (Ark autofocus) — type only once keystrokes will land in the input,
    // and wait for the filter to apply before driving the highlight.
    await waitFor(() => expect(search).toHaveFocus());
    await user.type(search, 'claude');
    await waitFor(() => expect(screen.queryByLabelText('GPT-4.1')).not.toBeInTheDocument());
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
