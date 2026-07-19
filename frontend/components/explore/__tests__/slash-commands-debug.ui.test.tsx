// /debug slash command — visible only to admins with dev mode on; executing it
// fires the onDebugViz callback (which opens the conversation debug modal).
import { renderHook } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { makeStore } from '@/store/store';
import { useSlashCommands, tryExecuteSlashCommand } from '../slash-commands';
import { setUser } from '@/store/authSlice';
import { setDevMode } from '@/store/uiSlice';

vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function hook(role: 'admin' | 'user', devMode: boolean, onDebugViz?: () => void) {
  const store = makeStore();
  store.dispatch(setUser({ email: 'x@y.z', role, home_folder: '' } as never));
  store.dispatch(setDevMode(devMode));
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(() => useSlashCommands({ container: 'sidebar', onDebugViz }), { wrapper });
}

describe('/debug slash command', () => {
  it('is available to admins with dev mode on', () => {
    const { result } = hook('admin', true);
    expect(result.current.availableCommands.some((c) => c.name === 'debug')).toBe(true);
  });

  it('is hidden for non-admins', () => {
    const { result } = hook('user', true);
    expect(result.current.availableCommands.some((c) => c.name === 'debug')).toBe(false);
  });

  it('is hidden when dev mode is off', () => {
    const { result } = hook('admin', false);
    expect(result.current.availableCommands.some((c) => c.name === 'debug')).toBe(false);
  });

  it('fires onDebugViz when executed via /debug', () => {
    const onDebugViz = vi.fn();
    const { result } = hook('admin', true, onDebugViz);
    const handled = tryExecuteSlashCommand('/debug', result.current.availableCommands, result.current.handleCommandExecute);
    expect(handled).toBe(true);
    expect(onDebugViz).toHaveBeenCalled();
  });
});
