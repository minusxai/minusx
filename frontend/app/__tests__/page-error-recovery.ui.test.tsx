/**
 * app/error.tsx wiring — the boundary must follow decideRecoveryAction instead
 * of unconditionally calling reset() in production. An unconditional reset()
 * makes any deterministic render error an infinite crash loop: the boundary
 * remounts, the effect fires, reset() re-renders the same broken tree, and the
 * tab spams capture-error once per dedup window forever. A stale tab can never
 * pick up a fixed deployment that way — only a hard reload can.
 *
 * The decision logic itself is unit-tested in lib/utils/__tests__/error-recovery.test.ts;
 * this test scripts the decisions and asserts the component wiring:
 *   'reset'    → calls reset()
 *   'reload'   → calls hardReload() (not reset)
 *   'fallback' → renders the manual-recovery UI; its button triggers hardReload()
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

// Production behavior: IS_DEV gates both error reporting and auto-recovery.
vi.mock('@/lib/constants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/constants')>('@/lib/constants');
  return { ...actual, IS_DEV: false, IS_TEST: false, SEND_ERRORS_IN_DEV: false };
});
vi.mock('@/lib/messaging/capture-error', () => ({ captureError: vi.fn(async () => {}) }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/utils/toast-helpers', () => ({ showAdminToast: vi.fn() }));
vi.mock('@/lib/utils/error-recovery', () => ({
  decideRecoveryAction: vi.fn(),
  hardReload: vi.fn(),
}));

import PageError from '@/app/error';
import { decideRecoveryAction, hardReload } from '@/lib/utils/error-recovery';
import { captureError } from '@/lib/messaging/capture-error';

const decideMock = vi.mocked(decideRecoveryAction);
const hardReloadMock = vi.mocked(hardReload);

describe('app/error.tsx recovery wiring (production)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls reset() when the decision is 'reset' and reports the error", async () => {
    decideMock.mockReturnValue('reset');
    const reset = vi.fn();
    renderWithProviders(<PageError error={new Error('boom')} reset={reset} />);

    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    expect(decideMock).toHaveBeenCalledWith('boom');
    expect(captureError).toHaveBeenCalledWith('page-error', expect.any(Error));
    expect(hardReloadMock).not.toHaveBeenCalled();
  });

  it("hard-reloads when the decision is 'reload' (stale tab picks up the fixed build)", async () => {
    decideMock.mockReturnValue('reload');
    const reset = vi.fn();
    renderWithProviders(<PageError error={new Error('boom')} reset={reset} />);

    await waitFor(() => expect(hardReloadMock).toHaveBeenCalledTimes(1));
    expect(reset).not.toHaveBeenCalled();
  });

  it("renders the manual fallback when the decision is 'fallback' and stops auto-recovering", async () => {
    decideMock.mockReturnValue('fallback');
    const reset = vi.fn();
    renderWithProviders(<PageError error={new Error('boom')} reset={reset} />);

    const reloadButton = await screen.findByLabelText('Reload page');
    expect(reset).not.toHaveBeenCalled();
    expect(hardReloadMock).not.toHaveBeenCalled();

    fireEvent.click(reloadButton);
    expect(hardReloadMock).toHaveBeenCalledTimes(1);
  });
});
