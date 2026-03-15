/**
 * Job Runs E2E Tests
 *
 * Tests the full job execution pipeline:
 *   - POST /api/jobs/run  — manual trigger for alert job
 *   - POST /api/jobs/cron — cron scan with live/draft filtering and dedup
 *   - GET  /api/jobs/runs — history retrieval with new schema fields
 *
 * No Python backend needed: query execution is mocked via pythonBackendFetch.
 * Connection type is set to 'postgresql' so getNodeConnector() returns null
 * and falls through to the pythonBackendFetch mock.
 */

import { POST as runPostHandler } from '@/app/api/jobs/run/route';
import { POST as cronPostHandler } from '@/app/api/jobs/cron/route';
import { GET as runsGetHandler } from '@/app/api/jobs/runs/route';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import type { AlertContent, AlertRunContent, JobRun } from '@/lib/types';
import { NextRequest } from 'next/server';

// ─── DB mock ──────────────────────────────────────────────────────────────────
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_job_runs_e2e.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
  };
});

const TEST_DB_PATH = getTestDbPath('job_runs_e2e');

// ─── Auth mock ────────────────────────────────────────────────────────────────
jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: jest.fn().mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    companyId: 1,
    companyName: 'test-company',
    home_folder: '/org',
    mode: 'org',
  }),
  isAdmin: jest.fn().mockReturnValue(true),
}));

// ─── Query execution mock (no Python backend needed) ─────────────────────────
// Mocked pythonBackendFetch returns a single row with value=150 for any query.
jest.mock('@/lib/api/python-backend-client', () => ({
  pythonBackendFetch: jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      columns: ['revenue'],
      types: ['FLOAT'],
      rows: [{ revenue: 150 }],
    }),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(url: string, method: string, body?: object): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-company-id': '1', 'x-user-id': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function parseResponse(response: Response) {
  const data = await response.json();
  return data;
}

