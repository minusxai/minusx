import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { CompanyConfig, DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import { RootState } from './store';

export interface ConfigsState {
  config: CompanyConfig;  // Never null - always has valid config
  loadedAt: number | null;
}

const initialState: ConfigsState = {
  config: DEFAULT_CONFIG,  // Initialize with defaults
  loadedAt: null,
};

const configsSlice = createSlice({
  name: 'configs',
  initialState,
  reducers: {
    setConfigs(state, action: PayloadAction<{ config: CompanyConfig }>) {
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
