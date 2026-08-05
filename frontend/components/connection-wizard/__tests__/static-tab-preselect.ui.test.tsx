// initialStaticTab must actually reach the connection step — that prop is the
// whole point of the installer's /new/connection?type= link, and a dropped prop
// would silently land people on the type picker instead of the upload screen.
//
// The assertion is "which branch of the connection step rendered", not the
// upload heading: StepStaticUpload shows a spinner until a static connection
// file loads, which needs DB fixtures this test deliberately does without.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ConnectionWizard from '@/components/connection-wizard/ConnectionWizard';

describe('ConnectionWizard initialStaticTab', () => {
  it('shows the connection type picker when no upload tab is preselected', async () => {
    renderWithProviders(<ConnectionWizard />);
    expect(await screen.findByLabelText('PostgreSQL')).toBeTruthy();
  });

  it('skips the type picker and goes straight to the upload step for sheets', async () => {
    renderWithProviders(<ConnectionWizard initialStaticTab="sheets" />);
    expect(screen.queryByLabelText('PostgreSQL')).toBeNull();
  });

  it('skips the type picker for csv too (the tab Excel also uses)', async () => {
    renderWithProviders(<ConnectionWizard initialStaticTab="csv" />);
    expect(screen.queryByLabelText('PostgreSQL')).toBeNull();
  });
});
