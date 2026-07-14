// Tests for CheckFileHealth. Uses real PGLite via initTestDatabase to exercise the actual
// FilesAPI load + ACL path — not mocks. The deterministic scorer itself is unit-tested in
// lib/rubric; here we certify the tool wiring (load → score → report envelope).

import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AnalystAgentContext } from '../types';
import { CheckFileHealth } from '../health-tools';
import { FilesAPI } from '@/lib/data/files.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { QuestionContent, FolderContent } from '@/lib/types';
import type { RubricReport } from '@/lib/rubric/types';
import { cleanupTestDatabase, getTestDbPath, initTestDatabase } from '@/store/__tests__/test-utils';

const dbPath = getTestDbPath('health_tools');
const ADMIN: EffectiveUser = { userId: 1, email: 'admin@example.com', name: 'Admin', role: 'admin', home_folder: '/org', mode: 'org' };
const TEST_FOLDER = '/org/health-tools-test';

function question(overrides: Partial<QuestionContent>): QuestionContent {
  return { description: 'ok', query: 'SELECT 1', vizSettings: { type: 'table' }, parameters: [], parameterValues: null, connection_name: 'test', cachePolicy: null, ...overrides };
}

function run(fileId: number, ctx: Partial<AnalystAgentContext> = { effectiveUser: ADMIN }) {
  const tool = new CheckFileHealth(new Orchestrator([]), { fileId }, { userId: '1', mode: 'org', ...ctx } as AnalystAgentContext);
  return tool.run();
}

beforeAll(async () => {
  await initTestDatabase(dbPath);
  await FilesAPI.createFile(
    { name: 'health-tools-test', path: TEST_FOLDER, type: 'folder', content: { description: '' } as FolderContent, references: [], options: { returnExisting: true } },
    ADMIN,
  );
});
afterAll(async () => { await cleanupTestDatabase(dbPath); });

describe('CheckFileHealth', () => {
  it('returns a deterministic report with findings for an unhealthy question', async () => {
    const q = await FilesAPI.createFile(
      { name: 'undeclared', path: `${TEST_FOLDER}/undeclared`, type: 'question', content: question({ query: 'SELECT * FROM t WHERE d > :start' }) },
      ADMIN,
    );
    const res = await run(q.data.id);
    expect(res.isError).toBe(false);
    const report = (res.details as { report: RubricReport }).report;
    const undeclared = report.categories.flatMap((c) => c.findings).find((f) => f.ruleId === 'question.undeclared-param');
    expect(undeclared?.source).toBe('rule');
    // an error dropped the score below perfect (exact value depends on tuned deductions/weights)
    expect(report.categories.find((c) => c.category === 'correctness')!.score!).toBeLessThan(5);
    expect(report.overall).toBeLessThan(5);
  });

  it('reports a clean question as good / 100', async () => {
    const q = await FilesAPI.createFile(
      { name: 'clean', path: `${TEST_FOLDER}/clean`, type: 'question', content: question({}) },
      ADMIN,
    );
    const report = (await run(q.data.id) as { details: { report: RubricReport } }).details.report;
    expect(report.overall).toBe(5);
    expect(report.grade).toBe('good');
  });

  it('declines non-scored file types', async () => {
    const folder = await FilesAPI.createFile(
      { name: 'sub', path: `${TEST_FOLDER}/sub`, type: 'folder', content: { description: '' } as FolderContent, options: { returnExisting: true } },
      ADMIN,
    );
    const res = await run(folder.data.id);
    expect((res.details as { success: boolean }).success).toBe(false);
    expect((res.content[0] as { text: string }).text).toContain('only available for');
  });

  it('errors when effectiveUser is missing', async () => {
    const res = await run(1, {});
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('requires effectiveUser');
  });
});
