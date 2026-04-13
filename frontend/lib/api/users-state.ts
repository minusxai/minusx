import { getStore } from '@/store/store';
import { setUsers, setUsersLoading } from '@/store/usersSlice';
import type { User } from '@/lib/types';

// In-flight promise for request merging: if loadUsers() is called while a
// fetch is already pending, the same promise is returned instead of issuing
// a second HTTP request.
let inFlightRequest: Promise<User[]> | null = null;

/**
 * Fetch /api/users and populate Redux state.
 * Concurrent calls are merged: only one HTTP request is issued regardless of
 * how many callers invoke this simultaneously.
 */
export async function loadUsers(): Promise<User[]> {
  if (inFlightRequest) {
    return inFlightRequest;
  }

  getStore().dispatch(setUsersLoading());

  inFlightRequest = fetch('/api/users')
    .then(async res => {
      const json = await res.json();
      const users: User[] = json?.data?.users ?? [];
      getStore().dispatch(setUsers(users));
      return users;
    })
    .finally(() => {
      inFlightRequest = null;
    });

  return inFlightRequest;
}

/**
 * Write a user list directly into Redux state without fetching.
 * Use this after mutations (create / update / delete) to keep the store
 * current using the data the API already returned — no extra GET needed.
 */
export function setUsersInStore(users: User[]): void {
  getStore().dispatch(setUsers(users));
}

/**
 * Reset in-flight request state. Only for use in tests.
 */
export function _resetForTesting(): void {
  inFlightRequest = null;
}
