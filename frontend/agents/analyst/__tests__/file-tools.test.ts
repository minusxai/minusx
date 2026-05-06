// Tests for ReadFiles + SearchFiles. Uses real PGLite via initTestDatabase to
// exercise the actual FilesAPI ACL and search ranking — not mocks.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AnalystAgentContext } from '../types';
import { ReadFiles, SearchFiles } from '../analyst-agent';
import {
  AnalystAgent,
  fauxRegistration,
} from '../analyst-agent';
import { runAgentTestSpec, type TestSpec } from '@/orchestrator/test-spec-runner';
import { FilesAPI } from '@/lib/data/files.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { QuestionContent, FolderContent } from '@/lib/types';
import {
  cleanupTestDatabase,
  getTestDbPath,
  initTestDatabase,
} from '@/store/__tests__/test-utils';

const dbPath = getTestDbPath('file_tools');

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

const RESTRICTED_VIEWER: EffectiveUser = {
  userId: 2,
  email: 'viewer@example.com',
  name: 'Sales Viewer',
  role: 'viewer',
  home_folder: '/org/sales',
  mode: 'org',
};

function makeQuestion(query = 'SELECT 1'): QuestionContent {
  return {
    description: '',
    query,
    vizSettings: { type: 'table', xCols: [], yCols: [] },
    parameters: [],
    connection_name: 'test',
  };
}

// All test files go under this isolated folder so we (a) satisfy
// `validateFileLocation` (questions must live in a subfolder of /org) and
// (b) don't collide with seed-data paths.
const TEST_FOLDER = '/org/file-tools-test';

beforeAll(async () => {
  await initTestDatabase(dbPath);
  await FilesAPI.createFile(
    {
      name: 'file-tools-test',
      path: TEST_FOLDER,
      type: 'folder',
      content: { description: '' } as FolderContent,
      references: [],
      options: { returnExisting: true },
    },
    ADMIN,
  );
});

afterAll(async () => {
  await cleanupTestDatabase(dbPath);
});

