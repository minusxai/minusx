/**
 * ViewStack navigation cleanup — regression test for bug where editing a
 * question in a dashboard layers a question editor overlay, and navigating
 * away to another file kept the overlay visible.
 *
 * Root cause: viewStack in Redux was never cleared on navigation.
 * Fix: LayoutWrapper dispatches clearViewStack() whenever pathname changes.
 *
 * This test verifies the overlay disappears when the route changes.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must appear before any import statements
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_view_stack_navigation_ui.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
    DB_TYPE: 'sqlite',
  };
});

// Mutable so individual tests can simulate navigation by changing the path.
let mockPathname = '/f/2';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

// Stub heavy layout sub-components — not under test here.
jest.mock('@/components/Sidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/MobileBottomNav', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/lib/hooks/useRecordingContext', () => ({
  RecordingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import React from 'react';
import { Box } from '@chakra-ui/react';
import { screen, waitFor, act } from '@testing-library/react';

import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { pushView } from '@/store/uiSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ViewStackOverlay from '@/components/ViewStack';
import LayoutWrapper from '@/components/LayoutWrapper';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ViewStack navigation cleanup', () => {
  let testStore: ReturnType<typeof makeStore>;

  beforeEach(() => {
    testStore = makeStore();
    jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    mockPathname = '/f/2';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the question edit overlay when a view is pushed', async () => {
    renderWithProviders(
      <LayoutWrapper>
        <Box position="relative" h="100vh">
          <ViewStackOverlay />
        </Box>
      </LayoutWrapper>,
      { store: testStore }
    );

    // No overlay initially
    expect(screen.queryByLabelText('Content stack')).not.toBeInTheDocument();

    // Simulate user clicking "Edit" on a dashboard question
    act(() => {
      testStore.dispatch(pushView({ type: 'question', fileId: 3 }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Content stack')).toBeInTheDocument();
    });
  });

  it('clears the overlay when navigating to a different page', async () => {
    const { rerender } = renderWithProviders(
      <LayoutWrapper>
        <Box position="relative" h="100vh">
          <ViewStackOverlay />
        </Box>
      </LayoutWrapper>,
      { store: testStore }
    );

    // Push a question edit overlay (simulates editing a question inside a dashboard)
    act(() => {
      testStore.dispatch(pushView({ type: 'question', fileId: 3 }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Content stack')).toBeInTheDocument();
    });

    // Simulate navigating to a different file (e.g. home → another file)
    mockPathname = '/p/org';
    rerender(
      <LayoutWrapper>
        <Box position="relative" h="100vh">
          <ViewStackOverlay />
        </Box>
      </LayoutWrapper>
    );

    // Overlay must disappear — the question editor from the previous dashboard
    // should not bleed through to the new page.
    await waitFor(() => {
      expect(screen.queryByLabelText('Content stack')).not.toBeInTheDocument();
    });
  });
});
