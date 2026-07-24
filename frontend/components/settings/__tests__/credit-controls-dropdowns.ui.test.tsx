import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import AdminUsageDashboard from '@/components/settings/AdminUsageDashboard';

// Two real users so the dropdowns have something to enumerate.
const USERS = [
  { id: 1, name: 'Ada', email: 'ada@example.com', role: 'admin' },
  { id: 2, name: 'Ben', email: 'ben@example.com', role: 'editor' },
];

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          url.includes('/credits/events') ? { success: true, data: { events: [] } }
          : url.includes('/api/configs') ? { success: true, data: { config: { credits: {} } } }
          : url.includes('/api/users') ? { success: true, data: { users: USERS } }
          : { success: true, data: {} },
      }),
    ),
  );
}

function store() {
  return makeStore({
    configs: { creditsEnabled: true, config: DEFAULT_CONFIG },
    auth: { user: { name: 'Admin', email: 'admin@example.com', role: 'admin', mode: 'org' }, loading: false },
    users: { users: USERS, status: 'loaded' },
  } as never);
}

describe('Credit controls — user & role dropdowns', () => {
  beforeEach(() => { vi.clearAllMocks(); mockFetch(); });
  afterEach(() => vi.unstubAllGlobals());

  it('reset target is a user dropdown enumerating real users (scope=user)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsageDashboard />, { store: store() });

    await user.selectOptions(screen.getByLabelText('Reset scope'), 'user');
    const target = (await screen.findByLabelText('Reset target user')) as HTMLSelectElement;
    expect(target.tagName).toBe('SELECT');
    // The user's email is a real, selectable option (not free text).
    await user.selectOptions(target, 'ben@example.com');
    expect(target.value).toBe('ben@example.com');
  });

  it('reset target is a role dropdown (scope=role)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsageDashboard />, { store: store() });

    await user.selectOptions(screen.getByLabelText('Reset scope'), 'role');
    const target = (await screen.findByLabelText('Reset target role')) as HTMLSelectElement;
    expect(target.tagName).toBe('SELECT');
    await user.selectOptions(target, 'editor');
    expect(target.value).toBe('editor');
  });

  it('add-user-limit is a user dropdown, and adding one creates a limit row', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsageDashboard />, { store: store() });

    const add = (await screen.findByLabelText('Add user for limit')) as HTMLSelectElement;
    expect(add.tagName).toBe('SELECT');
    await user.selectOptions(add, 'ada@example.com');
    await user.click(screen.getByLabelText('Add user limit'));

    // The new per-user limit row exposes its daily-limit cell, labelled by the email.
    expect(await screen.findByLabelText('ada@example.com daily limit')).toBeInTheDocument();
  });
});
