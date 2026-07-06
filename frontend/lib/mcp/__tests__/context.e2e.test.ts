/**
 * E2E Tests: MCP context impersonation
 *
 * Drives a real MCP Client against the server (over the SDK's in-memory transport)
 * to verify that an MCP session impersonates the connecting user's context:
 *   - Default Context Docs (alwaysInclude) + Schema Notes are baked into the
 *     server `instructions`.
 *   - The on-demand Context Library is exposed via the LoadContext tool, which
 *     resolves a doc key to its full body.
 *
 * The shared key/title resolution itself is unit-tested in
 * lib/sql/__tests__/resolve-context-docs.test.ts (loadContextDocsByKeys); this
 * pins the MCP wiring on top of it.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must come before any imports
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { createMcpServer } from '@/lib/mcp/server';
import { INLINE_ALL_DOCS_THRESHOLD } from '@/lib/sql/context-docs';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_PATH = getTestDbPath('mcp_context');

const TEST_USER: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

const PINNED_MARKER = 'PINNED_BODY_a1b2';
const GLOSSARY_MARKER = 'GLOSSARY_BODY_c3d4';

/** Connect a real MCP Client to a per-user server over the in-memory transport. */
async function connectClient(user: EffectiveUser): Promise<Client> {
  const server = await createMcpServer(user);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await initTestDatabase(DB_PATH);

  // Write docs into the user's home-folder context (/org/context, seeded by the
  // template) — this is the one buildServerAgentArgs resolves as nearest to /org,
  // so it exercises the real "no context pointer → home-folder default" path.
  const ctxFile = await FilesAPI.loadFileByPath('/org/context', TEST_USER);
  const ctxContent: ContextContent = {
    ...(ctxFile.data.content as ContextContent),
    published: { all: 1 },
    versions: [{
      version: 1,
      whitelist: '*',
      docs: [
        { title: 'Pinned Rules', description: 'always on', content: PINNED_MARKER, alwaysInclude: true, draft: false },
        { title: 'Revenue Glossary', description: 'how revenue maps to columns', content: GLOSSARY_MARKER, draft: false },
        // Pad past INLINE_ALL_DOCS_THRESHOLD so lazy docs stay in the catalog
        // instead of being inlined wholesale (small-context optimization).
        ...Array.from({ length: Math.max(0, INLINE_ALL_DOCS_THRESHOLD - 2) }, (_, i) => ({
          title: `Filler ${i}`, description: 'x', content: `FILLER_MARKER_${i}`, draft: false,
        })),
      ],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    }],
  };
  await DocumentDB.update(ctxFile.data.id, ctxFile.data.name, '/org/context', ctxContent, [], 'seed-mcp-context');
}, 30000);

afterAll(async () => {
  await cleanupTestDatabase(DB_PATH);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP context impersonation', () => {
  it('bakes the Default Context Docs into the server instructions (catalog key, not the library body)', async () => {
    const client = await connectClient(TEST_USER);
    const instructions = client.getInstructions() ?? '';

    // Pinned doc body is inline; the lazy doc is advertised by key only.
    expect(instructions).toContain(PINNED_MARKER);
    expect(instructions).toContain('revenue_glossary');
    expect(instructions).not.toContain(GLOSSARY_MARKER);
    await client.close();
  });

  it('exposes LoadContext alongside the read/search tools', async () => {
    const client = await connectClient(TEST_USER);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('LoadContext');
    // Sanity: the existing data tools are still registered.
    expect(names).toContain('SearchDBSchema');
    expect(names).toContain('ExecuteQuery');
    await client.close();
  });

  it('LoadContext resolves a library key to its full body', async () => {
    const client = await connectClient(TEST_USER);
    const res = await client.callTool({ name: 'LoadContext', arguments: { keys: ['revenue_glossary'] } });
    const text = (res.content as Array<{ type: string; text: string }>)[0].text;
    const payload = JSON.parse(text) as { success: boolean; docs: { key: string; content: string }[] };
    expect(payload.success).toBe(true);
    expect(payload.docs[0].key).toBe('revenue_glossary');
    expect(payload.docs[0].content).toContain(GLOSSARY_MARKER);
    await client.close();
  });
});
