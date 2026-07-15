/**
 * SchemaColumnRow is the ONE column-row visual shared by the table tree
 * (SchemaTreeSchemaRow) and the views section (ViewsSection). Locking its
 * contract here is what makes reuse real: a column looks and behaves the same
 * wherever it's shown. Tables render it WITHOUT a checkbox (columns aren't
 * whitelistable); views render it WITH one (deselecting projects the CTE).
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SchemaColumnRow from '@/components/schema-browser/SchemaColumnRow';

describe('SchemaColumnRow', () => {
  it('renders the column name and type (the table case: no checkbox)', () => {
    renderWithProviders(<SchemaColumnRow ariaLabel="Column revenue" name="revenue" type="DOUBLE" />);
    const row = screen.getByLabelText('Column revenue');
    expect(row.textContent).toContain('revenue');
    expect(row.textContent).toContain('DOUBLE');
    // no checkbox in the table case
    expect(screen.queryByLabelText('Expose revenue')).toBeNull();
  });

  it('an interactive checkbox slot toggles (edit-mode view column)', async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <SchemaColumnRow name="revenue" type="DOUBLE"
        selection={{ checked: true, onToggle, ariaLabel: 'Expose revenue' }} />,
    );
    const box = screen.getByLabelText('Expose revenue') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
  });

  it('a checkbox with no onToggle is state-reflecting but disabled (view-mode)', () => {
    renderWithProviders(
      <SchemaColumnRow name="revenue" type="DOUBLE"
        selection={{ checked: false, ariaLabel: 'Expose revenue' }} />,
    );
    const box = screen.getByLabelText('Expose revenue') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
  });

  it('renders a description slot and a footer slot', () => {
    renderWithProviders(
      <SchemaColumnRow ariaLabel="Column c" name="c" type="INT"
        description={<span>a description</span>}
        footer={<span>source: profiled</span>} />,
    );
    const row = screen.getByLabelText('Column c');
    expect(row.textContent).toContain('a description');
    expect(row.textContent).toContain('source: profiled');
  });
});
