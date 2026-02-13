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

// Default singleton store for non-SSR contexts
export const store = makeStore();

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
