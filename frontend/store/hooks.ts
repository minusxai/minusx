import { TypedUseSelectorHook, useDispatch, useSelector, useStore } from 'react-redux';
import type { RootState, AppStore, AppDispatch } from './store';

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
// useAppStore: read store state on-demand inside callbacks/effects without
// subscribing to it. Use this when a value is only needed at click/submit time
// (e.g. queryResultsMap, colorMode for chart rendering on send) so a re-render
// of an unrelated slice doesn't tear through the parent component.
export const useAppStore = useStore as () => AppStore;
