/**
 * RTL render helper with minimal provider tree for UI tests.
 *
 * Uses the SAME store instance for both the Redux Provider and for any
 * utility code (loadFiles, publishFile, etc.) that calls getStore().
 * Callers should mock getStore() to return the same store via jest.spyOn:
 *
 *   import * as storeModule from '@/store/store';
 *   jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
 */

import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ChakraProvider } from '@chakra-ui/react';
import { makeStore } from '@/store/store';
import { system } from '@/lib/ui/theme';

type TestStore = ReturnType<typeof makeStore>;

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Pass the test store so Redux state is shared with getStore() */
  store?: TestStore;
}

/**
 * Render a React element wrapped in ReduxProvider + ChakraProvider.
 * Returns the store alongside all @testing-library/react query helpers.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  { store, ...renderOptions }: RenderWithProvidersOptions = {}
) {
  const testStore = store ?? makeStore();

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Provider store={testStore}>
        <ChakraProvider value={system}>
          {children}
        </ChakraProvider>
      </Provider>
    );
  }

  return {
    store: testStore,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
}
