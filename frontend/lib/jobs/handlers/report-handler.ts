import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import { runReportV2 } from '@/lib/chat/run-report.server';
import { resolveBaseUrl, resolveEmailAddresses } from '@/lib/jobs/job-utils';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { getConfigsForMode } from '@/lib/data/configs.server';
import type { ReportAgentContext } from '@/agents/report/report-agent';
import type { ReportContent, ReportOutput, ReportRunContent, JobHandlerResult, JobRunnerInput } from '@/lib/types';
import type { JobHandler } from '../job-registry';


export const reportJobHandler: JobHandler = {
  async execute({ runFileId, jobId, file }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const report = file as ReportContent;
    const reportId = parseInt(jobId, 10);

    // Load the report file name
    const reportFileResult = await FilesAPI.loadFile(reportId, user);
    const reportName = reportFileResult.data?.name ?? `Report ${reportId}`;

    const baseArgs = await buildServerAgentArgs(user);

    // Build the whitelist from the resolved schema (mirrors the chat path).
    const whitelistedTables: string[] = [];
    for (const s of baseArgs.schema ?? []) {
      for (const t of s.tables) {
        whitelistedTables.push(t);
        whitelistedTables.push(`${s.schema}.${t}`);
      }
    }

    // Run the ReportAgent via the in-process v=2 orchestrator. The analyst
    // sub-agent finds the relevant data itself from the freeform reportPrompt.
    const runData: ReportRunContent = await runReportV2({
      // RemoteAnalystContext (inherited by the analyst sub-agent)
      userId: String(user.userId ?? user.email),
      mode: user.mode === 'tutorial' ? 'tutorial' : 'org',
      effectiveUser: user,
      connectionId: baseArgs.connection_id,
      whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
      resolvedContextDocs: baseArgs.context_docs,
      annotations: baseArgs.annotations,
      schema: baseArgs.schema,
      homeFolder: resolveHomeFolderSync(user.mode, user.home_folder || ''),
      role: user.role,
      // Report inputs
      reportId,
      reportName,
      reportPrompt: report.reportPrompt ?? '',
      emails: [], // Delivery handled via RunFileContent.messages below
    } satisfies ReportAgentContext);

    const output: ReportOutput = {
      reportId,
      reportName,
      generatedReport: runData.generatedReport,
      queries: runData.queries,
    };

    // Build email messages for recipients when the report succeeded
    const messages: JobHandlerResult['messages'] = [];
    if (runData?.status === 'success' && report.recipients && report.recipients.length > 0) {
      const baseUrl = await resolveBaseUrl();
      const reportLink = `${baseUrl}/f/${runFileId}`;
      const subject = `[Report] ${reportName}`;

      const bodySnippet = runData.generatedReport
        ? runData.generatedReport.substring(0, 5000)
        : 'No content generated.';
      const emailBody = `<h2>${reportName}</h2><div style="white-space:pre-wrap">${bodySnippet}</div><p><a href="${reportLink}">View full report</a></p>`;

      const emailAddresses = await resolveEmailAddresses(report.recipients, user);
      for (const address of emailAddresses) {
        messages.push({
          type: 'email_alert',
          content: emailBody,
          metadata: { to: address, subject },
        });
      }

      const { config } = await getConfigsForMode(user.mode);
      const slackText = `*${reportName}*\n${bodySnippet}\n<${reportLink}|View full report>`;
      for (const recipient of report.recipients) {
        if ('userId' in recipient || (recipient.channel !== 'slack' && recipient.channel !== 'slack_app')) continue;
        const ch = config.channels?.find(c => c.name === recipient.channelName);
        if (!ch) continue;
        if (recipient.channel === 'slack' && ch.type === 'slack') {
          messages.push({
            type: 'slack_alert',
            content: slackText,
            metadata: {
              channel: ch.name,
              webhook_url: ch.webhook_url,
              properties: ch.properties,
            },
          });
        } else if (recipient.channel === 'slack_app' && ch.type === 'slack_app') {
          messages.push({
            type: 'slack_app_alert',
            content: slackText,
            metadata: {
              channel: ch.channel_id,
              team_id: ch.team_id,
              channel_name: ch.channel_name,
            },
          });
        }
      }
    }

    const status = runData?.status === 'failed' ? 'failure' : 'success';
    return { output, messages, status };
  },
};
