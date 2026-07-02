/**
 * LLM judge — the second rubric flavor. Grades the subjective/visual dimensions a static
 * check can't, from the file markup + a rendered screenshot. Emits the SAME findings shape as
 * the deterministic scorers, so `buildReport` scores both identically and they can be merged.
 *
 * Standalone server function (not an orchestrator tool run): builds a one-shot Context and
 * calls `streamSimple`, forcing structured output via the `SubmitRubric` tool. The LLM call is
 * dependency-injected so it can be tested without a provider.
 *
 * See `frontend/docs/rubrik.md`.
 */
import 'server-only';
import { Type } from 'typebox';
import { getModel, streamSimple } from '@/orchestrator/llm';
import type { AssistantMessage, Context, Model, Api, Tool } from '@/orchestrator/llm';
import { fileToMarkup } from '@/lib/data/file-markup';
import type { RubricCategory, RubricFinding, RubricFileType, RubricReport, RubricSeverity } from '../types';
import { buildReport } from '../scoring';
import { judgeSystemPrompt } from './prompts';

/** Dedicated judge model — always Opus, independent of any chat model config. */
let judgeModel: Model<Api> = getModel('anthropic', 'claude-opus-4-8');

/** Override the judge model (for tests). Returns the previous model. */
export function setJudgeModel(m: Model<Api>): Model<Api> {
  const prev = judgeModel;
  judgeModel = m;
  return prev;
}

const CATEGORY = Type.Union([Type.Literal('clarity'), Type.Literal('correctness'), Type.Literal('craft'), Type.Literal('aesthetics')]);
const SEVERITY = Type.Union([Type.Literal('error'), Type.Literal('warn'), Type.Literal('info')]);

const SubmitRubricParams = Type.Object({
  findings: Type.Array(Type.Object({
    category: CATEGORY,
    severity: SEVERITY,
    title: Type.String({ description: 'short human label' }),
    detail: Type.String({ description: 'what is wrong, referencing what you see' }),
    fix: Type.String({ description: 'imperative, actionable instruction to fix it' }),
  }), { description: 'All problems found. Empty array if the artifact is genuinely good.' }),
});

/** The judge's structured-output tool. Exported so callers/tests can reference its name. */
export const SubmitRubric: Tool<typeof SubmitRubricParams> = {
  name: 'SubmitRubric',
  description: 'Submit the health review as a list of findings. Call exactly once.',
  parameters: SubmitRubricParams,
};

export interface JudgeParams {
  fileType: RubricFileType;
  content: unknown;
  /** Public URL of the rendered full-file screenshot (from the app screenshot pipeline). */
  screenshotUrl?: string;
  model?: Model<Api>;
}

/** Injectable LLM call — defaults to a one-shot `streamSimple`. */
export type CallModel = (model: Model<Api>, ctx: Context) => Promise<AssistantMessage | undefined>;
const defaultCallModel: CallModel = (model, ctx) => streamSimple(model, ctx).result();

/** Run the LLM judge for a file and build its report (`source: 'llm-judge'`). */
export async function judgeFile(params: JudgeParams, callModel: CallModel = defaultCallModel): Promise<RubricReport> {
  const { fileType, content, screenshotUrl } = params;
  const markup = fileToMarkup(fileType, content);

  const userText = `Review this ${fileType}. Its markup:\n\n${markup}\n\n`
    + (screenshotUrl ? 'A screenshot of how it renders is attached.' : '(No screenshot available — judge from the markup.)');

  const ctx: Context = {
    systemPrompt: judgeSystemPrompt(fileType),
    messages: [{
      role: 'user',
      timestamp: Date.now(),
      content: screenshotUrl
        ? [{ type: 'text', text: userText }, { type: 'image', url: screenshotUrl }]
        : userText,
    }],
    tools: [SubmitRubric as Tool],
  };

  const msg = await callModel(params.model ?? judgeModel, ctx);
  const findings = extractFindings(msg);
  return buildReport(fileType, 'llm-judge', findings);
}

/** Pull the SubmitRubric tool-call args out of the assistant message → findings. */
function extractFindings(msg: AssistantMessage | undefined): RubricFinding[] {
  const call = msg?.content.find((c) => c.type === 'toolCall' && c.name === SubmitRubric.name);
  if (!call || call.type !== 'toolCall') return [];
  const raw = (call.arguments?.findings as unknown[]) ?? [];
  const out: RubricFinding[] = [];
  raw.forEach((r, i) => {
    const f = r as Partial<RubricFinding>;
    if (!f.category || !f.severity || !f.title) return;
    out.push({
      ruleId: `judge.${f.category}.${i}`,
      category: f.category as RubricCategory,
      severity: f.severity as RubricSeverity,
      title: String(f.title),
      detail: String(f.detail ?? ''),
      fix: String(f.fix ?? ''),
    });
  });
  return out;
}

/** Merge a deterministic and a judge report into one combined report. */
export function combineReports(deterministic: RubricReport, judge: RubricReport): RubricReport {
  const findings = [...deterministic.categories, ...judge.categories].flatMap((c) => c.findings);
  return buildReport(deterministic.fileType as RubricFileType, 'combined', findings);
}
