import 'server-only';
import { resolveBaseUrl, resolveEmailAddresses } from '@/lib/jobs/job-utils';
import { FilesAPI } from '@/lib/data/files.server';
import { createServerRunner } from '@/lib/tests/server';
import type { JobHandler } from '../job-registry';
import type { ContextContent, ContextOutput, JobHandlerResult, JobRunnerInput } from '@/lib/types';

export const contextJobHandler: JobHandler = {
  async execute({ file, jobId, runFileId }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const context = file as ContextContent;
    const tests = context.evals ?? [];

    // Use the first exposed database from fullSchema as the default connection for LLM tests
    const defaultConnectionId = context.fullSchema?.[0]?.databaseName ?? '';
    // Pass the context file's own ID so the TestAgent receives schema and docs
    // from THIS context file, not from the nearest ancestor of the cron user's home folder.
    const runner = createServerRunner(user, defaultConnectionId, { contextFileId: parseInt(jobId) });
    const results = await Promise.all(tests.map(t => runner.execute(t)));

    const output: ContextOutput = { results };

    const messages: JobHandlerResult['messages'] = [];
    if (context.recipients && context.recipients.length > 0) {
      const contextFileResult = await FilesAPI.loadFile(parseInt(jobId, 10), user);
      const contextName = contextFileResult.data?.name ?? `Context ${jobId}`;
      const baseUrl = await resolveBaseUrl();
      const link = `${baseUrl}/f/${runFileId}`;
      const subject = `[Evals] ${contextName}`;
      const passed = results.filter(r => r.passed).length;
      const body = `<h2>${contextName}</h2><p>${passed}/${results.length} evals passed.</p><p><a href="${link}">View results</a></p>`;

      const emailAddresses = await resolveEmailAddresses(context.recipients, user);
      for (const address of emailAddresses) {
        messages.push({ type: 'email_alert', content: body, metadata: { to: address, subject } });
      }
    }

    return { output, messages };
  },
};
