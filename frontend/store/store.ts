import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import uiReducer from './uiSlice';
import filesReducer from './filesSlice';
import queryResultsReducer from './queryResultsSlice';
import configsReducer from './configsSlice';
import chatReducer from './chatSlice';
import recordingsReducer from './recordingsSlice';
import reportRunsReducer from './reportRunsSlice';
import alertRunsReducer from './alertRunsSlice';
import { chatListenerMiddleware } from './chatListener';
import { analyticsMiddleware } from '@/lib/analytics/middleware';

function getAllReducers() {
  return {
    auth: authReducer,
    ui: uiReducer,
    files: filesReducer,
    queryResults: queryResultsReducer,
    configs: configsReducer,
    chat: chatReducer,  // Orchestration API with automatic tool execution
    recordings: recordingsReducer,  // Session recording state
    reportRuns: reportRunsReducer,  // Report run state (runs list, selected run)
    alertRuns: alertRunsReducer,    // Alert run state (runs list, selected run)
  }
}

type ReducersMap = ReturnType<typeof getAllReducers>

type PreloadedState = {
  [K in keyof ReducersMap]: ReturnType<ReducersMap[K]>
}

// Store factory function that accepts preloadedState
export function makeStore(preloadedState?: PreloadedState) {
  return configureStore({
    reducer: getAllReducers(),
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware()
        .prepend(chatListenerMiddleware.middleware)
        .concat(analyticsMiddleware),
    ...(preloadedState && { preloadedState }),
  });
}

// Client-side singleton store
let clientStore: ReturnType<typeof makeStore> | undefined;

export function getOrCreateStore(preloadedState?: PreloadedState): ReturnType<typeof makeStore> {
  const isServer = typeof window === 'undefined';

  // Server-side: always create a new store per request
  if (isServer) {
    return makeStore(preloadedState);
  }

  // Client-side: create once with preloadedState, reuse thereafter
  if (!clientStore) {
    clientStore = makeStore(preloadedState);
  }

  return clientStore;
}

// For client-only code (like file-state.ts)
export function getStore(): ReturnType<typeof makeStore> {
  if (!clientStore) {
    clientStore = makeStore();
  }
  return clientStore;
}

export type RootState = ReturnType<ReturnType<typeof makeStore>['getState']>;
export type AppDispatch = ReturnType<typeof makeStore>['dispatch'];
