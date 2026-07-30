/**
 * The way out of a refused workspace.
 *
 * Migrations do not run at boot, so a build that cannot read the workspace's data refuses
 * every request. This screen is the only path forward, which puts two properties on it:
 * the button must actually trigger the one migration endpoint, and it must NOT appear when
 * migrating would make things worse.
 *
 * That second case is `build-too-old` — the data is NEWER than this build writes, i.e.
 * someone rolled back. Migrating cannot help, and offering the button would invite
 * rewriting newer rows with older shapes.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { UpgradePendingGate } from '@/components/banners/UpgradePendingGate';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('UpgradePendingGate', () => {
  it('migrates through the shared endpoint when asked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    // jsdom has no navigation; the component reloads on success.
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload }, writable: true,
    });

    renderWithProviders(
      <UpgradePendingGate message="This workspace is on data version 34." reason="upgrade-pending" />,
    );

    await userEvent.click(screen.getByLabelText('Migrate data now'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/migrate-db', { method: 'POST' },
    ));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('offers NO button when the build is older than the data', () => {
    renderWithProviders(
      <UpgradePendingGate message="This deployment writes data version 38." reason="build-too-old" />,
    );

    expect(screen.queryByLabelText('Migrate data now')).not.toBeInTheDocument();
    expect(screen.getByText(/Deploy the newer build again/)).toBeInTheDocument();
  });

  it('surfaces why a migration failed instead of silently staying put', async () => {
    // atomicImport is all-or-nothing, so a failure leaves the workspace exactly where it
    // was — the only useful output is the reason.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ success: false, errors: ['Migrated data is invalid: duplicate path'] }),
    }) as unknown as typeof fetch;

    renderWithProviders(
      <UpgradePendingGate message="needs migrating" reason="upgrade-pending" />,
    );

    await userEvent.click(screen.getByLabelText('Migrate data now'));

    await waitFor(() =>
      expect(screen.getByText(/duplicate path/)).toBeInTheDocument());
    // Still offering a retry rather than dead-ending.
    expect(screen.getByLabelText('Migrate data now')).toBeInTheDocument();
  });

  it('reports a transport failure rather than appearing to succeed', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch')) as unknown as typeof fetch;

    renderWithProviders(
      <UpgradePendingGate message="needs migrating" reason="upgrade-pending" />,
    );

    await userEvent.click(screen.getByLabelText('Migrate data now'));

    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument());
  });
});
