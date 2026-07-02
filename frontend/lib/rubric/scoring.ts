/**
 * Rubric scoring math — pure. Turns a flat findings list into per-category scores and a
 * weighted overall + grade on a coarse **1–5 scale** (deliberately low-resolution to avoid
 * false precision / variance). All tunable constants (deductions, per-type category weights,
 * grade bands) live here so they can be calibrated against a human gold set later.
 *
 * See `frontend/docs/rubrik.md`.
 */
import type {
  RubricCategory,
  RubricCategoryScore,
  RubricFileType,
  RubricFinding,
  RubricGrade,
  RubricReport,
  RubricSeverity,
  RubricSource,
} from './types';

/** Every score starts here (perfect) and findings deduct from it. */
export const MAX_SCORE = 5;
export const MIN_SCORE = 1;

/** Points deducted from the 5 baseline per finding, by severity. */
export const SEVERITY_DEDUCTION: Record<RubricSeverity, number> = {
  error: 2,
  warn: 1,
  info: 0.5,
};

/** Fixed category order (priority waterfall) — every report emits all three. */
export const CATEGORIES: readonly RubricCategory[] = ['correctness', 'clarity', 'aesthetics'];

/** Per-type category weights (each row sums to 1). */
export const CATEGORY_WEIGHTS: Record<RubricFileType, Record<RubricCategory, number>> = {
  question:  { correctness: 0.5,  clarity: 0.35, aesthetics: 0.15 },
  dashboard: { correctness: 0.45, clarity: 0.35, aesthetics: 0.2 },
  story:     { correctness: 0.3,  clarity: 0.3,  aesthetics: 0.4 },
};

export const GRADE_GOOD_MIN = 4;
export const GRADE_FAIR_MIN = 2.5;

/** Round to the nearest 0.5 and clamp into [1, 5]. */
function toScore(raw: number): number {
  const half = Math.round(raw * 2) / 2;
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, half));
}

export function gradeFor(overall: number): RubricGrade {
  if (overall >= GRADE_GOOD_MIN) return 'good';
  if (overall >= GRADE_FAIR_MIN) return 'fair';
  return 'poor';
}

/** Deduct severity points from 5 for one category's findings, rounded/clamped to [1,5]. */
export function scoreCategory(
  category: RubricCategory,
  weight: number,
  findings: RubricFinding[],
): RubricCategoryScore {
  const deduction = findings.reduce((sum, f) => sum + SEVERITY_DEDUCTION[f.severity], 0);
  return { category, weight, findings, score: toScore(MAX_SCORE - deduction) };
}

/**
 * Assemble a full report from a flat findings list. Findings are grouped by their own
 * `category`; every category is always present (missing → score 5). Overall is the
 * weight-weighted mean of category scores, on the same 1–5 scale.
 */
export function buildReport(
  fileType: RubricFileType,
  source: RubricSource,
  findings: RubricFinding[],
): RubricReport {
  const weights = CATEGORY_WEIGHTS[fileType];
  const categories = CATEGORIES.map((category) =>
    scoreCategory(category, weights[category], findings.filter((f) => f.category === category)),
  );
  const overall = toScore(categories.reduce((sum, c) => sum + c.score * c.weight, 0));
  return { fileType, source, overall, grade: gradeFor(overall), categories };
}
