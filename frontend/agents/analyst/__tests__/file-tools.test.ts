// Tests for ReadFiles + SearchFiles. Uses real PGLite via initTestDatabase to
// exercise the actual FilesAPI ACL and search ranking — not mocks.

import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AnalystAgentContext } from '../types';
import { ReadFiles, SearchFiles } from '../analyst-agent';
import {
  RemoteAnalystAgent,
  fauxRegistration,
} from '../analyst-agent';
import { runAgentTestSpec, type TestSpec } from '@/orchestrator/__tests__/support/test-spec-runner';
import { FilesAPI } from '@/lib/data/files.server';
import { readFilesServer } from '@/lib/file-state/file-state.server';
import { TOOL_DEFAULT_LIMIT_CHARS, stripAugmentedContentForLlm } from '@/lib/chat/compress-augmented';
import { takeFilesMarkup } from '@/lib/chat/markup-blocks';
import { getQueryHash } from '@/lib/utils/query-hash';
import { inlineQuestionToPlaceholder } from '@/lib/data/story/story-question';
import { numberToPlaceholder } from '@/lib/data/story/story-number';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { QuestionContent, FolderContent, DocumentContent, CompressedAugmentedFile, ReadFilesResult } from '@/lib/types';
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
    // Unified shape: { success, files: CompressedAugmentedFile[] } — same as AppState
    // and the frontend-bridge ReadFiles (content lives under fileState).
    const parsed = JSON.parse(text) as { success: boolean; files: CompressedAugmentedFile[] };
    expect(parsed.success).toBe(true);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].fileState.id).toBe(created.data.id);
    expect(parsed.files[0].fileState.name).toBe('monthly-revenue');
  });

  it('emits the SAME CompressedAugmentedFile shape as AppState, including resolved references', async () => {
    // A dashboard referencing a question exercises the effective-reference path —
    // the interesting case where shapes could diverge.
    const q = await FilesAPI.createFile(
      { name: 'parity-q', path: `${TEST_FOLDER}/parity-q`, type: 'question', content: makeQuestion('SELECT 1') },
      ADMIN,
    );
    const dashContent = {
      description: 'parity dashboard',
      assets: [{ type: 'question', id: q.data.id }],
      layout: null,
      parameterValues: null,
    } as unknown as DocumentContent;
    const dash = await FilesAPI.createFile(
      { name: 'parity-dash', path: `${TEST_FOLDER}/parity-dash`, type: 'dashboard', content: dashContent, references: [q.data.id] },
      ADMIN,
    );

    const orch = new Orchestrator([]);
    const tool = new ReadFiles(orch, { fileIds: [dash.data.id] }, {
      userId: '1', mode: 'org', effectiveUser: ADMIN,
    } as AnalystAgentContext);
    const res = await tool.run();
    const out = JSON.parse((res.content[0] as { text: string }).text) as ReadFilesResult;

    // 1) Unified CompressedAugmentedFile contract — exactly the AppState `file` payload keys.
    expect(out.success).toBe(true);
    expect(out.files).toHaveLength(1);
    const f = out.files[0];
    expect(Object.keys(f).sort()).toEqual(['fileState', 'queryResults', 'references']);
    expect(f.fileState.id).toBe(dash.data.id);
    expect(f.fileState.type).toBe('dashboard');
    // 2) The referenced question is resolved into `references` (effective-ref path).
    expect(f.references).toHaveLength(1);
    expect(f.references[0].id).toBe(q.data.id);

    // 3) Identical to the certified app-state-equivalent server builder, minus the JSON
    //    `content` (the agent reads `markup`; ReadFiles strips the duplicate content).
    //    Transitive guarantee: file-state-server-parity.test.ts proves
    //    readFilesServer === compressAugmentedFile(selectAugmentedFiles(...)) (live AppState),
    //    so tool output === stripContent(readFilesServer) === stripped live AppState.
    const appState = await readFilesServer([dash.data.id], ADMIN, { maxChars: TOOL_DEFAULT_LIMIT_CHARS });
    const { files: expectedFiles } = takeFilesMarkup(appState.map(stripAugmentedContentForLlm));
    expect(out.files).toEqual(expectedFiles);
    // markup is NO LONGER stringified into the JSON — it's pulled out into a separate raw block.
    expect(out.files[0].fileState.markup).toBeUndefined();
    expect(out.files[0].fileState.content).toBeUndefined();
    // The raw <file_markup> block is a SECOND content block — real JSX, never escaped JSON.
    const markupBlock = (res.content[1] as { text: string }).text;
    expect(markupBlock).toContain(`<file_markup file_id="${dash.data.id}" type="dashboard">`);
    expect(markupBlock).not.toContain('\\n');
  });

  it('runs a story\'s INLINE questions and includes their query results (live numbers for the agent)', async () => {
    const inlineQuery = 'SELECT 42 AS answer';
    const body = `<div class="story"><h1>KPI</h1>${inlineQuestionToPlaceholder({ query: inlineQuery, connection: 'test', vizSettings: { type: 'single_value', yCols: ['answer'] } })}</div>`;
    const story = await FilesAPI.createFile(
      { name: 'inline-kpi-story', path: `${TEST_FOLDER}/inline-kpi-story`, type: 'story', content: { description: 'x', story: body } as unknown as DocumentContent },
      ADMIN,
    );

    const out = await readFilesServer([story.data.id], ADMIN, { executeQueries: true, maxChars: TOOL_DEFAULT_LIMIT_CHARS });
    // The inline question (no saved file, no reference) was executed and its result attached,
    // keyed by the SAME query hash the client cache uses. Previously inline questions were skipped.
    const expectedId = getQueryHash(inlineQuery, {}, 'test');
    const ids = out[0].queryResults.map(r => r.id);
    expect(ids).toContain(expectedId);
  });

  it("runs a story's INLINE <Number> embeds and includes their results (live inline numbers for the agent)", async () => {
    // A <Number query=…> figure in the prose is a query the agent must SEE the result of —
    // same guarantee as an inline <Question>. Previously inline numbers were not executed,
    // so the agent edited them blind (no data, and crucially no parser ERROR feedback).
    const numberQuery = 'SELECT 7 AS n';
    const body = `<div class="story"><p>MRR is ${numberToPlaceholder({ query: numberQuery, connection: 'test', col: 'n', prefix: '$' })} today.</p></div>`;
    const story = await FilesAPI.createFile(
      { name: 'inline-number-story', path: `${TEST_FOLDER}/inline-number-story`, type: 'story', content: { description: 'x', story: body } as unknown as DocumentContent },
      ADMIN,
    );

    const out = await readFilesServer([story.data.id], ADMIN, { executeQueries: true, maxChars: TOOL_DEFAULT_LIMIT_CHARS });
    // Keyed by the SAME hash (params {}, matching the InlineNumber renderer + EditFile auto-execute).
    const expectedId = getQueryHash(numberQuery, {}, 'test');
    expect(out[0].queryResults.map(r => r.id)).toContain(expectedId);
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
    const parsed = JSON.parse((res.content[0] as { text: string }).text) as { success: boolean; files: unknown[] };
    expect(parsed.files).toHaveLength(0);
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
      [ReadFiles, SearchFiles, RemoteAnalystAgent],
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
