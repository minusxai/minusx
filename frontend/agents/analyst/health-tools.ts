import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { FilesAPI } from '@/lib/data/files.server';
import { isRubricFileType, scoreFileDeterministic } from '@/lib/rubric/registry';
import { judgeFile, combineReports } from '@/lib/rubric/judge/judge.server';
import type { RubricReport } from '@/lib/rubric/types';
import type { AnalystAgentContext } from './types';

// ─── CheckFileHealth ──────────────────────────────────────────────────────────
// Server tool: scores a question/dashboard/story's health and returns actionable findings.
// The same deterministic report is auto-injected on every read; this tool lets the agent
// re-check on demand (e.g. after an edit) and optionally add the LLM visual-quality judge.

const CheckFileHealthParams = Type.Object({
  fileId: Type.Number({ description: 'ID of the file to health-check (question, dashboard, or story).' }),
  llmJudge: Type.Optional(Type.Boolean({
    description: 'When true, also run the LLM judge for subjective/visual quality (slower, judges from markup). Default false.',
  })),
});

interface CheckFileHealthDetails extends Record<string, unknown> {
  success: boolean;
  fileId: number;
  report?: RubricReport;
  message?: string;
}

function fail(fileId: number, message: string, isError = false): ToolResponse<CheckFileHealthDetails> {
  return { content: [{ type: 'text', text: message }], isError, details: { success: false, fileId, message } };
}

/**
 * The rendered screenshot for `fileId`, if it's the current app-state file. The app captures +
 * uploads a full-file screenshot on the send path (`lib/screenshot/app-state-screenshot.ts`),
 * carried on `fileState.image.url` — the judge reuses that same image (no re-render).
 */
function screenshotUrlFor(appState: unknown, fileId: number): string | undefined {
  const fs = (appState as { state?: { fileState?: { id?: number; image?: { url?: string } } } } | undefined)?.state?.fileState;
  return fs?.id === fileId ? fs.image?.url : undefined;
}

export class CheckFileHealth extends MXTool<typeof CheckFileHealthParams, AnalystAgentContext, CheckFileHealthDetails> {
  static readonly schema: Tool<typeof CheckFileHealthParams> = {
    name: 'CheckFileHealth',
    description:
      'Score the health of a question, dashboard, or story file and return actionable findings '
      + '(1–5 score + grade across clarity/correctness/craft/aesthetics, each finding with a concrete fix). '
      + 'Set llmJudge=true to also run an LLM review of visual quality (uses the file\'s rendered screenshot when available).',
    parameters: CheckFileHealthParams,
  };

  async run(): Promise<ToolResponse<CheckFileHealthDetails>> {
    const user = this.context.effectiveUser;
    if (!user) return fail(this.parameters.fileId, 'CheckFileHealth requires effectiveUser in AgentContext.', true);
    const { fileId, llmJudge } = this.parameters;
    try {
      const loaded = await FilesAPI.loadFile(fileId, user);
      const file = loaded.data;
      if (!file) return fail(fileId, `File ${fileId} not found.`);
      if (!isRubricFileType(file.type)) {
        return fail(fileId, `Health rubric is only available for question, dashboard, and story files (got ${file.type}).`);
      }

      let report = scoreFileDeterministic(file.type, file.content);
      if (llmJudge) {
        // Reuse the current file's already-captured screenshot when available (visual judgment
        // is far stronger than markup-only); otherwise the judge falls back to markup.
        const screenshotUrl = screenshotUrlFor(this.context.appState, fileId);
        const judge = await judgeFile({ fileType: file.type, content: file.content, screenshotUrl });
        report = combineReports(report, judge);
      }

      const details: CheckFileHealthDetails = { success: true, fileId, report };
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, report }) }], isError: false, details };
    } catch (err) {
      return fail(fileId, err instanceof Error ? err.message : String(err), true);
    }
  }
}
