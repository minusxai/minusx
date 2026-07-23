/**
 * SchemaOptionPicker — the shared searchable dropdown for schema-flavored
 * choices (tables, columns, aggregations…), styled like the mention submenu
 * (mono rows, colored type meta on the right). Replaces native <select>s.
 *
 * Contract:
 * - trigger button carries the given aria-label and shows the selected
 *   option's label (or the placeholder);
 * - clicking it opens a panel; each option row is aria-labelled
 *   `${label}-option-${value}`; clicking one calls onSelect and closes;
 * - a search input (aria `${label}-search`) appears only when the list is
 *   large, and filters by substring;
 * - Escape closes without selecting.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SchemaOptionPicker from '@/components/schema-browser/SchemaOptionPicker';

const OPTIONS = [
  { value: 'id', label: 'id', meta: 'BIGINT' },
  { value: 'total', label: 'total', meta: 'DOUBLE' },
  { value: 'created_at', label: 'created_at', meta: 'TIMESTAMP' },
];

const renderPicker = (over: Partial<React.ComponentProps<typeof SchemaOptionPicker>> = {}) => {
  const onSelect = vi.fn();
  renderWithProviders(
    <SchemaOptionPicker label="pick-column" value="" placeholder="column…"
      options={OPTIONS} onSelect={onSelect} {...over} />,
  );
  return { onSelect };
};

describe('trigger', () => {
  it('shows the placeholder when nothing is selected', () => {
    renderPicker();
    expect(screen.getByLabelText('pick-column').textContent).toContain('column…');
  });

  it('shows the selected option label', () => {
    renderPicker({ value: 'total' });
    expect(screen.getByLabelText('pick-column').textContent).toContain('total');
  });

  it('shows a raw value not in the options (stale-but-visible, like the old selects)', () => {
    renderPicker({ value: 'ghost_col' });
    expect(screen.getByLabelText('pick-column').textContent).toContain('ghost_col');
  });
});

describe('open / select / close', () => {
  it('opens on click and lists every option with meta', () => {
    renderPicker();
    fireEvent.click(screen.getByLabelText('pick-column'));
    for (const o of OPTIONS) {
      expect(screen.getByLabelText(`pick-column-option-${o.value}`).textContent).toContain(o.label);
    }
    expect(screen.getByLabelText('pick-column-option-id').textContent).toContain('BIGINT');
  });

  it('clicking an option selects it and closes the panel', () => {
    const { onSelect } = renderPicker();
    fireEvent.click(screen.getByLabelText('pick-column'));
    fireEvent.click(screen.getByLabelText('pick-column-option-total'));
    expect(onSelect).toHaveBeenCalledWith('total');
    expect(screen.queryByLabelText('pick-column-option-id')).toBeNull();
  });

  it('Escape closes without selecting', () => {
    const { onSelect } = renderPicker();
    fireEvent.click(screen.getByLabelText('pick-column'));
    fireEvent.keyDown(screen.getByLabelText('pick-column-option-id'), { key: 'Escape' });
    expect(screen.queryByLabelText('pick-column-option-id')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('an emptyOption is offered first and selects the empty value', () => {
    const { onSelect } = renderPicker({ value: 'total', emptyOption: '(* — COUNT rows)' });
    fireEvent.click(screen.getByLabelText('pick-column'));
    fireEvent.click(screen.getByLabelText('pick-column-option-'));
    expect(onSelect).toHaveBeenCalledWith('');
  });

  it('shows the emptyMessage when there are no options', () => {
    renderPicker({ options: [], emptyMessage: 'no columns found' });
    fireEvent.click(screen.getByLabelText('pick-column'));
    expect(screen.getByLabelText('pick-column-empty').textContent).toContain('no columns found');
  });
});

describe('search', () => {
  const MANY = Array.from({ length: 12 }, (_, i) => ({ value: `col_${i}`, label: `col_${i}`, meta: 'BIGINT' }));

  it('no search input for short lists', () => {
    renderPicker();
    fireEvent.click(screen.getByLabelText('pick-column'));
    expect(screen.queryByLabelText('pick-column-search')).toBeNull();
  });

  it('search appears for long lists and filters by substring (case-insensitive)', () => {
    renderPicker({ options: [...MANY, { value: 'total', label: 'Total', meta: 'DOUBLE' }] });
    fireEvent.click(screen.getByLabelText('pick-column'));
    fireEvent.change(screen.getByLabelText('pick-column-search'), { target: { value: 'tot' } });
    expect(screen.getByLabelText('pick-column-option-total')).toBeTruthy();
    expect(screen.queryByLabelText('pick-column-option-col_1')).toBeNull();
  });

  it('Enter in the search selects the first filtered option', () => {
    const { onSelect } = renderPicker({ options: [...MANY, { value: 'total', label: 'Total', meta: 'DOUBLE' }] });
    fireEvent.click(screen.getByLabelText('pick-column'));
    fireEvent.change(screen.getByLabelText('pick-column-search'), { target: { value: 'tot' } });
    fireEvent.keyDown(screen.getByLabelText('pick-column-search'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('total');
  });
});
