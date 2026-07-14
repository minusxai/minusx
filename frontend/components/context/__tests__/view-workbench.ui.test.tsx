/**
 * ViewWorkbench REUSES the question component — it does not reimplement one.
 *
 * A view is authored on a virtual question file (a negative id, which the file
 * loader never sends to the server), so the editor you get is the real thing:
 * the GUI / SQL / Viz tabs, Run, parameters, charts. Saving reads that file's
 * content back out of Redux and stores it as a ViewDef.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ViewWorkbench from '@/components/context/ViewWorkbench';
import * as storeModule from '@/store/store';
import type { ViewDef } from '@/lib/types';

const ZONE_REVENUE: ViewDef = {
  name: 'zone_revenue',
  connection: 'warehouse',
  sql: 'SELECT zone_name, SUM(total) AS revenue FROM mxfood.orders GROUP BY 1',
  columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'revenue', type: 'DOUBLE' }],
};

function setup(props: Partial<React.ComponentProps<typeof ViewWorkbench>> = {}) {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  const onSave = vi.fn();
  renderWithProviders(
    <ViewWorkbench
      contextPath="/org/context"
      connection="warehouse"
      onSave={onSave}
      onCancel={vi.fn()}
      {...props}
    />,
    { store: testStore },
  );
  return { onSave, testStore };
}

describe('ViewWorkbench', () => {
  it('renders the REAL question editor — the SQL/GUI/Viz tabs, not a bespoke box', async () => {
    setup({ view: ZONE_REVENUE });
    // These come from QuestionViewV2's QueryModeSelector, so their presence proves reuse.
    expect(await screen.findByLabelText('SQL')).toBeTruthy();
    expect(screen.getByLabelText('Viz')).toBeTruthy();
  });

  it('seeds the editor with the view\'s SQL and connection', async () => {
    const { testStore } = setup({ view: ZONE_REVENUE });
    await waitFor(() => {
      const files = testStore.getState().files.files;
      const virtual = Object.values(files).find((f: any) => f.id < 0) as any;
      expect(virtual?.content?.query).toBe(ZONE_REVENUE.sql);
      expect(virtual?.content?.connection_name).toBe('warehouse');
    });
  });

  it('saving sends the EDITED sql (from the question file) to /api/views/prepare', async () => {
    // The embedded question component also talks to /api/query — route by URL so
    // this asserts on the prepare call, not whatever the editor happened to fire.
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/views/prepare')) {
        return { ok: true, json: async () => ({ success: true, data: { columns: [{ name: 'x', type: 'BIGINT' }] } }) };
      }
      return { ok: true, text: async () => '', json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onSave } = setup({ view: ZONE_REVENUE });

    fireEvent.change(await screen.findByLabelText('View name'), { target: { value: 'zone_revenue' } });
    fireEvent.click(screen.getByLabelText('Save view'));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const prepareCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/views/prepare'))!;
    const body = JSON.parse(prepareCall[1].body as string);
    expect(body).toMatchObject({ name: 'zone_revenue', connection: 'warehouse', sql: ZONE_REVENUE.sql });
    // the snapshot comes back from the server, not from the client
    expect(onSave.mock.calls[0][0]).toMatchObject({ columns: [{ name: 'x', type: 'BIGINT' }] });
    vi.unstubAllGlobals();
  });

  it('a server rejection is shown and nothing is saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/views/prepare')) {
        return { ok: false, json: async () => ({ success: false, error: { message: 'reads mxfood.payroll, which is not offered' } }) };
      }
      return { ok: true, text: async () => '', json: async () => ({}) };
    }));
    const { onSave } = setup({ view: ZONE_REVENUE });

    fireEvent.change(await screen.findByLabelText('View name'), { target: { value: 'zone_revenue' } });
    fireEvent.click(screen.getByLabelText('Save view'));

    await waitFor(() => expect(screen.getByLabelText('View error').textContent).toMatch(/payroll/));
    expect(onSave).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
