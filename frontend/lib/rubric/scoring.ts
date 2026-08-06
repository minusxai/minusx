/**
 * Rubric scoring math — pure. Turns a flat findings list into per-category scores and a
 * weighted overall + grade on a coarse **0–5 scale** (deliberately low-resolution to avoid
 * false precision / variance). All tunable constants (warning deduction, per-type category weights,
 * grade bands) live here so they can be calibrated against a human gold set later.
 *
 * See `CLAUDE.md` — "Auth, Access Control, Mode Isolation, HTTP Helpers, and the File-Health
 * Rubric".
 */
import type {
  AgentRubric,
  RubricCategory,
  RubricCategoryScore,
  RubricFileType,
  RubricFinding,
  RubricGrade,
  RubricReport,
  RubricSeverity,
} from './types';

/** Every score starts here (perfect) and findings deduct from it. */
export const MAX_SCORE = 5;
export const MIN_SCORE = 0;

export interface SeverityScoringBehavior {
  /** Points subtracted from the finding's category. Ignored when `gatesCategory` is true. */
  categoryDeduction: number;
  /** Whether one finding of this severity forces its category score to 0. */
  gatesCategory: boolean;
  /** Whether one finding of this severity forces the overall score to 0. */
  gatesOverall: boolean;
}

/** The single severity → scoring-behavior map. Change warning weight or gating behavior here. */
export const SEVERITY_SCORING: Record<RubricSeverity, SeverityScoringBehavior> = {
  error: { categoryDeduction: 0, gatesCategory: true, gatesOverall: true },
  warn: { categoryDeduction: 1, gatesCategory: false, gatesOverall: false },
};

/** Fixed category order (priority waterfall) — every report emits all three. */
const CATEGORIES: readonly RubricCategory[] = ['correctness', 'clarity', 'aesthetics'];

/** Per-type category weights (each row sums to 1). */
export const CATEGORY_WEIGHTS: Record<RubricFileType, Record<RubricCategory, number>> = {
  question:  { correctness: 0.3,  clarity: 0.3, aesthetics: 0.4 },
  dashboard: { correctness: 0.3, clarity: 0.3, aesthetics: 0.4 },
  story:     { correctness: 0.3,  clarity: 0.3,  aesthetics: 0.4 },
  context:   { correctness: 0.5,  clarity: 0.5,  aesthetics: 0 }, // a knowledge file — no aesthetics
};

const GRADE_GOOD_MIN = 4;
const GRADE_FAIR_MIN = 2.5;

/** Round to the nearest 0.5 and clamp into [0, 5]. */
function toScore(raw: number): number {
  const half = Math.round(raw * 2) / 2;
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, half));
}

export function gradeFor(overall: number): RubricGrade {
  if (overall >= GRADE_GOOD_MIN) return 'good';
  if (overall >= GRADE_FAIR_MIN) return 'fair';
  return 'poor';
}

const gatesCategory = (findings: RubricFinding[]) =>
  findings.some((finding) => SEVERITY_SCORING[finding.severity].gatesCategory);

const gatesOverall = (findings: RubricFinding[]) =>
  findings.some((finding) => SEVERITY_SCORING[finding.severity].gatesOverall);

/**
 * Score one category. When `assessed` is false the source didn't evaluate this category (e.g.
 * deterministic aesthetics on a question) — score is `null` and it's excluded from the overall.
 * An `error` finding zeroes the category outright; every `warn` finding deducts the fixed amount.
 */
export function scoreCategory(
  category: RubricCategory,
  weight: number,
  findings: RubricFinding[],
  assessed = true,
): RubricCategoryScore {
  if (!assessed) return { category, weight, findings, score: null, assessed: false };
  if (gatesCategory(findings)) return { category, weight, findings, score: MIN_SCORE, assessed: true };
  const deduction = findings.reduce(
    (total, finding) => total + SEVERITY_SCORING[finding.severity].categoryDeduction,
    0,
  );
  return { category, weight, findings, score: toScore(MAX_SCORE - deduction), assessed: true };
}

/**
 * Assemble a full report from a flat findings list. All categories are emitted; those NOT in
 * `assessed` are marked `assessed: false` / `score: null` (the source didn't check them). The
 * overall is the weighted mean over ONLY the assessed categories, their weights renormalized to
 * sum to 1 — so an unchecked category never pads (or drags) the total.
 */
export function buildReport(
  fileType: RubricFileType,
  findings: RubricFinding[],
  assessed: readonly RubricCategory[] = CATEGORIES,
): RubricReport {
  const weights = CATEGORY_WEIGHTS[fileType];
  const assessedSet = new Set(assessed);
  const categories = CATEGORIES.map((category) =>
    scoreCategory(category, weights[category], findings.filter((f) => f.category === category), assessedSet.has(category)),
  );
  const scored = categories.filter((c): c is RubricCategoryScore & { score: number } => c.assessed && c.score !== null);
  const totalWeight = scored.reduce((sum, c) => sum + c.weight, 0) || 1;
  // Overall-gating severities force 0 / poor regardless of how clean the other categories are.
  const overall = gatesOverall(findings)
    ? MIN_SCORE
    : toScore(scored.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight);
  return { fileType, overall, grade: gradeFor(overall), categories };
}

/** Lean projection for the agent — overall/grade/source + each SCORED category's findings only.
 *  Drops weight/assessed; tags each finding with its `source` (deterministic rule vs LLM check). */
export function toAgentRubric(report: RubricReport): AgentRubric {
  return {
    overall: report.overall,
    grade: report.grade,
    categories: report.categories
      .filter((c): c is RubricCategoryScore & { score: number } => c.assessed && c.score !== null)
      .map((c) => ({
        category: c.category,
        score: c.score,
        findings: c.findings.map((f) => ({ ...f, source: (f.ruleId.startsWith('llm.') ? 'llm' : 'rule') as 'rule' | 'llm' })),
      })),
  };
}
