import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import { runReportV2 } from '@/lib/chat/run-report-v2.server';
import { resolveBaseUrl, resolveEmailAddresses } from '@/lib/jobs/job-utils';
import { getAppStateServer } from '@/lib/api/file-state.server';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { ReportAgentContext, ReportAgentReference } from '@/agents/report/report-agent';
import type { ReportContent, ReportOutput, ReportRunContent, JobHandlerResult, JobRunnerInput } from '@/lib/types';
import type { JobHandler } from '../job-registry';


export const reportJobHandler: JobHandler = {
  async execute({ runFileId, jobId, file }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const report = file as ReportContent;
    const reportId = parseInt(jobId, 10);

    // Load the report file name
    const reportFileResult = await FilesAPI.loadFile(reportId, user);
    const reportName = reportFileResult.data?.name ?? `Report ${reportId}`;

    // Load reference files from DB and build CompressedAugmentedFile for each.
    // The AnalystAgent expects app_state: { type: 'file', state: CompressedAugmentedFile }
    // — the same shape ChatInterface builds client-side via compressAugmentedFile().
    // getAppStateServer handles the full pipeline including:
    // - Parameter inheritance for dashboards
    // - Query execution with inherited params
    const enrichedReferences = await Promise.all(
      (report.references || []).map(async (ref) => {
        // Load file for metadata (name, path, connection_id)
        const refResult = await FilesAPI.loadFile(ref.reference.id, user);
        const refFile = refResult.data;
        const connectionId = (refFile?.content as any)?.connection_name;

        // Build app state with query execution enabled for reports
        const appState = await getAppStateServer(ref.reference.id, user, { executeQueries: true });

        return {
          ...ref,
          file_name: refFile?.name || `Reference ${ref.reference.id}`,
          file_path: refFile?.path || '',
          connection_id: connectionId,
          app_state: appState,
        };
      })
    );

    const primaryConnectionId = enrichedReferences.find(r => r.connection_id)?.connection_id;

    const baseArgs = await buildServerAgentArgs(user);

    // Build the whitelist from the resolved schema (mirrors the chat path).
    const whitelistedTables: string[] = [];
    for (const s of baseArgs.schema ?? []) {
      for (const t of s.tables) {
        whitelistedTables.push(t);
        whitelistedTables.push(`${s.schema}.${t}`);
      }
    }

    // Run the ReportAgent via the in-process v=2 orchestrator.
    const runData: ReportRunContent = await runReportV2({
      // RemoteAnalystContext (inherited by the analyst sub-agents)
      userId: String(user.userId ?? user.email),
      mode: user.mode === 'tutorial' ? 'tutorial' : 'org',
      effectiveUser: user,
      connectionId: primaryConnectionId || baseArgs.connection_id,
      whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
      contextDocs: baseArgs.context || undefined,
      schema: baseArgs.schema,
      homeFolder: resolveHomeFolderSync(user.mode, user.home_folder || ''),
      role: user.role,
      // Report inputs
      reportId,
      reportName,
      references: enrichedReferences as ReportAgentReference[],
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
    }

    const status = runData?.status === 'failed' ? 'failure' : 'success';
    return { output, messages, status };
  },
};
