import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { FilesAPI } from '@/lib/data/files.server';
import { isRubricFileType } from '@/lib/rubric/registry';
import { scoreFile, scoreFileDeterministicResolved } from '@/lib/rubric/score-file.server';
import { toAgentRubric } from '@/lib/rubric/scoring';
import type { RubricReport } from '@/lib/rubric/types';
import type { AnalystAgentContext } from './types';

// ─── CheckFileHealth ──────────────────────────────────────────────────────────
// Server tool: scores a question/dashboard/story's health and returns actionable findings.
// The same deterministic report is auto-injected on every read; this tool lets the agent
// re-check on demand (e.g. after an edit) and optionally add the LLM visual-quality judge.

const CheckFileHealthParams = Type.Object({
  fileId: Type.Number({ description: 'ID of the file to health-check (question, dashboard, or story).' }),
  llmJudge: Type.Optional(Type.Boolean({
    description: 'When true, also run the LLM judge for subjective/visual quality (slower). Default false.',
  })),
  screenshotUrl: Type.Optional(Type.String({
    description: 'Optional rendered-file screenshot URL for the judge to grade (https or data: URL). Defaults to the current file\'s app-state screenshot.',
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
      + '(0–5 score + grade across correctness/clarity/aesthetics, each finding with a concrete fix; '
      + 'any `error` finding gates the score to 0 — ALWAYS fix errors, try to fix warnings). '
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

      // With llmJudge, run BOTH (scoreFile) reusing the current file's already-captured
      // screenshot when the caller didn't pass one; otherwise deterministic only.
      const report = llmJudge
        ? await scoreFile(file.type, file.content, user,
            this.parameters.screenshotUrl ?? screenshotUrlFor(this.context.appState, fileId))
        : await scoreFileDeterministicResolved(file.type, file.content, user);

      // The agent reads `content` — give it the lean rubric (no weight/assessed; findings tagged
      // rule/llm). `details` keeps the full report for the UI.
      const details: CheckFileHealthDetails = { success: true, fileId, report };
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, report: toAgentRubric(report) }) }], isError: false, details };
    } catch (err) {
      return fail(fileId, err instanceof Error ? err.message : String(err), true);
    }
  }
}
