import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';

interface AuthUser {
  id: number;  // Required - every authenticated user has an ID
  email: string;
  name: string;
  role: UserRole;
  home_folder?: string;
  companyId: number;  // Required - enforced by withAuth middleware
  companyName?: string;
  mode: Mode;  // Mode parameter from URL (org, tutorial, etc.)
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
}

const initialState: AuthState = {
  user: null,
  loading: true,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<AuthUser | null>) => {
      state.user = action.payload;
      state.loading = false;
    },
    clearUser: (state) => {
      state.user = null;
      state.loading = false;
    },
    setAuthLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
  },
});

export const {
  setUser,
  clearUser,
  setAuthLoading,
} = authSlice.actions;

// Simplified selectors - effectiveUser is now just the user
export const selectEffectiveUser = (state: RootState) => state.auth.user;
export const selectCompanyName = (state: RootState) => state.auth.user?.companyName;

export default authSlice.reducer;
