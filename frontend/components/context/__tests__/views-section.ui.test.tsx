/**
 * ViewsSection + ViewWorkbench — creating/editing a view expands IN PLACE inside
 * the whitelist UI: write SQL, run it, save. Saving goes through
 * /api/views/prepare (name validation + column snapshot) and only then lands on
 * the context version.
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
  });

  it('shows inherited views read-only (cannot silently change someone else\'s definition)', () => {
    renderSection({ views: [], inheritedViews: [ZONE_REVENUE] });
    const row = screen.getByLabelText('View zone_revenue');
    expect(row.textContent).toContain('inherited');
    expect(row.tagName).not.toBe('BUTTON'); // not clickable → not editable
  });

  it('scopes views to the connection', () => {
    renderSection({ views: [{ ...ZONE_REVENUE, connection: 'other' }] });
    expect(screen.queryByLabelText('View zone_revenue')).toBeNull();
  });

  it('creating a view: SQL → prepare → lands on the version WITH its snapshotted columns', async () => {
    const fetchMock = prepareOk();
    vi.stubGlobal('fetch', fetchMock);
    const { onViewsChange } = renderSection();

    fireEvent.click(screen.getByLabelText('Add view to warehouse'));
    fireEvent.change(await screen.findByLabelText('View name'), { target: { value: 'zone_revenue' } });
    fireEvent.change(screen.getByLabelText('View description'), { target: { value: 'Revenue per zone' } });
    // SqlEditor is Monaco (stubbed in jsdom) — drive the value through its textarea role-free label
    const sqlBox = screen.getByLabelText('SQL editor');
    fireEvent.change(sqlBox, { target: { value: 'SELECT 1 AS x' } });
    fireEvent.click(screen.getByLabelText('Save view'));

    await waitFor(() => expect(onViewsChange).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/views/prepare', expect.objectContaining({ method: 'POST' }));
    const saved = onViewsChange.mock.calls.at(-1)![0][0] as ViewDef;
    expect(saved).toMatchObject({
      name: 'zone_revenue',
      connection: 'warehouse',
      description: 'Revenue per zone',
      columns: ZONE_REVENUE.columns, // the snapshot, not something the client invented
    });
    vi.unstubAllGlobals();
  });

  it('a rejected name surfaces the server\'s message and does NOT save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: { message: 'name is already used by an inherited or descendant view' } }),
    }));
    const { onViewsChange } = renderSection();

    fireEvent.click(screen.getByLabelText('Add view to warehouse'));
    fireEvent.change(await screen.findByLabelText('View name'), { target: { value: 'zone_revenue' } });
    fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: 'SELECT 1' } });
    fireEvent.click(screen.getByLabelText('Save view'));

    await waitFor(() => expect(screen.getByLabelText('View error').textContent).toMatch(/already used/i));
    expect(onViewsChange).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('editing an existing view opens it in place and can delete it', async () => {
    const { onViewsChange } = renderSection({ views: [ZONE_REVENUE] });
    fireEvent.click(screen.getByLabelText('View zone_revenue'));
    expect((await screen.findByLabelText('View name') as HTMLInputElement).value).toBe('zone_revenue');
    fireEvent.click(screen.getByLabelText('Delete view'));
    await waitFor(() => expect(onViewsChange).toHaveBeenLastCalledWith([]));
  });
});
