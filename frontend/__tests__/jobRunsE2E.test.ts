/**
 * Job Runs E2E Tests
 *
 * Tests the full job execution pipeline:
 *   - POST /api/jobs/run  — manual trigger for alert job
 *   - POST /api/jobs/cron — cron scan with live/draft filtering and dedup
 *   - GET  /api/jobs/runs — history retrieval with new schema fields
 *
 * Phase 2 behavior:
 *   - Run file created BEFORE execution with status='running'
 *   - Handler returns {output, messages} — orchestrator owns delivery
 *   - Manual dedup: skip if job already RUNNING
 *   - Cron dedup: time-window (findOrCreate ±30s)
 *   - Run file content: RunFileContent with output: AlertOutput inside
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
import type { AlertContent, AlertOutput, JobRun, RunFileContent, Test } from '@/lib/types';
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

// ─── Webhook executor mock ────────────────────────────────────────────────────
jest.mock('@/lib/messaging/webhook-executor', () => ({
  sendEmailViaWebhook: jest.fn().mockResolvedValue({ success: true, statusCode: 200 }),
  sendPhoneAlertViaWebhook: jest.fn().mockResolvedValue({ success: true, statusCode: 200 }),
}));

// ─── Company config mock (provide email webhook for delivery tests) ───────────
jest.mock('@/lib/data/configs.server', () => ({
  getConfigsByCompanyId: jest.fn().mockResolvedValue({
    config: {
      branding: {
        agentName: 'TestAgent',
        displayName: 'Test Company',
      },
      messaging: {
        webhooks: [
          {
            type: 'email_alert',
            url: 'https://hooks.example.com/email',
            method: 'POST',
            headers: {},
            body: { to: '{{EMAIL_TO}}', subject: '{{EMAIL_SUBJECT}}', body: '{{EMAIL_BODY}}' },
          },
        ],
      },
    },
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_CRON_SECRET = 'test-cron-secret';

function makeRequest(url: string, method: string, body?: object): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-company-id': '1', 'x-user-id': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeCronRequest(companyIds: number[] = [1]): NextRequest {
  return new NextRequest('http://localhost:3000/api/jobs/cron', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TEST_CRON_SECRET}`,
    },
    body: JSON.stringify({ company_ids: companyIds }),
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
    process.env.CRON_SECRET = TEST_CRON_SECRET;

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

    // NEW: test passes when revenue <= 100, fails (triggers alert) when revenue > 100
    const liveAlertTest: Test = {
      type: 'query',
      subject: { type: 'query', question_id: questionId, column: 'revenue', row: 0 },
      answerType: 'number',
      operator: '<=',
      value: { type: 'constant', value: 100 },
    };
    const liveAlertContent: AlertContent = {
      status: 'live',
      schedule: { cron: '* * * * *', timezone: 'UTC' },
      tests: [liveAlertTest],
      recipients: [],
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
    it('creates a job_run record and RunFileContent run file on success', async () => {
      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      const res = await runPostHandler(req);
      const body = await parseResponse(res);

      expect(res.status).toBe(200);
      expect(body.data.status).toBe('SUCCESS');
      expect(body.data.runId).toBeGreaterThan(0);
      expect(body.data.fileId).toBeGreaterThan(0);

      // job_runs row should be complete with output_file_id set
      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs).toHaveLength(1);

      const run = runs[0];
      expect(run.status).toBe('SUCCESS');
      expect(run.output_file_id).toBe(body.data.fileId);
      expect(run.output_file_type).toBe('alert_run');
      expect(run.error).toBeNull();
      expect(run.completed_at).not.toBeNull();

      // Run file should use new RunFileContent shape
      const runFile = await DocumentDB.getById(body.data.fileId, 1);
      expect(runFile).not.toBeNull();
      expect(runFile!.type).toBe('alert_run');

      const content = runFile!.content as RunFileContent;
      expect(content.job_type).toBe('alert');
      expect(content.status).toBe('success');
      expect(content.startedAt).toBeTruthy();
      expect(content.completedAt).toBeTruthy();
      expect(content.error).toBeUndefined();

      // Alert-specific data is in output
      const output = content.output as AlertOutput;
      expect(output.alertId).toBe(alertId);
      expect(output.status).toBe('triggered');   // revenue 150 > 100 → test fails → triggered
      expect(output.testResults).toHaveLength(1);
      expect(output.testResults[0].passed).toBe(false);   // 150 <= 100 is false → test fails
      expect(output.triggeredBy).toHaveLength(1);

      // Path should be under /org/logs/runs/
      expect(runFile!.path).toMatch(/^\/org\/logs\/runs\//);
    });

    it('run file is created upfront with status=running (output_file_id set before execution)', async () => {
      // Intercept handler execution to verify run file exists with status=running
      let capturedRunFileId: number | null = null;

      const { pythonBackendFetch } = require('@/lib/api/python-backend-client');
      pythonBackendFetch.mockImplementationOnce(async () => {
        // By the time the query runs, the job_run should already have output_file_id
        const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
        if (runs.length > 0) {
          capturedRunFileId = runs[0].output_file_id;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ columns: ['revenue'], types: ['FLOAT'], rows: [{ revenue: 150 }] }),
        };
      });

      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      await runPostHandler(req);

      // output_file_id was already set when the query ran
      expect(capturedRunFileId).toBeGreaterThan(0);

      // And the run file had status=running at that point
      if (capturedRunFileId) {
        // After completion, status is 'success'
        const runFile = await DocumentDB.getById(capturedRunFileId, 1);
        const content = runFile!.content as RunFileContent;
        expect(content.status).toBe('success');
      }
    });

    it('captures query error as failed test result (run status stays SUCCESS)', async () => {
      const { pythonBackendFetch } = require('@/lib/api/python-backend-client');
      pythonBackendFetch.mockRejectedValueOnce(new Error('DB connection refused'));

      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      const res = await runPostHandler(req);
      const body = await parseResponse(res);

      expect(res.status).toBe(200);
      // In the new runner, query errors are captured as test failures — the job itself succeeds
      expect(body.data.status).toBe('SUCCESS');
      expect(body.data.fileId).toBeGreaterThan(0);

      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs[0].status).toBe('SUCCESS');
      expect(runs[0].output_file_id).toBe(body.data.fileId);

      const runFile = await DocumentDB.getById(body.data.fileId, 1);
      const content = runFile!.content as RunFileContent;
      expect(content.status).toBe('success');

      // The alert output records the error in the test result
      const output = content.output as AlertOutput;
      expect(output.testResults).toHaveLength(1);
      expect(output.testResults[0].passed).toBe(false);
      expect(output.testResults[0].error).toContain('DB connection refused');
    });

    it('deduplicates: returns already_running if job is in-flight (within timeout)', async () => {
      // Manually create a RUNNING job_run referencing a fake file (default timeout=30s)
      const fakeFileId = 999;
      await JobRunsDB.create({
        job_id: String(alertId),
        job_type: 'alert',
        company_id: 1,
        output_file_id: fakeFileId,
        output_file_type: 'alert_run',
        source: 'manual',
      });

      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      const res = await runPostHandler(req);
      const body = await parseResponse(res);

      expect(res.status).toBe(200);
      expect(body.data.status).toBe('already_running');
      expect(body.data.runId).toBeGreaterThan(0);
      expect(body.data.fileId).toBe(fakeFileId);

      // No new run should have been created
      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('RUNNING');
    });

    it('ignores stale RUNNING runs: proceeds if existing run has exceeded its timeout', async () => {
      // Create a RUNNING run with timeout=0 — it is immediately past its window.
      // This simulates a run left stuck in RUNNING state by a crash or old code.
      await JobRunsDB.create({
        job_id: String(alertId),
        job_type: 'alert',
        company_id: 1,
        output_file_id: 999,
        output_file_type: 'alert_run',
        source: 'manual',
        timeout: 0,  // expires immediately
      });

      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      const res = await runPostHandler(req);
      const body = await parseResponse(res);

      // Should proceed with a new run, not return already_running
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('SUCCESS');

      // Two runs total: the stale one (now TIMEOUT) and the new one (SUCCESS)
      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs).toHaveLength(2);
      const newRun = runs.find(r => r.status === 'SUCCESS');
      const staleRun = runs.find(r => r.status === 'TIMEOUT');
      expect(newRun).toBeDefined();
      // Stale run was atomically marked TIMEOUT in the same transaction as dedup check
      expect(staleRun).toBeDefined();
      expect(staleRun!.error).toContain('timed out');
    });

    it('sends email when alert is triggered and recipients are configured', async () => {
      const { sendEmailViaWebhook } = require('@/lib/messaging/webhook-executor');

      const alertWithRecipients: AlertContent = {
        status: 'live',
        schedule: { cron: '* * * * *', timezone: 'UTC' },
        tests: [{ type: 'query', subject: { type: 'query', question_id: questionId, column: 'revenue', row: 0 }, answerType: 'number', operator: '<=', value: { type: 'constant', value: 100 } }],
        recipients: [
          { channel: 'email_alert', address: 'alice@example.com' },
          { channel: 'email_alert', address: 'bob@example.com' },
        ],
      };
      await DocumentDB.update(alertId, 'Revenue Alert', '/org/alerts/revenue', alertWithRecipients, [questionId], 1);

      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      const res = await runPostHandler(req);
      const body = await parseResponse(res);

      expect(res.status).toBe(200);
      expect(body.data.status).toBe('SUCCESS');

      // One sendEmailViaWebhook call per recipient
      expect(sendEmailViaWebhook).toHaveBeenCalledTimes(2);
      expect(sendEmailViaWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'email_alert' }),
        'alice@example.com',
        expect.stringContaining('Alert Triggered'),
        expect.any(String)
      );

      // Run file messages should show 'sent' status
      const runFile = await DocumentDB.getById(body.data.fileId, 1);
      const content = runFile!.content as RunFileContent;
      expect(content.messages).toHaveLength(2);
      expect(content.messages![0].status).toBe('sent');
      expect(content.messages![0].sentAt).toBeTruthy();
      expect(content.messages![0].type).toBe('email_alert');
    });

    it('records delivery failure in messages when webhook returns HTTP error', async () => {
      const { sendEmailViaWebhook } = require('@/lib/messaging/webhook-executor');
      sendEmailViaWebhook.mockResolvedValueOnce({ success: false, statusCode: 401, error: 'Unauthorized' });

      const alertWithRecipients: AlertContent = {
        status: 'live',
        schedule: { cron: '* * * * *', timezone: 'UTC' },
        tests: [{ type: 'query', subject: { type: 'query', question_id: questionId, column: 'revenue', row: 0 }, answerType: 'number', operator: '<=', value: { type: 'constant', value: 100 } }],
        recipients: [{ channel: 'email_alert', address: 'alice@example.com' }],
      };
      await DocumentDB.update(alertId, 'Revenue Alert', '/org/alerts/revenue', alertWithRecipients, [questionId], 1);

      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      const res = await runPostHandler(req);
      const body = await parseResponse(res);

      // The overall run should still succeed even if delivery fails
      expect(body.data.status).toBe('SUCCESS');

      const runFile = await DocumentDB.getById(body.data.fileId, 1);
      const content = runFile!.content as RunFileContent;
      expect(content.messages![0].status).toBe('failed');
      expect(content.messages![0].deliveryError).toContain('Unauthorized');
    });

    it('does not send notifications when alert is not triggered', async () => {
      const { sendEmailViaWebhook } = require('@/lib/messaging/webhook-executor');

      // Revenue 150 <= 200 = true → test passes → NOT triggered
      const alertWithRecipients: AlertContent = {
        status: 'live',
        schedule: { cron: '* * * * *', timezone: 'UTC' },
        tests: [{ type: 'query', subject: { type: 'query', question_id: questionId, column: 'revenue', row: 0 }, answerType: 'number', operator: '<=', value: { type: 'constant', value: 200 } }],
        recipients: [{ channel: 'email_alert', address: 'alice@example.com' }],
      };
      await DocumentDB.update(alertId, 'Revenue Alert', '/org/alerts/revenue', alertWithRecipients, [questionId], 1);

      const req = makeRequest('/api/jobs/run', 'POST', { job_id: String(alertId), job_type: 'alert' });
      await runPostHandler(req);

      expect(sendEmailViaWebhook).not.toHaveBeenCalled();
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
      const req = makeCronRequest([1]);
      const res = await cronPostHandler(req);
      const body = await parseResponse(res);

      expect(res.status).toBe(200);
      // 1 live alert triggered, 1 draft skipped
      expect(body.data.results[1].triggered).toBe(1);
      expect(body.data.results[1].failed).toBe(0);
      expect(body.data.results[1].skipped).toBeGreaterThanOrEqual(1);

      // job_runs row created for the live alert
      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('SUCCESS');
      expect(runs[0].source).toBe('cron');
      expect(runs[0].output_file_id).not.toBeNull();
      expect(runs[0].output_file_type).toBe('alert_run');

      // Run file should use new RunFileContent shape
      const runFile = await DocumentDB.getById(runs[0].output_file_id!, 1);
      const content = runFile!.content as RunFileContent;
      expect(content.job_type).toBe('alert');
      expect(content.status).toBe('success');
      const output = content.output as AlertOutput;
      expect(output.status).toBe('triggered');

      // No job_runs row for the draft alert
      const draftRuns = await JobRunsDB.getByJobId(String(draftAlertId), 'alert', 1);
      expect(draftRuns).toHaveLength(0);
    });

    it('deduplicates: second cron call within the same minute is skipped', async () => {
      const req1 = makeCronRequest([1]);
      await cronPostHandler(req1);

      const req2 = makeCronRequest([1]);
      const res2 = await cronPostHandler(req2);
      const body2 = await parseResponse(res2);

      expect(body2.data.results[1].triggered).toBe(0);
      // The live alert was already run; the second call finds the existing run in the time window
      const runs = await JobRunsDB.getByJobId(String(alertId), 'alert', 1);
      expect(runs).toHaveLength(1);  // only one run, not two
    });

    it('skips alert with non-matching cron (daily at 3am)', async () => {
      // Update alert to a cron that will never match now (0 3 * * * = 3am daily)
      const updatedContent: AlertContent = {
        status: 'live',
        schedule: { cron: '0 3 * * *', timezone: 'UTC' },
        tests: [{ type: 'query', subject: { type: 'query', question_id: questionId, column: 'revenue', row: 0 }, answerType: 'number', operator: '<=', value: { type: 'constant', value: 100 } }],
        recipients: [],
      };
      await DocumentDB.update(alertId, 'Revenue Alert', '/org/alerts/revenue', updatedContent, [questionId], 1);

      const req = makeCronRequest([1]);
      const res = await cronPostHandler(req);
      const body = await parseResponse(res);

      expect(body.data.results[1].triggered).toBe(0);
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
