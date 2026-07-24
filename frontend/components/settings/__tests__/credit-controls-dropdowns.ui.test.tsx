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
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollTo = vi.fn();
    mockFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
    const trigger = screen.getByLabelText(label);
    expect(trigger.tagName).toBe('BUTTON');
    await user.click(trigger);
    const listbox = await screen.findByRole('listbox');
    expect(screen.getByLabelText('Credit controls')).not.toContainElement(listbox);
    await user.click(await screen.findByRole('option', { name: option }));
    return trigger;
  }

  it('reset target is a user dropdown enumerating real users (scope=user)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsageDashboard />, { store: store() });

    await choose(user, 'Reset scope', 'User');
    const target = await screen.findByLabelText('Reset target user');
    // The user's email is a real, selectable option (not free text).
    await choose(user, 'Reset target user', 'ben@example.com');
    expect(target).toHaveTextContent('ben@example.com');
  });

  it('reset target is a role dropdown (scope=role)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsageDashboard />, { store: store() });

    await choose(user, 'Reset scope', 'Role');
    const target = await screen.findByLabelText('Reset target role');
    await choose(user, 'Reset target role', 'editor');
    expect(target).toHaveTextContent('editor');
  });

  it('add-user-limit is a user dropdown, and adding one creates a limit row', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsageDashboard />, { store: store() });

    await screen.findByLabelText('Add user for limit');
    await choose(user, 'Add user for limit', 'ada@example.com');
    await user.click(screen.getByLabelText('Add user limit'));

    // The new per-user limit row exposes its daily-limit cell, labelled by the email.
    expect(await screen.findByLabelText('ada@example.com daily limit')).toBeInTheDocument();
  });
});
