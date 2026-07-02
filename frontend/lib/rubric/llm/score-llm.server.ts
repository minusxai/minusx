/**
 * LLM judge — the second rubric flavor. Grades the subjective/visual dimensions a static check
 * can't, from the file markup + a rendered screenshot. Emits the SAME findings shape as the
 * deterministic scorers, so `buildReport` scores both identically and they can be merged.
 *
 * Runs on the shared micro-task infra (`runMicroTask` → `MicroAgent` → orchestrator), NOT a
 * bespoke LLM call: prompts live in `micro.rubric_llm` (prompts.yaml), model + usage tracking
 * come for free. The screenshot rides along as an image content block on the micro context.
 *
 * See `frontend/docs/rubrik.md`.
 */
import 'server-only';
import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { fileToMarkup } from '@/lib/data/file-markup';
import type { ImageContent } from '@/orchestrator/llm';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { RubricCategory, RubricFinding, RubricFileType, RubricReport } from '../types';
import { buildReport } from '../scoring';
import { LLM_CHECKS, formatChecklist } from '../checks';

const CATEGORIES: readonly RubricCategory[] = ['correctness', 'clarity', 'aesthetics'];

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

/**
 * Score a file with the LLM judge and build its report (`source: 'llm'`). The LLM evaluates a
 * CLOSED checklist (`LLM_CHECKS[fileType]`) pass/fail; each FAIL becomes a finding.
 */
export async function scoreFileLLM(params: JudgeParams, user: EffectiveUser): Promise<RubricReport> {
  const { fileType, content, screenshotUrl } = params;
  const vars: Record<string, string> = {
    file_type: fileType,
    checklist: formatChecklist(fileType),
    markup: fileToMarkup(fileType, content),
    screenshot_note: screenshotUrl
      ? 'A screenshot of how it renders is attached below.'
      : '(No screenshot available — judge from the markup only, and mark visual-only checks applicable:false.)',
  };
  const images = screenshotUrl ? [imageBlock(screenshotUrl)] : undefined;

  let findings: RubricFinding[] = [];
  try {
    findings = findingsFromChecks(fileType, await runMicroTask('rubric_llm', vars, user, images));
  } catch {
    // best-effort — a failed/garbled judge yields an empty (5/5) report rather than throwing.
  }
  return buildReport(fileType, 'llm', findings);
}

/**
 * Parse the judge's pass/fail checklist reply into findings — one finding per FAILED,
 * applicable check, using the catalog for category/severity/label/fix. Tolerant of prose.
 */
function findingsFromChecks(fileType: RubricFileType, text: string): RubricFinding[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const results = (parsed as { checks?: unknown })?.checks;
  if (!Array.isArray(results)) return [];

  const byId = new Map(LLM_CHECKS[fileType].map((c) => [c.id, c]));
  const out: RubricFinding[] = [];
  for (const r of results) {
    const res = r as { id?: string; pass?: unknown; applicable?: unknown; reason?: unknown };
    const chk = res.id ? byId.get(res.id) : undefined;
    if (!chk || res.applicable === false || res.pass !== false) continue;
    out.push({
      ruleId: `llm.${chk.id}`,
      category: chk.category,
      severity: chk.severity,
      title: chk.label,
      detail: String(res.reason ?? ''),
      fix: chk.fix,
    });
  }
  return out;
}

/** Merge a deterministic and a judge report into one combined report. A category is assessed in
 *  the combined report if EITHER source assessed it (the judge covers all three). */
export function combineReports(deterministic: RubricReport, judge: RubricReport): RubricReport {
  const findings = [...deterministic.categories, ...judge.categories].flatMap((c) => c.findings);
  const assessed = CATEGORIES.filter((cat) =>
    [deterministic, judge].some((r) => r.categories.find((c) => c.category === cat)?.assessed));
  return buildReport(deterministic.fileType as RubricFileType, 'combined', findings, assessed);
}
