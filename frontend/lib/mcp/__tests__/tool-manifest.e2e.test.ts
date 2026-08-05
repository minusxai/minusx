/**
 * The OAuth consent screen names the tools an MCP client is about to be granted, and it must name
 * the ones the client actually gets.
 *
 * It used to keep its own hand-typed array of five names. `LoadContext` was added to `server.ts`
 * later and the array was never revisited, so every user with a Context Library approved a grant
 * described as five tools and received six — the missing one being the tool that reads their
 * documents.
 *
 * `lib/mcp/tool-manifest.ts` fixes the *spelling* half of that: both sides now reference
 * `MCP_TOOL.X` instead of typing a string, so a rename cannot land on one side only. What a shared
 * constant cannot see is a tool declared in the manifest and registered nowhere, or registered
 * under a name the manifest never lists. That needs someone to ask a running server what it
 * advertises, which is what this does — over the SDK's in-memory transport, with a real client.
 *
 * `LoadContext` is conditional (registered only when the user's context has on-demand docs), so
 * both branches are pinned: the manifest's `conditional` flag has to describe reality, or the
 * consent screen is wrong again in the other direction.
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
import { MCP_TOOLS, MCP_ALWAYS_REGISTERED_TOOLS } from '@/lib/mcp/tool-manifest';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent, ContextVersion } from '@/lib/types';

type ContextDoc = ContextVersion['docs'][number];

const DB_PATH = getTestDbPath('mcp_tool_manifest');

const TEST_USER: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

/** Ask a real server, through a real client, which tools it advertises. */
async function advertisedTools(user: EffectiveUser): Promise<string[]> {
  const server = await createMcpServer(user);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'manifest-test-client', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const names = (await client.listTools()).tools.map((t) => t.name);
  await client.close();
  return names;
}

/**
 * Replace the docs on the user's home-folder context — the one `buildServerAgentArgs` resolves.
 *
 * `editId` must differ per call: `DocumentDB.update` treats a repeat of the last edit id as an
 * already-applied write and returns without touching the row, so a fixed id makes the second
 * seed a silent no-op and the test asserts against the first seed's data.
 */
async function setContextDocs(docs: ContextDoc[], editId: string): Promise<void> {
  const ctxFile = await FilesAPI.loadFileByPath('/org/context', TEST_USER);
  const content: ContextContent = {
    ...(ctxFile.data.content as ContextContent),
    published: { all: 1 },
    versions: [{
      version: 1,
      whitelist: '*',
      docs,
      createdAt: new Date().toISOString(),
      createdBy: 1,
    }],
  };
  await DocumentDB.update(ctxFile.data.id, ctxFile.data.name, '/org/context', content, [], editId);
}

beforeAll(async () => {
  await initTestDatabase(DB_PATH);
}, 30000);

afterAll(async () => {
  await cleanupTestDatabase(DB_PATH);
});

describe('MCP tool manifest', () => {
  it('advertises exactly the manifest when every conditional tool applies', async () => {
    // Pad past INLINE_ALL_DOCS_THRESHOLD so the lazy docs stay in the catalog rather than being
    // inlined wholesale — that small-context optimization is what makes LoadContext unnecessary.
    await setContextDocs([
      { title: 'Pinned Rules', description: 'always on', content: 'PINNED', alwaysInclude: true, draft: false },
      ...Array.from({ length: INLINE_ALL_DOCS_THRESHOLD }, (_, i) => ({
        title: `Lazy ${i}`, description: 'x', content: `LAZY_${i}`, draft: false,
      })),
    ], 'seed-lazy-docs');

    const names = await advertisedTools(TEST_USER);

    expect(names.sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });

  it('advertises exactly the unconditional tools when no conditional one applies', async () => {
    // Every doc pinned → nothing left to load on demand → server registers no LoadContext.
    await setContextDocs([
      { title: 'Pinned Rules', description: 'always on', content: 'PINNED', alwaysInclude: true, draft: false },
    ], 'seed-pinned-only');

    const names = await advertisedTools(TEST_USER);

    expect(names.sort()).toEqual([...MCP_ALWAYS_REGISTERED_TOOLS].sort());
  });

  it('marks a tool conditional only if it is genuinely absent for some user', async () => {
    // Guards the flag itself: marking a tool conditional when it always registers would understate
    // nothing, but it would let a future always-on tool be dropped from the unconditional set
    // without any test noticing.
    const conditional = MCP_TOOLS.filter((t) => t.conditional).map((t) => t.name);
    const namesWithoutContext = await advertisedTools(TEST_USER); // still the pinned-only context

    for (const name of conditional) {
      expect(namesWithoutContext).not.toContain(name);
    }
    expect(conditional.length).toBeGreaterThan(0);
  });
});
