/**
 * FileSearchBar UI tests
 *
 * Scenarios:
 *   1. When the search API fails, the dropdown shows a "Search failed" row
 *      instead of staying completely inert.
 *   2. A result whose type is missing from FILE_TYPE_METADATA renders with a
 *      fallback icon instead of crashing the whole dropdown.
 *   3. The very first search — with the dropdown never yet opened — shows the
 *      "Searching" spinner while the request is in flight, and never flashes
 *      "No results found" before the response lands.
 *
 * All element queries use aria-label (getByLabelText/findByLabelText) only.
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import FileSearchBar from '@/components/file-browser/FileSearchBar';

vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn() }),
}));

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('FileSearchBar', () => {
  it('shows an error row in the dropdown when the search API fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: { message: 'boom' } }),
    }) as any;

    renderWithProviders(<FileSearchBar />);

    const input = screen.getByLabelText('Search files');
    await userEvent.type(input, 'revenue');

    // Debounce is 300ms; findByLabelText polls past it.
    const errorRow = await screen.findByLabelText('Search failed', {}, { timeout: 3000 });
    expect(errorRow.textContent).toMatch(/search failed/i);
  });

  it('renders results without crashing when a result type is missing from FILE_TYPE_METADATA', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            id: 42,
            name: 'Mystery File',
            path: '/org/Mystery File',
            type: 'totally-unknown-type',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
            score: 1,
            matchCount: 1,
            relevantResults: [],
          },
          {
            id: 43,
            name: 'Known Question',
            path: '/org/Known Question',
            type: 'question',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
            score: 0.5,
            matchCount: 1,
            relevantResults: [],
          },
        ],
      }),
    }) as any;

    renderWithProviders(<FileSearchBar />);

    const input = screen.getByLabelText('Search files');
    await userEvent.type(input, 'myst');

    expect(await screen.findByLabelText('Search result: Mystery File', {}, { timeout: 3000 })).toBeTruthy();
    expect(await screen.findByLabelText('Search result: Known Question')).toBeTruthy();
  });

  it('shows the spinner during the FIRST search, before the dropdown has ever opened', async () => {
    // Deferred response: the request stays in flight until we resolve it, so the
    // in-flight window is deterministic rather than a race against a timer.
    let release!: (value: unknown) => void;
    const inFlight = new Promise((resolve) => { release = resolve; });
    global.fetch = vi.fn(() => inFlight) as any;

    renderWithProviders(<FileSearchBar />);

    const input = screen.getByLabelText('Search files');
    await userEvent.type(input, 'revenue');

    // Feedback must be immediate: the dropdown opens on the keystroke, not on
    // the response. Synchronous assertion — this is already past the debounce
    // only by accident of typing speed, and must hold either way.
    expect(screen.getByLabelText('Searching')).toBeTruthy();

    // ...and the empty-results branch must not render while we are still
    // waiting. Hoisting showDropdown without a pending flag flashes this.
    expect(screen.queryByText(/No results found/i)).toBeNull();

    release({ ok: true, status: 200, json: async () => ({ results: [] }) });
    await screen.findByText(/No results found/i);
  });

  it('keeps showing the spinner between keystrokes once results are on screen', async () => {
    // One deferred per request, resolved only once the component has actually
    // issued it — the 300ms debounce means it has not fired when typing returns.
    const pending: Array<(value: unknown) => void> = [];
    global.fetch = vi.fn(() => new Promise((resolve) => { pending.push(resolve); })) as any;

    renderWithProviders(<FileSearchBar />);

    const input = screen.getByLabelText('Search files');
    await userEvent.type(input, 'rev');
    await waitFor(() => expect(pending.length).toBe(1), { timeout: 3000 });
    pending[0]({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          id: 1, name: 'Revenue', path: '/org/Revenue', type: 'question',
          created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
          score: 1, matchCount: 1, relevantResults: [],
        }],
      }),
    });
    await screen.findByLabelText('Search result: Revenue', {}, { timeout: 3000 });

    // Typing again must swap the stale results for the spinner, not leave them
    // sitting there looking current.
    await userEvent.type(input, 'enue');
    expect(await screen.findByLabelText('Searching', {}, { timeout: 3000 })).toBeTruthy();
  });
});
