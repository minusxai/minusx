/**
 * Rubric scoring math — pure. Turns a flat findings list into per-category scores and a
 * weighted overall + grade. All tunable constants (deductions, per-type category weights,
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

/** Points deducted from a category's 100 baseline per finding, by severity. */
export const SEVERITY_DEDUCTION: Record<RubricSeverity, number> = {
  error: 25,
  warn: 10,
  info: 3,
};

/** Fixed category order — every report emits all three, even with no findings. */
export const CATEGORIES: readonly RubricCategory[] = ['clarity', 'correctness', 'craft'];

/** Per-type category weights (each row sums to 1). */
export const CATEGORY_WEIGHTS: Record<RubricFileType, Record<RubricCategory, number>> = {
  question: { clarity: 0.3, correctness: 0.5, craft: 0.2 },
  dashboard: { clarity: 0.2, correctness: 0.5, craft: 0.3 },
  story: { clarity: 0.3, correctness: 0.3, craft: 0.4 },
};

export const GRADE_GOOD_MIN = 80;
export const GRADE_FAIR_MIN = 50;

export function gradeFor(overall: number): RubricGrade {
  if (overall >= GRADE_GOOD_MIN) return 'good';
  if (overall >= GRADE_FAIR_MIN) return 'fair';
  return 'poor';
}

/** Deduct severity points from 100 for one category's findings, floored at 0. */
export function scoreCategory(
  category: RubricCategory,
  weight: number,
  findings: RubricFinding[],
): RubricCategoryScore {
  const deduction = findings.reduce((sum, f) => sum + SEVERITY_DEDUCTION[f.severity], 0);
  return { category, weight, findings, score: Math.max(0, 100 - deduction) };
}

/**
 * Assemble a full report from a flat findings list. Findings are grouped by their own
 * `category`; every category is always present (missing → score 100). Overall is the
 * weight-weighted mean of category scores, rounded to an integer.
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
  const overall = Math.round(
    categories.reduce((sum, c) => sum + c.score * c.weight, 0),
  );
  return { fileType, source, overall, grade: gradeFor(overall), categories };
}
