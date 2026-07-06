/**
 * Regression: after a static (CSV/Sheets) upload is saved, the connection's
 * cached schema in Redux is empty + "fresh", so the context step's
 * useConnections skips the server fetch and the connection-loader never
 * re-introspects → "No tables found".
 *
 * The fix: StepStaticUpload force-reloads the connection (refresh) after the
 * publish, so the freshly-introspected schema lands in Redux before the
 * context step reads it.
 */

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
const { STATIC_ID } = vi.hoisted(() => ({ STATIC_ID: 555 }));

vi.mock('@/lib/file-state/file-state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/file-state/file-state')>('@/lib/file-state/file-state');
  return {
    ...actual,
    editFile: vi.fn(),
    publishFile: vi.fn(async () => ({ id: STATIC_ID, name: 'static' })),
    reloadFile: vi.fn(async () => {}),
  };
});

// useFileByPath / useFile resolve the static connection file — return a fixed
// fileState with one uploaded CSV file so the "Save & Continue" button enables.
vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFileByPath: () => ({ file: { fileState: { id: STATIC_ID } }, loading: false }),
  useFile: () => ({
    fileState: {
      id: STATIC_ID,
      content: { type: 'csv', config: { files: [{ schema_name: 'data', table_name: 'sales' }] } },
      persistableChanges: {},
    },
  }),
}));

// StaticConnectionConfig is heavy (file upload UI) — stub it.
vi.mock('@/components/views/connection-configs', () => {
  const React = require('react');
  return { StaticConnectionConfig: () => React.createElement('div', { 'aria-label': 'static config' }) };
});

// ─── Imports ──────────────────────────────────────────────────────────────────
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { setUser } from '@/store/authSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StepStaticUpload from '@/components/connection-wizard/steps/StepStaticUpload';
import { reloadFile } from '@/lib/file-state/file-state';

describe('StepStaticUpload — refresh schema after save', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
    store.dispatch(setUser({
      userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org',
    } as any));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('force-reloads the connection schema after publishing, before completing', async () => {
    const onComplete = vi.fn();

    renderWithProviders(
      <StepStaticUpload tab="csv" onComplete={onComplete} onBack={() => {}} />,
      { store },
    );

    await userEvent.click(await screen.findByLabelText('Save and continue'));

    // The connection schema must be re-introspected so the context step sees the
    // newly uploaded tables (not the stale empty cache).
    await waitFor(() => expect(reloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: STATIC_ID }),
    ));

    expect(onComplete).toHaveBeenCalledWith(STATIC_ID, 'static', ['data']);
  });
});