describe('ReadFiles', () => {
  it('loads files by id and returns their content', async () => {
    const created = await FilesAPI.createFile(
      { name: 'monthly-revenue', path: `${TEST_FOLDER}/monthly-revenue`, type: 'question', content: makeQuestion('SELECT SUM(total) FROM orders') },
      ADMIN,
    );
    // Save once so the file leaves draft state and is visible.
    // Files are created in draft state; that's fine — ReadFiles loads by ID regardless.

    const orch = new Orchestrator([]);
    const tool = new ReadFiles(orch, { fileIds: [created.data.id] }, {
      userId: '1',
      mode: 'org',
      effectiveUser: ADMIN,
    } as AnalystAgentContext);

    const res = await tool.run();
    expect(res.isError).toBe(false);
    const text = (res.content[0] as { text: string }).text;
    const parsed = JSON.parse(text) as Array<{ id: number; name: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(created.data.id);
    expect(parsed[0].name).toBe('monthly-revenue');
  });

  it('enforces ACL — restricted viewer cannot read a file outside their home folder', async () => {
    const created = await FilesAPI.createFile(
      { name: 'campaign-roi', path: `${TEST_FOLDER}/campaign-roi`, type: 'question', content: makeQuestion(), options: { returnExisting: true } },
      ADMIN,
    );
    // Files are created in draft state; that's fine — ReadFiles loads by ID regardless.

    const orch = new Orchestrator([]);
    const tool = new ReadFiles(orch, { fileIds: [created.data.id] }, {
      userId: '2',
      mode: 'org',
      effectiveUser: RESTRICTED_VIEWER,
    } as AnalystAgentContext);

    // FilesAPI.loadFiles silently filters out inaccessible files (no throw).
    // ACL enforcement: the restricted user gets back an empty array.
    const res = await tool.run();
    expect(res.isError).toBe(false);
    const parsed = JSON.parse((res.content[0] as { text: string }).text) as unknown[];
    expect(parsed).toHaveLength(0);
  });

  it('errors when effectiveUser is missing from context', async () => {
    const orch = new Orchestrator([]);
    const tool = new ReadFiles(orch, { fileIds: [1] }, {
      userId: '1',
      mode: 'org',
    } as AnalystAgentContext);

    const res = await tool.run();
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('requires effectiveUser');
  });
});

describe('SearchFiles', () => {
  let aId: number;
  let bId: number;
  let cId: number;

  beforeAll(async () => {
    // Publish each file (saveFile) so they leave draft state and become searchable.
    const a = await FilesAPI.createFile(
      { name: 'sf-aardvark', path: `${TEST_FOLDER}/sf-aardvark`, type: 'question', content: makeQuestion(), options: { returnExisting: true } },
      ADMIN,
    );
    aId = a.data.id;
    await FilesAPI.saveFile(a.data.id, a.data.name, a.data.path, a.data.content!, [], ADMIN);

    const b = await FilesAPI.createFile(
      { name: 'sf-blueberry', path: `${TEST_FOLDER}/sf-blueberry`, type: 'question', content: makeQuestion(), options: { returnExisting: true } },
      ADMIN,
    );
    bId = b.data.id;
    await FilesAPI.saveFile(b.data.id, b.data.name, b.data.path, b.data.content!, [], ADMIN);

    const c = await FilesAPI.createFile(
      { name: 'sf-coconut', path: `${TEST_FOLDER}/sf-coconut`, type: 'question', content: makeQuestion(), options: { returnExisting: true } },
      ADMIN,
    );
    cId = c.data.id;
    await FilesAPI.saveFile(c.data.id, c.data.name, c.data.path, c.data.content!, [], ADMIN);
  });

  it('returns matches for a free-text query', async () => {
    const orch = new Orchestrator([]);
    const tool = new SearchFiles(orch, { query: 'aardvark', folder_path: TEST_FOLDER }, {
      userId: '1',
      mode: 'org',
      effectiveUser: ADMIN,
    } as AnalystAgentContext);

    const res = await tool.run();
    expect(res.isError).toBe(false);
    const parsed = JSON.parse((res.content[0] as { text: string }).text) as { results: Array<{ id: number; name: string }> };
    expect(parsed.results.some((r) => r.id === aId)).toBe(true);
    expect(parsed.results.some((r) => r.id === bId)).toBe(false);
    expect(parsed.results.some((r) => r.id === cId)).toBe(false);
  });

  it('respects file_types filter', async () => {
    const orch = new Orchestrator([]);
    const tool = new SearchFiles(orch, { query: 'sf-', file_types: ['dashboard'] }, {
      userId: '1',
      mode: 'org',
      effectiveUser: ADMIN,
    } as AnalystAgentContext);

    const res = await tool.run();
    expect(res.isError).toBe(false);
    const parsed = JSON.parse((res.content[0] as { text: string }).text) as { results: Array<{ id: number }> };
    // None of the seeded files are dashboards
    expect(parsed.results.some((r) => [aId, bId, cId].includes(r.id))).toBe(false);
  });
});

describe('unknown-tool recovery for unregistered file ops', () => {
  it('LLM hallucinating EditFile gets a recoverable error and the agent recovers', async () => {
    const spec: TestSpec = {
      name: 'editfile_hallucination',
      agent: 'AnalystAgent',
      parameters: { userMessage: 'edit something' },
      context: {
        userId: 'u',
        mode: 'org',
        effectiveUser: ADMIN,
      },
      fauxResponses: [
        { type: 'toolUse', toolCalls: [{ name: 'EditFile', args: { fileId: 1, oldMatch: 'a', newMatch: 'b' } }] },
        { type: 'stop', text: 'I cannot edit files in this mode.' },
      ],
      assertions: [
        { kind: 'stopReached' },
        { kind: 'finalText', op: 'contains', value: 'cannot edit' },
      ],
    };

    const { failures, log, pass } = await runAgentTestSpec(
      spec,
      [ReadFiles, SearchFiles, AnalystAgent],
      (steps) => fauxRegistration.setResponses(steps),
    );

    const errorTrm = log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'EditFile',
    ) as { isError: boolean; content: Array<{ text: string }> } | undefined;
    expect(errorTrm).toBeDefined();
    expect(errorTrm!.isError).toBe(true);
    expect(errorTrm!.content[0].text).toContain("Unknown tool 'EditFile'");
    expect(pass).toBe(true);
    expect(failures).toEqual([]);
  });
});
