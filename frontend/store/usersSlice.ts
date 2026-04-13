import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { User } from '@/lib/types';

export interface UsersState {
  users: User[];
  status: 'idle' | 'loading' | 'loaded';
}

const initialState: UsersState = {
  users: [],
  status: 'idle',
};

const usersSlice = createSlice({
  name: 'users',
  initialState,
  reducers: {
    setUsers(state, action: PayloadAction<User[]>) {
      state.users = action.payload;
      state.status = 'loaded';
    },
    setUsersLoading(state) {
      state.status = 'loading';
    },
  },
});

export const { setUsers, setUsersLoading } = usersSlice.actions;
export default usersSlice.reducer;

export const selectUsers = (state: RootState) => state.users.users;
export const selectUsersStatus = (state: RootState) => state.users.status;
