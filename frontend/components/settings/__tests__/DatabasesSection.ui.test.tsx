/**
 * Settings → Databases — DB connections managed in the org config
 * (`databases.connections`), like LLM providers. Field specs come from the
 * shared compatibility.json contract; static sources (CSV/XLSX/Sheets) are NOT
 * offered here — they are datasets (files in folders), not connections.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { DatabasesSection } from '@/components/settings/databases/DatabasesSection';
import type { OrgConfig } from '@/lib/branding/whitelabel';

function mockFetch() {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    ({ ok: true, status: 200, json: async () => ({ success: true, data: { config: {} } }) } as Response));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function storeWithDatabases(databases: unknown, mode = 'org') {
  const store = makeStore();
  const config = store.getState().configs.config;
  return makeStore({
    configs: { config: { ...config, databases } as OrgConfig, loaded: true },
    auth: { user: { id: 1, email: 'a@b.c', name: 'A', role: 'admin', mode }, loading: false },
  } as never);
}

const WAREHOUSE = {
  name: 'warehouse', type: 'postgresql',
  config: { host: 'db.internal', port: 5432, database: 'app', username: 'svc', password: '@SECRETS/config/org/databases.connections/warehouse/config.password' },
};

describe('DatabasesSection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('lists configured connections with their type', () => {
    mockFetch();
    renderWithProviders(<DatabasesSection />, { store: storeWithDatabases({ connections: [WAREHOUSE] }) });
    const row = screen.getByLabelText('Database connection warehouse');
    expect(row.textContent).toContain('warehouse');
    expect(row.textContent).toContain('postgresql');
  });

  it('never renders the raw secret ref — a saved credential shows masked', () => {
    mockFetch();
    renderWithProviders(<DatabasesSection />, { store: storeWithDatabases({ connections: [WAREHOUSE] }) });
    fireEvent.click(screen.getByLabelText('Edit connection warehouse'));
    const pw = screen.getByLabelText('warehouse Password') as HTMLInputElement;
    expect(pw.value).not.toContain('@SECRETS');
    expect(pw.placeholder.toLowerCase()).toContain('saved');
  });

  it('adding a connection saves it into config.databases via /api/configs', async () => {
    const fetchSpy = mockFetch();
    renderWithProviders(<DatabasesSection />, { store: storeWithDatabases({ connections: [] }) });

    fireEvent.change(screen.getByLabelText('New connection name'), { target: { value: 'wh2' } });
    fireEvent.click(screen.getByLabelText('Add database connection'));
    fireEvent.change(screen.getByLabelText('wh2 Host'), { target: { value: 'pg.internal' } });
    fireEvent.change(screen.getByLabelText('wh2 Database'), { target: { value: 'app' } });
    fireEvent.change(screen.getByLabelText('wh2 Username'), { target: { value: 'svc' } });
    fireEvent.click(screen.getByLabelText('Save database connections'));

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/api/configs'));
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.databases.connections).toHaveLength(1);
      expect(body.databases.connections[0]).toMatchObject({
        name: 'wh2', type: 'postgresql',
        config: expect.objectContaining({ host: 'pg.internal', database: 'app', username: 'svc' }),
      });
    });
  });

  it('does NOT offer static source types — CSV/Sheets are datasets, not connections', async () => {
    mockFetch();
    renderWithProviders(<DatabasesSection />, { store: storeWithDatabases({ connections: [] }) });
    const typePicker = screen.getByLabelText('New connection type') as HTMLSelectElement;
    const options = [...typePicker.querySelectorAll('option')].map((o) => o.value);
    expect(options).toContain('postgresql');
    expect(options).not.toContain('csv');
    expect(options).not.toContain('google-sheets');
    expect(options).not.toContain('xlsx');
  });
});
