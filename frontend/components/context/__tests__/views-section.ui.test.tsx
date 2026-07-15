/**
 * ViewsSection — views are whitelisted with the SAME row UI tables use
 * (SchemaColumnRow, a real checkbox), plus a view-specific eye button that opens
 * the definition. The checkbox is shown in BOTH modes (state-reflecting when not
 * editable); the eye — mirroring the table row's "Preview" affordance — opens the
 * ViewWorkbench (editable in edit mode, read-only otherwise). Inherited views are
 * read-only (disabled checkbox + badge); disabled views show their reason.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ViewsSection from '@/components/context/ViewsSection';
import type { ViewDef } from '@/lib/types';

const ZONE_REVENUE: ViewDef = {
  name: 'zone_revenue',
  connection: 'warehouse',
  sql: 'SELECT zone_name, SUM(total) AS revenue FROM mxfood.orders GROUP BY 1',
  columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'revenue', type: 'DOUBLE' }],
  description: 'Revenue per zone',
};

function renderSection(overrides: Partial<React.ComponentProps<typeof ViewsSection>> & { editable?: boolean } = {}) {
  const onViewsChange = vi.fn();
  const editable = overrides.editable !== false;
  function Harness() {
    const [views, setViews] = React.useState<ViewDef[]>((overrides.views as ViewDef[]) ?? []);
    return (
      <ViewsSection
        contextPath="/org/context"
        connection="warehouse"
        inheritedViews={[]}
        {...overrides}
        views={views}
        onViewsChange={editable ? (next) => { onViewsChange(next); setViews(next); } : undefined}
      />
    );
  }
  renderWithProviders(<Harness />);
  return { onViewsChange };
}

describe('ViewsSection', () => {
  it('lists this context\'s views with their column count, a checkbox, and a definition button', () => {
    renderSection({ views: [ZONE_REVENUE] });
    const row = screen.getByLabelText('View zone_revenue');
    expect(row.textContent).toContain('_views.zone_revenue');
    expect(row.textContent).toContain('2 cols');
    // whitelist checkbox — same affordance as a table
    expect(screen.getByLabelText('Expose view zone_revenue')).toBeTruthy();
    // and a real eye button to open the definition
    expect(screen.getByLabelText('Definition of zone_revenue')).toBeTruthy();
  });

  it('shows the exposure checkbox in VIEW mode too, but disabled (state-reflecting)', () => {
    renderSection({ views: [ZONE_REVENUE], editable: false });
    const box = screen.getByLabelText('Expose view zone_revenue') as HTMLInputElement;
    expect(box.checked).toBe(true);   // reflects that it's exposed
    expect(box.disabled).toBe(true);  // but not toggleable outside edit mode
    // the definition is still inspectable read-only
    expect(screen.getByLabelText('Definition of zone_revenue')).toBeTruthy();
  });

  it('shows inherited views read-only — a disabled checkbox + an "inherited" badge', () => {
    renderSection({ views: [], inheritedViews: [ZONE_REVENUE] });
    const row = screen.getByLabelText('View zone_revenue');
    expect(row.textContent).toContain('inherited');
    const box = screen.getByLabelText('Expose view zone_revenue') as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });

  it('the eye button TOGGLES the definition open/closed; the row stays put', async () => {
    renderSection({ views: [ZONE_REVENUE] });
    const toggle = screen.getByLabelText('Definition of zone_revenue');

    fireEvent.click(toggle);
    // The ViewWorkbench (real question editor) expands with an editable name + Save,
    // and the row itself is still there (the panel opens BELOW, it doesn't replace it).
    expect(await screen.findByLabelText('View name')).toBeTruthy();
    expect(screen.getByLabelText('Save view')).toBeTruthy();
    expect(screen.getByLabelText('View zone_revenue')).toBeTruthy();
    expect(toggle.textContent).toMatch(/hide/i);

    // Same button hides it again — no separate Close control.
    fireEvent.click(screen.getByLabelText('Definition of zone_revenue'));
    await waitFor(() => expect(screen.queryByLabelText('View name')).toBeNull());
  });

  it('in view mode the definition opens READ-ONLY (no Save, no Close — the toggle hides it)', async () => {
    renderSection({ views: [ZONE_REVENUE], editable: false });
    fireEvent.click(screen.getByLabelText('Definition of zone_revenue'));
    expect(await screen.findByLabelText('View name')).toBeTruthy();
    expect(screen.queryByLabelText('Save view')).toBeNull();
    expect(screen.queryByLabelText('Close view')).toBeNull();
    fireEvent.click(screen.getByLabelText('Definition of zone_revenue'));
    await waitFor(() => expect(screen.queryByLabelText('View name')).toBeNull());
  });

  it('scopes views to the connection', () => {
    renderSection({ views: [{ ...ZONE_REVENUE, connection: 'other' }] });
    expect(screen.queryByLabelText('View zone_revenue')).toBeNull();
  });
});
