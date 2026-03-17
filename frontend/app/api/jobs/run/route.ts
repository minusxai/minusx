/**
 * POST /api/jobs/run
 * Trigger a job execution (manual or forced).
 * Dispatches to registered job handlers via JOB_HANDLERS.
 *
 * Flow:
 *  1. Validate job_id, job_type, look up handler
 *  2. Dedup: skip if a RUNNING run already exists for this job
 *  3. Create run file upfront with status='running'
 *  4. Create job_run record with output_file_id set immediately
 *  5. Execute handler → {output, messages}
 *  6. Deliver messages (email), update run file with final statuses
 *  7. Complete job_run record
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import { JOB_HANDLERS } from '@/lib/jobs/job-registry';
import { getConfigsByCompanyId } from '@/lib/data/configs.server';
import { sendEmailViaWebhook, sendPhoneAlertViaWebhook } from '@/lib/messaging/webhook-executor';
import type { RunFileContent, RunMessageRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { job_id, job_type, force = false, send = true } = body as {
      job_id: string;
      job_type: string;
      force?: boolean;
      send?: boolean;
    };

    if (!job_id || !job_type) {
      return ApiErrors.badRequest('job_id and job_type are required');
    }

    const handler = JOB_HANDLERS[job_type];
    if (!handler) {
      return ApiErrors.badRequest(`Unsupported job_type: ${job_type}`);
    }

    await JobRunsDB.ensureTable();

    const jobFileId = parseInt(job_id, 10);
    if (isNaN(jobFileId)) {
      return ApiErrors.badRequest('job_id must be a numeric file ID');
    }

    // Load the job file to get its content
    const jobFileResult = await FilesAPI.loadFile(jobFileId, user);
    const jobFile = jobFileResult.data;
    if (!jobFile?.content) {
      return ApiErrors.notFound('Job file');
    }

    // Dedup: skip if already running (force bypasses by using a 1s window)
    if (!force) {
      const existingRun = await JobRunsDB.getRunningByJobId(job_id, job_type, user.companyId);
      if (existingRun) {
        return successResponse({
          runId: existingRun.id,
          fileId: existingRun.output_file_id,
          status: 'already_running',
        });
      }
    }

    // Load previous runs for handler context
    const previousRuns = await JobRunsDB.getByJobId(job_id, job_type, user.companyId, 10);

    const startedAt = new Date().toISOString();

    // Create run file upfront with status='running'
    const runPath = resolvePath(user.mode, `/logs/runs/${Date.now()}`);
    const initialContent: RunFileContent = {
      job_type,
      status: 'running',
      startedAt,
    };
    const createResult = await FilesAPI.createFile(
      {
        name: `run-${job_id}-${job_type}`,
        path: runPath,
        type: 'alert_run',
        content: initialContent,
        references: [jobFileId],
        options: { createPath: true },
      },
      user
    );
    const runFile = createResult.data;
    const runFileId = runFile.id;

    // Create job_run record with output file linked upfront
    const runId = await JobRunsDB.create({
      job_id,
      job_type,
      company_id: user.companyId,
      output_file_id: runFileId,
      output_file_type: 'alert_run',
      source: 'manual',
    });

    try {
      const result = await handler.execute(
        { runFileId, jobId: job_id, jobType: job_type, file: jobFile.content, previousRuns },
        user
      );

      // Build message records (pending)
      const messages: RunMessageRecord[] = result.messages.map((m) => ({ ...m, status: 'pending' }));

      // Save run file with output + pending messages
      const successContent: RunFileContent = {
        job_type,
        status: 'success',
        startedAt,
        completedAt: new Date().toISOString(),
        output: result.output,
        messages,
      };
      await FilesAPI.saveFile(runFileId, runFile.name, runFile.path, successContent, [jobFileId], user);

      // Deliver messages (skipped when send=false)
      if (send) {
        const { config } = await getConfigsByCompanyId(user.companyId, user.mode);
        const emailWebhook = config.messaging?.webhooks?.find(w => w.type === 'email_alert');
        const phoneAlertWebhook = config.messaging?.webhooks?.find(w => w.type === 'phone_alert');
        for (const msg of messages) {
          try {
            if (msg.type === 'email_alert') {
              if (!emailWebhook) {
                msg.status = 'failed';
                msg.deliveryError = 'No email_alert webhook configured';
              } else {
                const result = await sendEmailViaWebhook(emailWebhook, msg.metadata.to, msg.metadata.subject, msg.content);
                if (result.success) {
                  msg.status = 'sent';
                  msg.sentAt = new Date().toISOString();
                } else {
                  msg.status = 'failed';
                  msg.deliveryError = result.error ?? `HTTP ${result.statusCode}`;
                }
              }
            } else if (msg.type === 'phone_alert') {
              if (!phoneAlertWebhook) {
                msg.status = 'failed';
                msg.deliveryError = 'No phone_alert webhook configured';
              } else {
                const result = await sendPhoneAlertViaWebhook(phoneAlertWebhook, msg.metadata.to, msg.content);
                if (result.success) {
                  msg.status = 'sent';
                  msg.sentAt = new Date().toISOString();
                } else {
                  msg.status = 'failed';
                  msg.deliveryError = result.error ?? `HTTP ${result.statusCode}`;
                }
              }
            }
          } catch (err) {
            msg.status = 'failed';
            msg.deliveryError = err instanceof Error ? err.message : 'Unknown delivery error';
          }
        }
      } else {
        for (const msg of messages) {
          msg.status = 'skipped';
        }
      }

      // Save final message statuses if any messages were dispatched
      if (messages.length > 0) {
        await FilesAPI.saveFile(
          runFileId,
          runFile.name,
          runFile.path,
          { ...successContent, messages },
          [jobFileId],
          user
        );
      }

      await JobRunsDB.complete(runId, 'SUCCESS');
      return successResponse({ runId, fileId: runFileId, status: 'SUCCESS' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const failureContent: RunFileContent = {
        job_type,
        status: 'failure',
        startedAt,
        completedAt: new Date().toISOString(),
        error: errorMessage,
      };
      await FilesAPI.saveFile(runFileId, runFile.name, runFile.path, failureContent, [jobFileId], user);
      await JobRunsDB.complete(runId, 'FAILURE', errorMessage);
      return successResponse({ runId, fileId: runFileId, status: 'FAILURE' });
    }
  } catch (error) {
    return handleApiError(error);
  }
});
