import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { runChatOrchestration } from '@/lib/chat/run-orchestration';
import { resolveBaseUrl } from '@/lib/jobs/job-utils';
import { dbFileToCompressedAugmented } from '@/lib/api/compress-augmented';
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
    // The Python AnalystAgent expects app_state: { type: 'file', state: CompressedAugmentedFile }
    // — the same shape ChatInterface builds client-side via compressAugmentedFile().
    // dbFileToCompressedAugmented handles the DbFile → CompressedAugmentedFile pipeline,
    // including passing the file's own references (e.g. questions inside a dashboard).
    const enrichedReferences = await Promise.all(
      (report.references || []).map(async (ref) => {
        const refResult = await FilesAPI.loadFile(ref.reference.id, user);
        const refFile = refResult.data;
        const refFileRefs = (refResult.metadata?.references ?? []);
        const connectionId = (refFile?.content as any)?.connection_name;

        const appState = refFile
          ? { type: 'file' as const, state: dbFileToCompressedAugmented(refFile, refFileRefs) }
          : null;

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

    // Run the ReportAgent via the full Python↔Next.js orchestration loop
    const { log } = await runChatOrchestration({
      agent: 'ReportAgent',
      agent_args: {
        report_id: reportId,
        report_name: reportName,
        references: enrichedReferences,
        report_prompt: report.reportPrompt,
        emails: [],  // Delivery handled via RunFileContent.messages below
        connection_id: primaryConnectionId,
        schema: [],
        context: '',
      },
      user,
      userMessage: `Execute report: ${reportName}`,
      timeoutMs: 1_800_000, // 30-minute timeout for report generation
    });

    // Extract run result from the conversation log
    const taskResult = log.find((entry: any) => entry._type === 'task_result' && entry.result?.run);
    const runData: ReportRunContent | null = taskResult ? (taskResult as any).result.run : null;

    const output: ReportOutput = {
      reportId,
      reportName,
      generatedReport: runData?.generatedReport,
      queries: runData?.queries,
    };

    // Build email messages for recipients when the report succeeded
    const messages: JobHandlerResult['messages'] = [];
    if (runData?.status === 'success' && report.recipients && report.recipients.length > 0) {
      const baseUrl = await resolveBaseUrl(user.companyId);
      const reportLink = `${baseUrl}/f/${runFileId}`;
      const subject = `[Report] ${reportName}`;

      const bodySnippet = runData.generatedReport
        ? runData.generatedReport.substring(0, 5000)
        : 'No content generated.';
      const emailBody = `<h2>${reportName}</h2><div style="white-space:pre-wrap">${bodySnippet}</div><p><a href="${reportLink}">View full report</a></p>`;

      for (const recipient of report.recipients) {
        if (recipient.channel === 'email_alert') {
          messages.push({
            type: 'email_alert',
            content: emailBody,
            metadata: { to: recipient.address, subject },
          });
        }
      }
    }

    const status = runData?.status === 'failed' ? 'failure' : 'success';
    return { output, messages, status };
  },
};
