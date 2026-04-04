/**
 * renderFilePage — render a file component with ViewStackOverlay available.
 *
 * The production layout (FileLayout) wraps file content in a position:relative
 * container and renders ViewStackOverlay as an absolute child. Tests that only
 * render DashboardContainerV2 directly miss this layer.
 *
 * This helper replicates that structural relationship without pulling in
 * FileLayout itself (which transitively imports Markdown.tsx, an ESM-only
 * package that Jest cannot transform).
 *
 * Usage:
 *   renderFilePage(<DashboardContainerV2 fileId={id} />, store);
 *   // ViewStackOverlay is now in the DOM — clicks that pushView() will render
 *   // the stack layer correctly.
 */

import React from 'react';
import { Box } from '@chakra-ui/react';
import { renderWithProviders } from './render-with-providers';
import ViewStackOverlay from '@/components/ViewStack';
import { makeStore } from '@/store/store';

type TestStore = ReturnType<typeof makeStore>;

export function renderFilePage(
  children: React.ReactElement,
  store: TestStore
) {
  return renderWithProviders(
    <Box position="relative" h="100vh" overflow="hidden">
      {children}
      <ViewStackOverlay />
    </Box>,
    { store }
  );
}
