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
  // Server-side runtime env (QUERY_TIMEOUT_MS), hydrated from SSR preloadedState.
  // Wall-clock cap (ms) for a single /api/query call; bounds hung queries. 0 = off.
  queryTimeoutMs: number;
  // Org config `credits.enabled` (admin-editable, not an env var), hydrated from
  // SSR preloadedState. When false, the credits usage module is hidden throughout the UI.
  creditsEnabled: boolean;
  // Server-side runtime env (MX_EGRESS_IPS), hydrated from SSR preloadedState.
  // Source IPs a customer allows through their DB firewall. Empty on self-hosted,
  // where the egress address is the operator's own and no hint is shown.
  egressIps: string[];
}

const initialState: ConfigsState = {
  config: DEFAULT_CONFIG,  // Initialize with defaults
  loadedAt: null,
  disableAppStateImages: false,
  maxConcurrentQueries: 10,
  queryTimeoutMs: 120_000,
  creditsEnabled: false,
  egressIps: [],
};

const configsSlice = createSlice({
  name: 'configs',
  initialState,
  reducers: {
    setConfigs(state, action: PayloadAction<{ config: OrgConfig }>) {
      state.config = action.payload.config;
      state.loadedAt = Date.now();
    },
  },
});

export const { setConfigs } = configsSlice.actions;
export default configsSlice.reducer;

// Selectors
export const selectConfig = (state: RootState) => state.configs.config;
export const selectBranding = (state: RootState) => state.configs.config.branding;
export const selectConfigsLoaded = (state: RootState) => state.configs.loadedAt !== null;
export const selectDisableAppStateImages = (state: RootState) => state.configs.disableAppStateImages;
export const selectMaxConcurrentQueries = (state: RootState) => state.configs.maxConcurrentQueries;
export const selectQueryTimeoutMs = (state: RootState) => state.configs.queryTimeoutMs;
export const selectCreditsEnabled = (state: RootState) => state.configs.creditsEnabled;
export const selectEgressIps = (state: RootState) => state.configs.egressIps;
