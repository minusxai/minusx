/**
 * Users State E2E Tests
 *
 * Tests the full stack: loadUsers() → fetch /api/users → Redux state.
 * Verifies:
 *   1. loadUsers() populates the users Redux slice
 *   2. Concurrent loadUsers() calls merge into a single HTTP request
 *   3. After a PUT, Redux is updated directly (no re-fetch)
 *   4. After a POST (create), Redux reflects the new user (no re-fetch)
 *   5. After a DELETE, Redux removes the user (no re-fetch)
 */

import { configureStore } from '@reduxjs/toolkit';
import { NextRequest } from 'next/server';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase, waitFor } from './test-utils';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { GET as usersGetHandler, POST as usersPostHandler } from '@/app/api/users/route';
import { PUT as userPutHandler, DELETE as userDeleteHandler } from '@/app/api/users/[id]/route';
import usersReducer, { selectUsers, selectUsersStatus } from '@/store/usersSlice';
import { loadUsers, setUsersInStore, _resetForTesting } from '@/lib/api/users-state';

// ---------------------------------------------------------------------------
// Jest module mocks — hoisted to top by Jest
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  const dbPath = path.join(process.cwd(), 'data', 'test_users_state.db');
  return {
    DB_PATH: dbPath,
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite',
  };
});

// Make users-state.ts use our test store
let testStore: any;
jest.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dbPath = getTestDbPath('users_state');
const ADMIN_SESSION = {
  user: { userId: 1, email: 'test@example.com', role: 'admin', companyId: 1 },
};

function makeTestStore() {
  return configureStore({ reducer: { users: usersReducer } });
}

function countGetUsersFetches(mockFetch: jest.Mock): number {
  return mockFetch.mock.calls.filter(([url, init]) => {
    const method = init?.method ?? 'GET';
    return String(url).includes('/api/users') &&
      !String(url).match(/\/api\/users\/\d+/) &&
      method === 'GET';
  }).length;
}

// ---------------------------------------------------------------------------
// Mock fetch: route /api/users calls to real Next.js handlers
// ---------------------------------------------------------------------------

