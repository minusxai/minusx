/**
 * DatabaseSelector — the compact icon+check treatment is ONLY for the
 * unambiguous single-connection case. With more than one connection the active
 * database must stay legible at all times (a collapsed icon makes it easy to
 * miss that a query is running against the wrong connection), so it falls back
 * to the full labeled dropdown even when `compact` is requested.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

const mockConnections = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ connections: mockConnections.value, loading: false, error: null }),
}));

import DatabaseSelector from '@/components/selectors/DatabaseSelector';

function conn(name: string, type = 'duckdb') {
  return { metadata: { name, type, config: {}, created_at: '', updated_at: '' }, schema: null };
}

describe('DatabaseSelector — compact collapses only for a single connection', () => {
  it('with multiple connections it stays a full labeled dropdown (name always visible)', async () => {
    mockConnections.value = { warehouse: conn('warehouse'), analytics: conn('analytics') };
    const user = userEvent.setup();
    renderWithProviders(<DatabaseSelector value="warehouse" onChange={vi.fn()} compact />);

    const trigger = screen.getByLabelText('Database selector');
    // Full dropdown: the active connection name shows in the trigger, WITHOUT the
    // compact "Database: …" prefix (which the collapsed icon pill would use).
    expect(trigger).toHaveTextContent('warehouse');
    expect(trigger).not.toHaveTextContent('Database:');

    // And it's a working dropdown listing every connection.
    await user.click(trigger);
    expect(screen.getByText('analytics')).toBeTruthy();
  });

  it('with a single connection it collapses to the compact icon indicator', () => {
    mockConnections.value = { warehouse: conn('warehouse') };
    renderWithProviders(<DatabaseSelector value="warehouse" onChange={vi.fn()} compact />);

    // Compact pill: labeled for a11y and using the "Database: …" compact prefix.
    expect(screen.getByLabelText('Database selector')).toHaveTextContent('Database:');
  });
});
