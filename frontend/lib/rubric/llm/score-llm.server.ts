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

// LLM-as-judge is lenient and noisy — one pass rubber-stamps, and a skipped check is silently
// treated as "passed". Run the judge several times and aggregate WORST-OF: a check fails if it
// fails in at least FAIL_VOTES of the runs (default 1 — any run that catches a real problem wins).
// Bump FAIL_VOTES toward a majority if the strict prompt starts producing false positives.
const JUDGE_VOTES = 1;
const FAIL_VOTES = 1;

interface CheckVerdict { id: string; applicable?: unknown; pass?: unknown; reason?: unknown }

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
  // The categories the LLM covers for this type (e.g. context has none → no LLM call at all).
  const assessed = [...new Set(LLM_CHECKS[fileType].map((c) => c.category))];
  if (LLM_CHECKS[fileType].length === 0) return buildReport(fileType, [], assessed);

  const vars: Record<string, string> = {
    file_type: fileType,
    checklist: formatChecklist(fileType),
    markup: fileToMarkup(fileType, content),
    screenshot_note: screenshotUrl
      ? 'A screenshot of how it renders is attached below.'
      : '(No screenshot available — judge from the markup only, and mark visual-only checks applicable:false.)',
  };
  const images = screenshotUrl ? [imageBlock(screenshotUrl)] : undefined;

  // Run the judge JUDGE_VOTES times independently (parallel — same latency, N× cost), then
  // aggregate worst-of so a real problem caught by any single run survives.
  const runs = await Promise.all(Array.from({ length: JUDGE_VOTES }, () =>
    runMicroTask('rubric_llm', vars, user, images).then(parseVerdicts, () => [] as CheckVerdict[])));
  return buildReport(fileType, findingsFromVotes(fileType, runs), assessed);
}

/** Parse one judge reply into its per-check verdicts. Tolerant of surrounding prose / bad JSON. */
function parseVerdicts(text: string): CheckVerdict[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  try {
    const results = (JSON.parse(text.slice(start, end + 1)) as { checks?: unknown })?.checks;
    return Array.isArray(results) ? (results as CheckVerdict[]).filter((r) => typeof r?.id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Aggregate N judge runs into findings — WORST-OF: a check becomes a finding when it is failed
 * (applicable, pass:false) in ≥ FAIL_VOTES of the runs. A check omitted by a run counts as neither
 * pass nor fail for that run — so a check every run skips simply produces no finding, but any run
 * that DID evaluate and fail it still triggers. Uses the catalog for category/severity/label/fix.
 */
function findingsFromVotes(fileType: RubricFileType, runs: CheckVerdict[][]): RubricFinding[] {
  const out: RubricFinding[] = [];
  for (const chk of LLM_CHECKS[fileType]) {
    const fails = runs.flatMap((run) => run.filter((v) => v.id === chk.id && v.applicable !== false && v.pass === false));
    if (fails.length < FAIL_VOTES) continue;
    out.push({
      ruleId: `llm.${chk.id}`,
      category: chk.category,
      severity: chk.severity,
      title: chk.label,
      detail: String(fails[0].reason ?? ''),
      fix: chk.fix,
      source: 'llm',
    });
  }
  return out;
}

/** Merge a deterministic and an LLM report into one. A category is assessed if EITHER scored it
 *  (the LLM covers all three); each finding already carries its own `source`. */
export function combineReports(deterministic: RubricReport, llm: RubricReport): RubricReport {
  const findings = [...deterministic.categories, ...llm.categories].flatMap((c) => c.findings);
  const assessed = CATEGORIES.filter((cat) =>
    [deterministic, llm].some((r) => r.categories.find((c) => c.category === cat)?.assessed));
  return buildReport(deterministic.fileType as RubricFileType, findings, assessed);
}
