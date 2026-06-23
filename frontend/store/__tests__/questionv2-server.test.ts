// M1 integration: a QuestionV2 round-trips through the server persistence path —
// created with a jsx body, jsx persists, SetJsx updates it, and the jsx parses back
// to the effective { query, connection_name, vizSettings } the render path consumes.
// Invalid jsx is rejected on both create and SetJsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { createFile, setJsxFile } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { buildQuestionJsx, parseQuestionJsx } from '@/lib/data/question-v2';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { VizSettings } from '@/lib/types';

const user: EffectiveUser = {
  userId: 1, email: 't@e.com', name: 'T', role: 'admin', home_folder: '/org', mode: 'org',
};

const viz: VizSettings = { type: 'bar', xCols: ['n'], yCols: [] };
const jsx = buildQuestionJsx({ query: 'SELECT 1 AS n WHERE 2 < 3', connection_name: 'test_db', vizSettings: viz });

describe('QuestionV2 server persistence', () => {
  const dbPath = getTestDbPath('questionv2_server');

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    // Server createFile requires the parent folder to exist.
    if (!(await DocumentDB.getByPath('/org'))) {
      await DocumentDB.create('org', '/org', 'folder', { name: 'org' }, [], undefined, false);
    }
  });
  afterAll(async () => { await cleanupTestDatabase(dbPath); });

  it('creates a questionv2 with a jsx body — persists + parses back to query/connection/viz', async () => {
    const res = await createFile({ name: 'Q2a', path: '/org/q2a', type: 'questionv2', content: { description: '' }, jsx }, user);
    const loaded = await DocumentDB.getById(res.data.id);
    expect(loaded?.type).toBe('questionv2');
    expect(loaded?.jsx).toBe(jsx);

    const parsed = parseQuestionJsx(loaded!.jsx!);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.query).toBe('SELECT 1 AS n WHERE 2 < 3'); // raw `<` survived
      expect(parsed.value.connection_name).toBe('test_db');
      expect(parsed.value.vizSettings).toMatchObject({ type: 'bar', xCols: ['n'] });
    }
  });

  it('SetJsx replaces the body and re-parses', async () => {
    const res = await createFile({ name: 'Q2b', path: '/org/q2b', type: 'questionv2', content: { description: '' }, jsx }, user);
    const newJsx = buildQuestionJsx({ query: 'SELECT 42 AS answer', connection_name: 'db2' });
    await setJsxFile(res.data.id, newJsx, user);

    const loaded = await DocumentDB.getById(res.data.id);
    expect(loaded?.jsx).toBe(newJsx);
    const parsed = parseQuestionJsx(loaded!.jsx!);
    expect(parsed.ok && parsed.value.query).toBe('SELECT 42 AS answer');
  });

  it('rejects invalid jsx on create (dangerous tag) and on SetJsx (syntax error)', async () => {
    await expect(
      createFile({ name: 'Bad', path: '/org/bad', type: 'questionv2', content: {}, jsx: '<script>alert(1)</script>' }, user),
    ).rejects.toThrow(/Invalid jsx/);

    const ok = await createFile({ name: 'Q2c', path: '/org/q2c', type: 'questionv2', content: {}, jsx }, user);
    await expect(setJsxFile(ok.data.id, '<Question oops=>', user)).rejects.toThrow(/Invalid jsx/);
  });
});
