/**
 * withColorModeOverride — the story iframe's chart stack reads `state.ui.colorMode` from Redux;
 * this store view pins it to the story's declared mode while everything else (state, dispatch,
 * subscriptions) stays live against the real store.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { makeStore } from '@/store/store';
import { setColorMode } from '@/store/uiSlice';
import { useAppSelector } from '@/store/hooks';
import { withColorModeOverride } from '@/store/color-mode-override';

function Probe() {
  const mode = useAppSelector(s => s.ui.colorMode);
  const files = useAppSelector(s => s.files);
  return <div aria-label="probe" data-files={files ? 'ok' : 'missing'}>{mode}</div>;
}

describe('withColorModeOverride', () => {
  it('pins ui.colorMode for consumers while the rest of state passes through', () => {
    const store = makeStore();
    act(() => { store.dispatch(setColorMode('dark')); });
    render(
      <Provider store={withColorModeOverride(store, 'light')}>
        <Probe />
      </Provider>,
    );
    expect(screen.getByLabelText('probe').textContent).toBe('light');
    expect(screen.getByLabelText('probe').getAttribute('data-files')).toBe('ok');
    // The real store is untouched.
    expect(store.getState().ui.colorMode).toBe('dark');
  });

  it('stays subscribed: unrelated dispatches flow through, colorMode stays pinned', () => {
    const store = makeStore();
    act(() => { store.dispatch(setColorMode('dark')); });
    render(
      <Provider store={withColorModeOverride(store, 'light')}>
        <Probe />
      </Provider>,
    );
    act(() => { store.dispatch(setColorMode('light')); });
    act(() => { store.dispatch(setColorMode('dark')); });
    expect(screen.getByLabelText('probe').textContent).toBe('light'); // still pinned
  });

  it('is the identity when no override is given', () => {
    const store = makeStore();
    expect(withColorModeOverride(store, undefined)).toBe(store);
  });
});
