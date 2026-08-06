/**
 * ChildPathSelector — childPaths are stored RELATIVE to the owning context's
 * folder, but legacy documents carry absolute entries. With `baseDir` given,
 * absolute selections must render as their relative form (checked against the
 * relative `availablePaths`) and every emission must be relative — the selector
 * is the write path, so this is what converges legacy documents to relative.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ChildPathSelector from '@/components/selectors/ChildPathSelector';

function renderSelector(selectedPaths: string[] | undefined, baseDir?: string) {
  const onChange = vi.fn();
  renderWithProviders(
    <ChildPathSelector
      subject="doc guide"
      availablePaths={['team_a', 'team_b']}
      selectedPaths={selectedPaths}
      baseDir={baseDir}
      onChange={onChange}
    />
  );
  return onChange;
}

async function open() {
  fireEvent.click(screen.getByLabelText('Child paths for doc guide'));
  await screen.findByLabelText('All child paths for doc guide');
}

describe('ChildPathSelector — baseDir normalization', () => {
  it('a legacy ABSOLUTE selection renders checked against the relative options', async () => {
    renderSelector(['/org/team_a'], '/org');
    await open();
    expect(screen.getByLabelText('Child path team_a for doc guide')).toBeChecked();
    expect(screen.getByLabelText('Child path team_b for doc guide')).not.toBeChecked();
  });

  it('toggling emits RELATIVE entries, normalizing any legacy absolute ones along', async () => {
    const onChange = renderSelector(['/org/team_a'], '/org');
    await open();
    fireEvent.click(screen.getByLabelText('Child path team_b for doc guide'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['team_a', 'team_b']));
  });

  it('without baseDir, values pass through untouched (caller supplies both sides in one form)', async () => {
    const onChange = renderSelector(['team_a']);
    await open();
    expect(screen.getByLabelText('Child path team_a for doc guide')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Child path team_a for doc guide'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
  });
});
