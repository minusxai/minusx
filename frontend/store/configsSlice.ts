import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { OrgConfig, DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import { RootState } from './store';

export interface ConfigsState {
  config: OrgConfig;  // Never null - always has valid config
  loadedAt: number | null;
  // Server-side runtime env flag (DISABLE_APP_STATE_IMAGES), hydrated from SSR
  // preloadedState. When true, the client skips rendering/uploading the
  // auto-generated chart images attached to each new user message.
  disableAppStateImages: boolean;
  // Server-side runtime env (MAX_CONCURRENT_QUERIES), hydrated from SSR
  // preloadedState. Caps in-flight /api/query calls from the browser.
  maxConcurrentQueries: number;
}

const initialState: ConfigsState = {
  config: DEFAULT_CONFIG,  // Initialize with defaults
  loadedAt: null,
  disableAppStateImages: false,
  maxConcurrentQueries: 10,
};

const configsSlice = createSlice({
  name: 'configs',
  initialState,
  reducers: {
    setConfigs(state, action: PayloadAction<{ config: OrgConfig }>) {
      state.config = action.payload.config;
      state.loadedAt = Date.now();
    },
    clearConfigs(state) {
      state.config = DEFAULT_CONFIG;  // Reset to defaults, never null
      state.loadedAt = null;
    },
  },
});

export const { setConfigs, clearConfigs } = configsSlice.actions;
export default configsSlice.reducer;

// Selectors
export const selectConfig = (state: RootState) => state.configs.config;
export const selectBranding = (state: RootState) => state.configs.config.branding;
export const selectConfigsLoaded = (state: RootState) => state.configs.loadedAt !== null;
export const selectDisableAppStateImages = (state: RootState) => state.configs.disableAppStateImages;
export const selectMaxConcurrentQueries = (state: RootState) => state.configs.maxConcurrentQueries;
