/**
 * LLM judge — the second rubric flavor. Grades the subjective/visual dimensions a static check
 * can't, from the file markup + a rendered screenshot. Emits the SAME findings shape as the
 * deterministic scorers, so `buildReport` scores both identically and they can be merged.
 *
 * Runs on the shared micro-task infra (`runMicroTask` → `MicroAgent` → orchestrator), NOT a
 * bespoke LLM call: prompts live in `micro.rubric_judge` (prompts.yaml), model + usage tracking
 * come for free. The screenshot rides along as an image content block on the micro context.
 *
 * See `frontend/docs/rubrik.md`.
 */
import 'server-only';
import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { fileToMarkup } from '@/lib/data/file-markup';
import type { ImageContent } from '@/orchestrator/llm';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { RubricCategory, RubricFinding, RubricFileType, RubricReport, RubricSeverity } from '../types';
import { buildReport } from '../scoring';
import { judgeCriteria } from './prompts';

const CATEGORIES: readonly RubricCategory[] = ['correctness', 'clarity', 'aesthetics'];
const SEVERITIES: readonly RubricSeverity[] = ['error', 'warn', 'info'];

export interface JudgeParams {
  fileType: RubricFileType;
  content: unknown;
  /** Rendered full-file screenshot — an https URL (app screenshot pipeline) or a `data:` URL
   *  (client-captured). Either becomes an image content block for the judge. */
  screenshotUrl?: string;
}

/** Build an image content block from an https URL or a base64 `data:` URL. */
function imageBlock(src: string): ImageContent {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(src);
  return m ? { type: 'image', data: m[2], mimeType: m[1] } : { type: 'image', url: src };
}

/** Run the LLM judge for a file and build its report (`source: 'llm-judge'`). */
export async function judgeFile(params: JudgeParams, user: EffectiveUser): Promise<RubricReport> {
  const { fileType, content, screenshotUrl } = params;
  const vars: Record<string, string> = {
    file_type: fileType,
    criteria: judgeCriteria(fileType),
    markup: fileToMarkup(fileType, content),
    screenshot_note: screenshotUrl
      ? 'A screenshot of how it renders is attached below.'
      : '(No screenshot available — judge from the markup.)',
  };
  const images = screenshotUrl ? [imageBlock(screenshotUrl)] : undefined;

  let findings: RubricFinding[] = [];
  try {
    findings = parseFindings(await runMicroTask('rubric_judge', vars, user, images));
  } catch {
    // best-effort — a failed/garbled judge yields an empty (5/5) report rather than throwing.
  }
  return buildReport(fileType, 'llm-judge', findings);
}

/** Parse the judge's JSON reply into validated findings. Tolerant of surrounding prose. */
function parseFindings(text: string): RubricFinding[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const raw = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(raw)) return [];

  const out: RubricFinding[] = [];
  raw.forEach((r, i) => {
    const f = r as Partial<RubricFinding>;
    if (!CATEGORIES.includes(f.category as RubricCategory)) return;
    if (!SEVERITIES.includes(f.severity as RubricSeverity)) return;
    if (!f.title) return;
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
