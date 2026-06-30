/**
 * SECURITY: a public-share guest can only execute queries that are embedded in
 * the page they're viewing — never arbitrary SQL. Covers every file type's
 * embed extraction (question, story inline + saved ref, notebook cell, dashboard
 * asset) and the connection-swap attempt.
 */
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FilesAPI } from '@/lib/data/files.server';
import { assertGuestQueryAllowed, GuestQueryDeniedError } from '../guest-query.server';
import { inlineQuestionToPlaceholder } from '@/lib/data/story-question';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const dbPath = getTestDbPath('guest_query_authz');
const ADMIN: EffectiveUser = { userId: 1, email: 'a@a.com', name: 'A', role: 'admin', home_folder: '/org', mode: 'org' };
// A guest viewer pinned to the shared folder (home_folder resolves to /org/share).
const GUEST: EffectiveUser = {
  userId: -1001, email: 'g@anon.share', name: 'Guest', role: 'viewer', home_folder: 'share', mode: 'org',
  guest: { canChat: false, shareFileId: 0, nonce: 'n' },
};
const FOLDER = '/org/share';

const SAVED_Q = "SELECT answer FROM ref_t";
const INLINE_Q = "SELECT plan, count(*) AS c FROM subs GROUP BY 1";
const NB_CELL_Q = "SELECT 1 AS one";
const DASH_Q = "SELECT region, sum(x) FROM sales GROUP BY 1";

let storyPath = '';
let questionPath = '';
let notebookPath = '';
let dashboardPath = '';

beforeAll(async () => {
  await initTestDatabase(dbPath);
  await FilesAPI.createFile({ name: 'share', path: FOLDER, type: 'folder', content: { description: '' } as never, references: [], options: { returnExisting: true } }, ADMIN);

  const saved = await FilesAPI.createFile({
    name: 'saved-q', path: `${FOLDER}/saved-q`, type: 'question',
    content: { description: '', query: SAVED_Q, vizSettings: { type: 'table', xCols: [], yCols: [] }, parameters: [], connection_name: 'duck' } as never,
  }, ADMIN);
  questionPath = `${FOLDER}/saved-q`;

  // Story: an INLINE question embed + a SAVED question reference.
  const storyBody = `<div class="story">` +
    inlineQuestionToPlaceholder({ query: INLINE_Q, connection: 'duck', vizSettings: { type: 'table', yCols: ['c'] } }) +
    `<div data-question-id="${saved.data.id}"></div></div>`;
  await FilesAPI.createFile({
    name: 'story', path: `${FOLDER}/story`, type: 'story',
    content: { description: 'x', story: storyBody, parameterValues: {} } as never, references: [saved.data.id],
  }, ADMIN);
  storyPath = `${FOLDER}/story`;

  await FilesAPI.createFile({
    name: 'nb', path: `${FOLDER}/nb`, type: 'notebook',
    content: { cells: [{ type: 'sql', id: 'c1', query: NB_CELL_Q, connection_name: 'duck', vizSettings: { type: 'table', xCols: [], yCols: [] }, parameters: [], references: [] }] } as never,
  }, ADMIN);
  notebookPath = `${FOLDER}/nb`;

  const dashQ = await FilesAPI.createFile({
    name: 'dash-q', path: `${FOLDER}/dash-q`, type: 'question',
    content: { description: '', query: DASH_Q, vizSettings: { type: 'table', xCols: [], yCols: [] }, parameters: [], connection_name: 'duck' } as never,
  }, ADMIN);
  await FilesAPI.createFile({
    name: 'dash', path: `${FOLDER}/dash`, type: 'dashboard',
    content: { assets: [{ type: 'question', id: dashQ.data.id }], layout: { columns: 12, items: [] } } as never, references: [dashQ.data.id],
  }, ADMIN);
  dashboardPath = `${FOLDER}/dash`;
});
afterAll(async () => { await cleanupTestDatabase(dbPath); });

describe('assertGuestQueryAllowed — only embedded queries are permitted', () => {
  it('question: allows the file own query, denies anything else', async () => {
    await expect(assertGuestQueryAllowed(questionPath, SAVED_Q, 'duck', GUEST)).resolves.toBeUndefined();
    await expect(assertGuestQueryAllowed(questionPath, 'SELECT * FROM secrets', 'duck', GUEST)).rejects.toBeInstanceOf(GuestQueryDeniedError);
  });

  it('story: allows inline + saved-referenced queries, denies arbitrary SQL', async () => {
    await expect(assertGuestQueryAllowed(storyPath, INLINE_Q, 'duck', GUEST)).resolves.toBeUndefined();
    await expect(assertGuestQueryAllowed(storyPath, SAVED_Q, 'duck', GUEST)).resolves.toBeUndefined();
    await expect(assertGuestQueryAllowed(storyPath, 'DROP TABLE users', 'duck', GUEST)).rejects.toBeInstanceOf(GuestQueryDeniedError);
    await expect(assertGuestQueryAllowed(storyPath, 'SELECT * FROM customers', 'duck', GUEST)).rejects.toBeInstanceOf(GuestQueryDeniedError);
  });

  it('notebook: allows a SQL cell query, denies others', async () => {
    await expect(assertGuestQueryAllowed(notebookPath, NB_CELL_Q, 'duck', GUEST)).resolves.toBeUndefined();
    await expect(assertGuestQueryAllowed(notebookPath, 'SELECT password FROM users', 'duck', GUEST)).rejects.toBeInstanceOf(GuestQueryDeniedError);
  });

  it('dashboard: allows an asset question query', async () => {
    await expect(assertGuestQueryAllowed(dashboardPath, DASH_Q, 'duck', GUEST)).resolves.toBeUndefined();
    await expect(assertGuestQueryAllowed(dashboardPath, 'SELECT 1', 'duck', GUEST)).rejects.toBeInstanceOf(GuestQueryDeniedError);
  });

  it('denies an allowed query pointed at a DIFFERENT connection (no connection swap)', async () => {
    await expect(assertGuestQueryAllowed(storyPath, INLINE_Q, 'other_db', GUEST)).rejects.toBeInstanceOf(GuestQueryDeniedError);
  });

  it('whitespace-reformatted-but-identical query is still allowed', async () => {
    await expect(assertGuestQueryAllowed(questionPath, '  SELECT   answer\n FROM ref_t ', 'duck', GUEST)).resolves.toBeUndefined();
  });
});
