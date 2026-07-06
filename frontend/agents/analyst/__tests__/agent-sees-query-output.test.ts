// DEDICATED guarantee: the agent SEES THE OUTPUT (real rows, not just a hash) of every query a
// story runs — an inline <Number> (bound to the story's :params), an inline <Question>, AND a
// referenced saved <Question id> — in ReadFiles, which IS the AppState. runQuery is mocked to echo
// the query + bound params back as a row, so the assertions prove BOTH visibility and that a story
// <Param> value flows into an inline <Number>'s SQL.
// readFilesServer executes via runQueryBounded now (bounded RAM). Echo the query+bound params back
// as one row, and add `truncated:false` so the bounded-result shape matches.
const echoRun = (_db: string, query: string, params: Record<string, unknown>) => {
  const row = { received_min_mrr: params.min_mrr ?? 'UNBOUND', kind: query.includes('SUM') ? 'inline_number' : 'other' };
  return { columns: Object.keys(row), types: ['VARCHAR', 'VARCHAR'], rows: [row], truncated: false };
};
vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (db: string, query: string, params: Record<string, unknown>) => echoRun(db, query, params)),
  runQueryBounded: vi.fn(async (db: string, query: string, params: Record<string, unknown>) => echoRun(db, query, params)),
}));

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FilesAPI } from '@/lib/data/files.server';
import { readFilesServer } from '@/lib/file-state/file-state.server';
import { TOOL_DEFAULT_LIMIT_CHARS } from '@/lib/chat/compress-augmented';
import { getQueryHash } from '@/lib/utils/query-hash';
import { numberToPlaceholder } from '@/lib/data/story-number';
import { inlineQuestionToPlaceholder } from '@/lib/data/story-question';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const dbPath = getTestDbPath('agent_sees_output');
const ADMIN: EffectiveUser = { userId: 1, email: 'a@a.com', name: 'A', role: 'admin', home_folder: '/org', mode: 'org' };
const FOLDER = '/org/sees-output';

beforeAll(async () => {
  await initTestDatabase(dbPath);
  await FilesAPI.createFile(
    { name: 'sees-output', path: FOLDER, type: 'folder', content: { description: '' } as never, references: [], options: { returnExisting: true } },
    ADMIN,
  );
});
afterAll(async () => { await cleanupTestDatabase(dbPath); });

describe('Agent sees query OUTPUT — inline (param-bound) + inline question + referenced, ReadFiles == AppState', () => {
  it('returns real rows for every embed, with the inline <Number> BOUND to the story :param', async () => {
    const saved = await FilesAPI.createFile(
      { name: 'saved-ref', path: `${FOLDER}/saved-ref`, type: 'question',
        content: { description: '', query: 'SELECT answer FROM ref_t', vizSettings: { type: 'table', xCols: [], yCols: [] }, parameters: [], connection_name: 'duck' } as never },
      ADMIN,
    );
    const numQuery = 'SELECT SUM(mrr) AS m FROM t WHERE mrr >= :min_mrr';   // references the story param
    const inlineQQuery = 'SELECT plan, count(*) AS c FROM subs GROUP BY 1';  // a plain inline question
    const body =
      `<div class="story">` +
      `<p>MRR ${numberToPlaceholder({ query: numQuery, connection: 'duck', col: 'm' })}</p>` +
      inlineQuestionToPlaceholder({ query: inlineQQuery, connection: 'duck', vizSettings: { type: 'table', yCols: ['c'] } }) +
      `<div data-question-id="${saved.data.id}"></div>` +
      `</div>`;
    const story = await FilesAPI.createFile(
      { name: 'sees-story', path: `${FOLDER}/sees-story`, type: 'story',
        content: { description: 'x', story: body, parameterValues: { min_mrr: 28000 } } as never, references: [saved.data.id] },
      ADMIN,
    );

    const out = await readFilesServer([story.data.id], ADMIN, { executeQueries: true, maxChars: TOOL_DEFAULT_LIMIT_CHARS });
    const qrs = out[0].queryResults as Array<{ id: string; data?: string; error?: string }>;
    const byId = Object.fromEntries(qrs.map((r) => [r.id, r]));

    // 1) inline <Number> — BOUND to the story param min_mrr=28000 (proves <Param> drives the number)
    const numId = getQueryHash(numQuery, { min_mrr: 28000 }, 'duck');
    expect(byId[numId], 'inline <Number> result must be present').toBeDefined();
    expect(byId[numId].error).toBeFalsy();
    expect(byId[numId].data).toContain('28000');     // the bound value reached the SQL and came back

    // 2) inline <Question> — its rows are visible too
    const qId = getQueryHash(inlineQQuery, {}, 'duck');
    expect(byId[qId], 'inline <Question> result must be present').toBeDefined();
    expect(byId[qId].error).toBeFalsy();

    // 3) referenced saved <Question id> — visible too
    const refId = getQueryHash('SELECT answer FROM ref_t', {}, 'duck');
    expect(byId[refId], 'referenced <Question> result must be present').toBeDefined();
    expect(byId[refId].error).toBeFalsy();

    // 4) ReadFiles output IS the AppState — same query-result set.
    const appState = await readFilesServer([story.data.id], ADMIN, { executeQueries: true, maxChars: TOOL_DEFAULT_LIMIT_CHARS });
    expect((appState[0].queryResults as Array<{ id: string }>).map((r) => r.id).sort()).toEqual(qrs.map((r) => r.id).sort());
  });
});
