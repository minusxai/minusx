/**
 * E2E Tests: GET/POST /api/configs
 *
 * TDD Blue → Red → Blue:
 *   Blue  — pass against current DocumentDB-in-route implementation
 *   Red   — fail after removing DocumentDB from the POST handler
 *   Blue  — pass once the handler delegates to FilesAPI
 */

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

jest.mock('next/cache', () => ({
  revalidateTag: jest.fn(),
  unstable_cache: jest.fn((fn: any) => fn),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { GET as configGetHandler, POST as configPostHandler } from '@/app/api/configs/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getConfig() {
  const req = new NextRequest('http://localhost:3000/api/configs', { method: 'GET' });
  return configGetHandler(req);
}

async function postConfig(body: object) {
  const req = new NextRequest('http://localhost:3000/api/configs', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return configPostHandler(req);
}

const VALID_BRANDING = {
  branding: {
    logoLight: '/logo.svg',
    logoDark: '/logo-dark.svg',
    displayName: 'Test Co',
    agentName: 'TestBot',
    favicon: '/favicon.ico',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/configs', () => {
  const dbPath = getTestDbPath('configs_e2e');

  beforeAll(async () => {
    await initTestDatabase(dbPath);
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  it('returns 200 with a config object (falls back to default when none stored)', async () => {
    const res = await getConfig();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveProperty('config');
  });
});

describe('POST /api/configs', () => {
  const dbPath = getTestDbPath('configs_e2e');

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    // /org/configs folder is created by initTestDatabase via workspace-template.json
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  it('returns 400 when branding is not an object', async () => {
    const res = await postConfig({ branding: 'not-an-object' });
    expect(res.status).toBe(400);
  });

  it('creates a new config document and returns the merged config', async () => {
    const res = await postConfig(VALID_BRANDING);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.config.branding.displayName).toBe('Test Co');
    expect(body.data.config.branding.agentName).toBe('TestBot');
  });

  it('updates an existing config via partial merge', async () => {
    const res = await postConfig({
      branding: {
        ...VALID_BRANDING.branding,
        displayName: 'Updated Co',
      },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.config.branding.displayName).toBe('Updated Co');
    // Unchanged fields preserved
    expect(body.data.config.branding.agentName).toBe('TestBot');
  });

  it('subsequent GET reflects the saved config', async () => {
    const res = await getConfig();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.config.branding.displayName).toBe('Updated Co');
  });
});
