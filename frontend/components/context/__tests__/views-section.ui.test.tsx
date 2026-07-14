/**
 * ViewsSection + ViewWorkbench — creating/editing a view expands IN PLACE inside
 * the whitelist UI: write SQL, run it, save. Saving goes through
 * /api/views/prepare (name validation + column snapshot) and only then lands on
 * the context version.
 */
import React from 'react';
import { screen } from '@testing-library/react';
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

const prepareOk = (columns = ZONE_REVENUE.columns) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { columns } }) });

function renderSection(overrides: Partial<React.ComponentProps<typeof ViewsSection>> = {}) {
  const onViewsChange = vi.fn();
  function Harness() {
    const [views, setViews] = React.useState<ViewDef[]>((overrides.views as ViewDef[]) ?? []);
    return (
      <ViewsSection
        contextPath="/org/context"
        connection="warehouse"
        inheritedViews={[]}
        {...overrides}
        views={views}
        onViewsChange={(next) => { onViewsChange(next); setViews(next); }}
      />
    );
  }
  renderWithProviders(<Harness />);
  return { onViewsChange };
}

describe('ViewsSection', () => {
  it('lists this context\'s views with their column count', () => {
    renderSection({ views: [ZONE_REVENUE] });
    const row = screen.getByLabelText('View zone_revenue');
    expect(row.textContent).toContain('_views.zone_revenue');
    expect(row.textContent).toContain('2 cols');
    // each view carries an expose checkbox now
    expect(screen.getByLabelText('Expose view zone_revenue')).toBeTruthy();
  });

  it('shows inherited views read-only (cannot silently change someone else\'s definition)', () => {
    renderSection({ views: [], inheritedViews: [ZONE_REVENUE] });
    const row = screen.getByLabelText('View zone_revenue');
    expect(row.textContent).toContain('inherited');
    // inherited rows have no expose checkbox and no edit affordance
    expect(screen.queryByLabelText('Expose view zone_revenue')).toBeNull();
  });

  it('scopes views to the connection', () => {
    renderSection({ views: [{ ...ZONE_REVENUE, connection: 'other' }] });
    expect(screen.queryByLabelText('View zone_revenue')).toBeNull();
  });


});
