/**
 * FileSearchBar UI tests
 *
 * Scenarios:
 *   1. When the search API fails, the dropdown shows a "Search failed" row
 *      instead of staying completely inert.
 *   2. A result whose type is missing from FILE_TYPE_METADATA renders with a
 *      fallback icon instead of crashing the whole dropdown.
 *
 * All element queries use aria-label (getByLabelText/findByLabelText) only.
 */
import React from 'react';
import { screen } from '@testing-library/react';
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
});