// ─── Test data IDs (set in beforeEach) ───────────────────────────────────────
let connectionId: number;
let questionId: number;
let alertId: number;
let draftAlertId: number;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Job Runs E2E', () => {
  beforeEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    await initTestDatabase(TEST_DB_PATH);

    const companyId = 1;

    // Connection — uses 'postgresql' type so getNodeConnector() returns null
    // and execution falls through to the mocked pythonBackendFetch
    connectionId = await DocumentDB.create(
      'test_conn',
      '/org/database/test_conn',
      'connection',
      { id: 'test_conn', name: 'test_conn', type: 'postgresql', config: { host: 'localhost' } } as any,
      [],
      companyId
    );

    // Question referencing that connection
    questionId = await DocumentDB.create(
      'Revenue Question',
      '/org/questions/revenue',
      'question',
      {
        query: 'SELECT revenue FROM sales',
        database_name: 'test_conn',
        vizSettings: { type: 'table' },
        parameters: [],
        parameterValues: {},
      } as any,
      [],
      companyId
    );

    const liveAlertContent: AlertContent = {
      questionId,
      status: 'live',
      schedule: { cron: '* * * * *', timezone: 'UTC' },
      condition: {
        selector: 'first',
        function: 'value',
        column: 'revenue',
        operator: '>',
        threshold: 100,
      },
      emails: [],
    };

    // Live alert: condition revenue > 100, cron every minute
    alertId = await DocumentDB.create(
      'Revenue Alert',
      '/org/alerts/revenue',
      'alert',
      liveAlertContent,
      [questionId],
      companyId
    );

    const draftAlertContent: AlertContent = {
      ...liveAlertContent,
      status: 'draft',
    };

    // Draft alert — should be skipped by cron
    draftAlertId = await DocumentDB.create(
      'Draft Alert',
      '/org/alerts/draft',
      'alert',
      draftAlertContent,
      [questionId],
      companyId
    );

    await JobRunsDB.ensureTable();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  // ── 1. Manual run ────────────────────────────────────────────────────────────

  describe('POST /api/jobs/run', () => {
    it('creates a job_run record and alert_run file on success', async () => {
      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      const res = await runPostHandler(req);
      const body = await parseResponse(res);

      expect(res.status).toBe(200);
      expect(body.data.status).toBe('SUCCESS');
      expect(body.data.runId).toBeGreaterThan(0);
      expect(body.data.fileId).toBeGreaterThan(0);

      // job_runs row should be complete
      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs).toHaveLength(1);

      const run = runs[0];
      expect(run.status).toBe('SUCCESS');
      expect(run.output_file_id).toBe(body.data.fileId);
      expect(run.output_file_type).toBe('alert_run');
      expect(run.error).toBeNull();
      expect(run.completed_at).not.toBeNull();

      // alert_run file should exist and have correct content
      const runFile = await DocumentDB.getById(body.data.fileId, 1);
      expect(runFile).not.toBeNull();
      expect(runFile!.type).toBe('alert_run');

      const content = runFile!.content as AlertRunContent;
      expect(content.alertId).toBe(alertId);
      expect(content.status).toBe('triggered');   // 150 > 100 = triggered
      expect(content.actualValue).toBe(150);
      expect(content.operator).toBe('>');
      expect(content.threshold).toBe(100);

      // File path should be /org/logs/runs/{runId}
      expect(runFile!.path).toBe(`/org/logs/runs/${run.id}`);
    });

    it('returns FAILURE and saves a failed alert_run when execution errors', async () => {
      const { pythonBackendFetch } = require('@/lib/api/python-backend-client');
      pythonBackendFetch.mockRejectedValueOnce(new Error('DB connection refused'));

      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      const res = await runPostHandler(req);
      const body = await parseResponse(res);

      expect(res.status).toBe(200);
      expect(body.data.status).toBe('FAILURE');
      expect(body.data.fileId).toBeGreaterThan(0);

      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs[0].status).toBe('FAILURE');
      expect(runs[0].error).toContain('DB connection refused');
      expect(runs[0].output_file_id).toBe(body.data.fileId);
      expect(runs[0].output_file_type).toBe('alert_run');

      const runFile = await DocumentDB.getById(body.data.fileId, 1);
      expect((runFile!.content as AlertRunContent).status).toBe('failed');
    });

    it('returns 400 for unknown job_type', async () => {
      const req = makeRequest('/api/jobs/run', 'POST', { job_id: '1', job_type: 'unknown' });
      const res = await runPostHandler(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing job_id', async () => {
      const req = makeRequest('/api/jobs/run', 'POST', { job_type: 'alert' });
      const res = await runPostHandler(req);
      expect(res.status).toBe(400);
    });
  });

  // ── 2. Cron run ──────────────────────────────────────────────────────────────

  describe('POST /api/jobs/cron', () => {
    it('triggers live alert with matching cron, skips draft', async () => {
      const req = makeRequest('/api/jobs/cron', 'POST');
      const res = await cronPostHandler(req);
      const body = await parseResponse(res);

      expect(res.status).toBe(200);
      // 1 live alert triggered, 1 draft skipped
      expect(body.data.triggered).toBe(1);
      expect(body.data.failed).toBe(0);
      expect(body.data.skipped).toBeGreaterThanOrEqual(1);

      // job_runs row created for the live alert
      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('SUCCESS');
      expect(runs[0].source).toBe('cron');
      expect(runs[0].output_file_id).not.toBeNull();
      expect(runs[0].output_file_type).toBe('alert_run');

      // No job_runs row for the draft alert
      const draftRuns = await JobRunsDB.getByJobId(String(draftAlertId), 'alert', 1);
      expect(draftRuns).toHaveLength(0);
    });

    it('deduplicates: second cron call within the same minute is skipped', async () => {
      const req1 = makeRequest('/api/jobs/cron', 'POST');
      await cronPostHandler(req1);

      const req2 = makeRequest('/api/jobs/cron', 'POST');
      const res2 = await cronPostHandler(req2);
      const body2 = await parseResponse(res2);

      expect(body2.data.triggered).toBe(0);
      // The live alert was already run; the second call finds the existing run
      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs).toHaveLength(1);  // only one run, not two
    });

    it('skips alert with non-matching cron (daily at 3am)', async () => {
      // Update alert to a cron that will never match now (0 3 * * * = 3am daily)
      const updatedContent: AlertContent = {
        questionId,
        status: 'live',
        schedule: { cron: '0 3 * * *', timezone: 'UTC' },
        condition: { selector: 'first', function: 'value', column: 'revenue', operator: '>', threshold: 100 },
        emails: [],
      };
      await DocumentDB.update(alertId, 'Revenue Alert', '/org/alerts/revenue', updatedContent, [questionId], 1);

      const req = makeRequest('/api/jobs/cron', 'POST');
      const res = await cronPostHandler(req);
      const body = await parseResponse(res);

      expect(body.data.triggered).toBe(0);
      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs).toHaveLength(0);
    });
  });

  // ── 3. History fetch ─────────────────────────────────────────────────────────

  describe('GET /api/jobs/runs', () => {
    it('returns runs with output_file_id and output_file_type', async () => {
      // Create a run first
      const runReq = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      await runPostHandler(runReq);

      const req = new NextRequest(
        `http://localhost:3000/api/jobs/runs?job_id=${alertId}&job_type=alert&limit=5`,
        { headers: { 'x-company-id': '1', 'x-user-id': '1' } }
      );
      const res = await runsGetHandler(req);
      const body = await parseResponse(res);

      expect(res.status).toBe(200);
      const runs: JobRun[] = body.data;
      expect(runs).toHaveLength(1);

      const run = runs[0];
      expect(run.status).toBe('SUCCESS');
      expect(run.output_file_id).toBeGreaterThan(0);
      expect(run.output_file_type).toBe('alert_run');
      expect(run.error).toBeNull();
      // Verify old fields are gone
      expect((run as any).file_id).toBeUndefined();
      expect((run as any).error_message).toBeUndefined();
      expect((run as any).input).toBeUndefined();
      expect((run as any).output).toBeUndefined();
    });

    it('returns 400 when job_id is missing', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/jobs/runs?job_type=alert',
        { headers: { 'x-company-id': '1', 'x-user-id': '1' } }
      );
      const res = await runsGetHandler(req);
      expect(res.status).toBe(400);
    });
  });
});
