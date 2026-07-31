import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataLoader } from '@/components/app-shell/DataLoader';
import { makeStore } from '@/store/store';
import {
  setLeftSidebarCollapsed,
  setRightSidebarCollapsed,
  toggleLeftSidebar,
} from '@/store/uiSlice';

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({}),
}));

vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({}),
}));

vi.mock('@/lib/hooks/useContexts', () => ({
  useContexts: () => ({}),
}));

describe('sidebar persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores every left and right sidebar state change', () => {
    const store = makeStore();

    store.dispatch(setLeftSidebarCollapsed(true));
    expect(window.localStorage.getItem('leftSidebarCollapsed')).toBe('true');

    store.dispatch(toggleLeftSidebar());
    expect(window.localStorage.getItem('leftSidebarCollapsed')).toBe('false');

    store.dispatch(setRightSidebarCollapsed(false));
    expect(window.localStorage.getItem('rightSidebarCollapsed')).toBe('false');
    expect(window.localStorage.getItem('leftSidebarCollapsed')).toBe('true');

    store.dispatch(setRightSidebarCollapsed(true));
    expect(window.localStorage.getItem('rightSidebarCollapsed')).toBe('true');
  });

  it('restores both sidebar states from localStorage', async () => {
    window.localStorage.setItem('leftSidebarCollapsed', 'true');
    window.localStorage.setItem('rightSidebarCollapsed', 'false');
    const store = makeStore();

    render(
      <Provider store={store}>
        <DataLoader />
      </Provider>,
    );

    await waitFor(() => {
      expect(store.getState().ui.leftSidebarCollapsed).toBe(true);
      expect(store.getState().ui.rightSidebarCollapsed).toBe(false);
    });
  });

  it('starts closed and ignores invalid stored values', async () => {
    window.localStorage.setItem('leftSidebarCollapsed', 'collapsed');
    window.localStorage.setItem('rightSidebarCollapsed', 'open');
    const store = makeStore();

    render(
      <Provider store={store}>
        <DataLoader />
      </Provider>,
    );

    await waitFor(() => {
      expect(store.getState().ui.leftSidebarCollapsed).toBe(true);
      expect(store.getState().ui.rightSidebarCollapsed).toBe(true);
    });
  });
});
