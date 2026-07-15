/**
 * Views are whitelistable like tables — and their COLUMNS are too.
 *
 * A view row carries a checkbox (expose this view at all), and expanding it
 * reveals its columns, each with its own checkbox. Deselecting a column is real
 * enforcement, not concealment: the view's CTE is projected to the selected
 * columns, so the column ceases to exist for the agent, the GUI and any query
 * (see lib/views/resolve.ts).
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ViewsSection from '@/components/context/ViewsSection';
import type { ViewDef } from '@/lib/types';

const ZONE_REVENUE: ViewDef = {
  name: 'zone_revenue',
  connection: 'warehouse',
  sql: 'SELECT zone_name, revenue, cost FROM x',
  columns: [
    { name: 'zone_name', type: 'VARCHAR' },
    { name: 'revenue', type: 'DOUBLE' },
    { name: 'cost', type: 'DOUBLE' },
  ],
};

function renderSection(overrides: Partial<React.ComponentProps<typeof ViewsSection>> & { editable?: boolean } = {}) {
  const onViewsChange = vi.fn();
  const editable = overrides.editable !== false;
  function Harness() {
    const [views, setViews] = React.useState<ViewDef[]>((overrides.views as ViewDef[]) ?? [ZONE_REVENUE]);
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

describe('view + column whitelisting', () => {
  it('a view has a checkbox, checked by default (exposed)', () => {
    renderSection();
    expect((screen.getByLabelText('Expose view zone_revenue') as HTMLInputElement).checked).toBe(true);
  });

  it('unchecking a view hides it (its columns whitelist becomes empty)', async () => {
    const { onViewsChange } = renderSection();
    fireEvent.click(screen.getByLabelText('Expose view zone_revenue'));
    await waitFor(() => expect(onViewsChange).toHaveBeenCalled());
    expect(onViewsChange.mock.calls.at(-1)![0][0].whitelistedColumns).toEqual([]);
  });

  it('expanding a view reveals its columns, each selectable', async () => {
    renderSection();
    fireEvent.click(screen.getByLabelText('Toggle columns of zone_revenue'));
    expect(await screen.findByLabelText('Expose column zone_revenue.revenue')).toBeTruthy();
    expect(screen.getByLabelText('Expose column zone_revenue.cost')).toBeTruthy();
    // all exposed by default
    expect((screen.getByLabelText('Expose column zone_revenue.cost') as HTMLInputElement).checked).toBe(true);
  });

  it('deselecting a column stores the remaining ones (the projection list)', async () => {
    const { onViewsChange } = renderSection();
    fireEvent.click(screen.getByLabelText('Toggle columns of zone_revenue'));
    fireEvent.click(await screen.findByLabelText('Expose column zone_revenue.cost'));
    await waitFor(() => expect(onViewsChange).toHaveBeenCalled());
    expect(onViewsChange.mock.calls.at(-1)![0][0].whitelistedColumns).toEqual(['zone_name', 'revenue']);
  });

  it('re-selecting every column clears the whitelist (back to "all")', async () => {
    const restricted = { ...ZONE_REVENUE, whitelistedColumns: ['zone_name', 'revenue'] };
    const { onViewsChange } = renderSection({ views: [restricted] });
    fireEvent.click(screen.getByLabelText('Toggle columns of zone_revenue'));
    fireEvent.click(await screen.findByLabelText('Expose column zone_revenue.cost'));
    await waitFor(() => expect(onViewsChange).toHaveBeenCalled());
    expect(onViewsChange.mock.calls.at(-1)![0][0].whitelistedColumns).toBeUndefined();
  });

  it('in VIEW mode, column checkboxes are state-reflecting but disabled', async () => {
    const restricted = { ...ZONE_REVENUE, whitelistedColumns: ['zone_name', 'revenue'] };
    renderSection({ views: [restricted], editable: false });
    fireEvent.click(screen.getByLabelText('Toggle columns of zone_revenue'));
    const cost = await screen.findByLabelText('Expose column zone_revenue.cost') as HTMLInputElement;
    expect(cost.checked).toBe(false);   // reflects that cost is hidden
    expect(cost.disabled).toBe(true);   // but not toggleable outside edit mode
    const revenue = screen.getByLabelText('Expose column zone_revenue.revenue') as HTMLInputElement;
    expect(revenue.checked).toBe(true);
    expect(revenue.disabled).toBe(true);
  });

  it('a DISABLED view is shown with its reason and cannot be exposed', () => {
    renderSection({ problems: [{ view: 'zone_revenue', reason: 'reads mxfood.orders, which is not offered by the parent knowledge base' }] });
    const row = screen.getByLabelText('View zone_revenue');
    expect(row.textContent).toMatch(/disabled/i);
    expect(row.textContent).toMatch(/not offered/i);
  });
});
