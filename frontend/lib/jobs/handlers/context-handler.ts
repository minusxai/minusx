import 'server-only';
import { createServerRunner } from '@/lib/tests/server';
import type { JobHandler } from '../job-registry';
import type { ContextContent, ContextOutput, JobHandlerResult, JobRunnerInput } from '@/lib/types';

export const contextJobHandler: JobHandler = {
  async execute({ file }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const context = file as ContextContent;
    const tests = context.evals ?? [];

    // Use the first whitelisted database as the default connection for LLM tests
    const defaultConnectionId = context.databases?.[0]?.databaseName ?? '';
    const runner = createServerRunner(user, defaultConnectionId);
    const results = await Promise.all(tests.map(t => runner.execute(t)));

    const output: ContextOutput = { results };
    return { output, messages: [] };
  },
};