const mockFetch = setupMockFetch({
  getPythonPort: () => 0,
  additionalInterceptors: [
    async (urlStr, init) => {
      const method = init?.method ?? 'GET';
      const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
      const isUsersId = /\/api\/users\/\d+/.test(urlStr);
      const isUsersList = urlStr.includes('/api/users') && !isUsersId;

      // GET /api/users
      if (isUsersList && method === 'GET') {
        const req = new NextRequest('http://localhost:3000/api/users', { method: 'GET' });
        const res = await usersGetHandler(req);
        return { ok: res.status < 400, status: res.status, json: async () => res.json() } as Response;
      }

      // POST /api/users
      if (isUsersList && method === 'POST') {
        const req = new NextRequest('http://localhost:3000/api/users', {
          method: 'POST',
          body: init?.body,
          headers: { 'Content-Type': 'application/json' },
        });
        const res = await usersPostHandler(req);
        return { ok: res.status < 400, status: res.status, json: async () => res.json() } as Response;
      }

      // PUT /api/users/[id]
      if (isUsersId && method === 'PUT') {
        const userId = String(urlStr.match(/\/api\/users\/(\d+)/)?.[1]);
        const req = new NextRequest(fullUrl, {
          method: 'PUT',
          body: init?.body,
          headers: { 'Content-Type': 'application/json' },
        });
        const res = await userPutHandler(req, { params: Promise.resolve({ id: userId }) });
        return { ok: res.status < 400, status: res.status, json: async () => res.json() } as Response;
      }

      // DELETE /api/users/[id]
      if (isUsersId && method === 'DELETE') {
        const userId = String(urlStr.match(/\/api\/users\/(\d+)/)?.[1]);
        const req = new NextRequest(fullUrl, { method: 'DELETE' });
        const res = await userDeleteHandler(req, { params: Promise.resolve({ id: userId }) });
        return { ok: res.status < 400, status: res.status, json: async () => res.json() } as Response;
      }

      return null;
    },
  ],
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Users state', () => {
  beforeAll(async () => {
    await initTestDatabase(dbPath);
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  beforeEach(() => {
    testStore = makeTestStore();
    _resetForTesting();

    // Configure auth() to return an admin session for the users route handlers
    const authMock = jest.requireMock('@/auth');
    authMock.auth.mockResolvedValue(ADMIN_SESSION);
  });

  // -------------------------------------------------------------------------
  // 1. loadUsers populates Redux state
  // -------------------------------------------------------------------------

  it('loadUsers fetches /api/users and populates Redux state', async () => {
    await loadUsers();

    const state = testStore.getState();
    expect(selectUsersStatus(state)).toBe('loaded');
    const users = selectUsers(state);
    expect(users.length).toBeGreaterThan(0);
    // The seed company always creates the admin user
    expect(users.some(u => u.email === 'test@example.com')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Concurrent calls merge into one HTTP request
  // -------------------------------------------------------------------------

  it('concurrent loadUsers calls issue only one HTTP request', async () => {
    // Fire two calls without awaiting either first
    const [users1, users2] = await Promise.all([loadUsers(), loadUsers()]);

    expect(users1).toEqual(users2);
    expect(countGetUsersFetches(mockFetch)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 3. setUsersInStore updates Redux without re-fetching
  // -------------------------------------------------------------------------

  it('setUsersInStore updates Redux state without issuing a fetch', async () => {
    await loadUsers();
    const fetchCountBefore = countGetUsersFetches(mockFetch);

    const users = selectUsers(testStore.getState());
    const updated = users.map((u, i) =>
      i === 0 ? { ...u, phone: '555-9999' } : u
    );
    setUsersInStore(updated);

    // No additional GET /api/users
    expect(countGetUsersFetches(mockFetch)).toBe(fetchCountBefore);

    // State reflects the change
    const newUsers = selectUsers(testStore.getState());
    expect(newUsers[0].phone).toBe('555-9999');
  });

  // -------------------------------------------------------------------------
  // 4. After POST (create), Redux is updated via setUsersInStore (no GET)
  // -------------------------------------------------------------------------

  it('creating a user via POST then setUsersInStore does not re-fetch', async () => {
    await loadUsers();
    const before = selectUsers(testStore.getState());
    const fetchCountBefore = countGetUsersFetches(mockFetch);

    // Simulate what UsersContent will do: call the API, then update store directly
    const res = await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'newuser@example.com',
        name: 'New User',
        role: 'viewer',
        home_folder: '',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { data } = await res.json();
    expect(res.ok).toBe(true);

    setUsersInStore([...before, data.user]);

    // No additional GET
    expect(countGetUsersFetches(mockFetch)).toBe(fetchCountBefore);

    const after = selectUsers(testStore.getState());
    expect(after.length).toBe(before.length + 1);
    expect(after.some(u => u.email === 'newuser@example.com')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. After PUT (update phone), Redux is updated via setUsersInStore (no GET)
  // -------------------------------------------------------------------------

  it('updating a user via PUT then setUsersInStore does not re-fetch', async () => {
    await loadUsers();
    const before = selectUsers(testStore.getState());
    const userId = before[0].id!;
    const fetchCountBefore = countGetUsersFetches(mockFetch);

    const res = await fetch(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ phone: '555-1234' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { data } = await res.json();
    expect(res.ok).toBe(true);
    expect(data.user.phone).toBe('555-1234');

    setUsersInStore(before.map(u => u.id === userId ? { ...u, ...data.user } : u));

    // No additional GET
    expect(countGetUsersFetches(mockFetch)).toBe(fetchCountBefore);

    const after = selectUsers(testStore.getState());
    expect(after.find(u => u.id === userId)?.phone).toBe('555-1234');
  });

  // -------------------------------------------------------------------------
  // 6. After DELETE, Redux is updated via setUsersInStore (no GET)
  // -------------------------------------------------------------------------

  it('deleting a user via DELETE then setUsersInStore does not re-fetch', async () => {
    // First add a second user so we can delete them (can't delete self)
    await loadUsers();
    const createRes = await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'todelete@example.com', name: 'To Delete', role: 'viewer', home_folder: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { data: createData } = await createRes.json();
    const newUser = createData.user;
    setUsersInStore([...selectUsers(testStore.getState()), newUser]);

    const before = selectUsers(testStore.getState());
    const fetchCountBefore = countGetUsersFetches(mockFetch);

    const res = await fetch(`/api/users/${newUser.id}`, { method: 'DELETE' });
    expect(res.ok).toBe(true);

    setUsersInStore(before.filter(u => u.id !== newUser.id));

    // No additional GET
    expect(countGetUsersFetches(mockFetch)).toBe(fetchCountBefore);

    const after = selectUsers(testStore.getState());
    expect(after.some(u => u.id === newUser.id)).toBe(false);
  });
});
