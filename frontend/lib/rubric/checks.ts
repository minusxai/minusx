/**
 * Display catalog of the DETERMINISTIC checks per file type — used by the UI to show the checks
 * that PASSED (a rule that didn't fire), alongside the findings that failed. Keep this in sync
 * with the rules in `deterministic/*` (ruleId must match the finding a rule emits).
 */
import type { RubricCategory, RubricFileType, RubricReport } from './types';

export interface RubricCheck {
  ruleId: string;
  label: string;            // positive phrasing shown when the check passed
  category: RubricCategory;
}

export const DETERMINISTIC_CHECKS: Record<RubricFileType, RubricCheck[]> = {
  question: [
    { ruleId: 'question.undeclared-param', label: 'Parameters declared', category: 'correctness' },
    { ruleId: 'question.unused-param', label: 'No unused parameters', category: 'correctness' },
    { ruleId: 'question.viz-config-incomplete', label: 'Chart configured', category: 'correctness' },
    { ruleId: 'question.pie-multi-measure', label: 'Chart fits the data', category: 'correctness' },
    { ruleId: 'question.query-too-long', label: 'Query size OK', category: 'clarity' },
    { ruleId: 'question.too-many-series', label: 'Series count OK', category: 'clarity' },
    { ruleId: 'question.no-description', label: 'Has a description', category: 'clarity' },
  ],
  dashboard: [
    { ruleId: 'dashboard.asset-not-in-layout', label: 'All assets laid out', category: 'correctness' },
    { ruleId: 'dashboard.layout-orphan', label: 'No orphan tiles', category: 'correctness' },
    { ruleId: 'dashboard.tile-overlap', label: 'No overlapping tiles', category: 'correctness' },
    { ruleId: 'dashboard.duplicate-question', label: 'No duplicate questions', category: 'correctness' },
    { ruleId: 'dashboard.tile-too-small', label: 'Tiles large enough', category: 'clarity' },
    { ruleId: 'dashboard.visual-count', label: 'Visual count OK', category: 'clarity' },
    { ruleId: 'dashboard.no-description', label: 'Has a description', category: 'clarity' },
  ],
  story: [
    { ruleId: 'story.no-evidence', label: 'Has live evidence', category: 'correctness' },
    { ruleId: 'story.typed-number', label: 'Numbers are live', category: 'correctness' },
    { ruleId: 'story.no-headline', label: 'Has a headline', category: 'clarity' },
    { ruleId: 'story.no-lead', label: 'Has a lead', category: 'clarity' },
    { ruleId: 'story.no-design-tokens', label: 'Design tokens defined', category: 'aesthetics' },
    { ruleId: 'story.too-many-colors', label: 'Palette disciplined', category: 'aesthetics' },
  ],
};

/** Deterministic checks that PASSED for a report: not fired, and in an assessed category. */
export function passedChecks(fileType: RubricFileType, report: RubricReport): RubricCheck[] {
  const fired = new Set(report.categories.flatMap((c) => c.findings).map((f) => f.ruleId));
  const assessed = new Set(report.categories.filter((c) => c.assessed).map((c) => c.category));
  return (DETERMINISTIC_CHECKS[fileType] ?? []).filter((chk) => !fired.has(chk.ruleId) && assessed.has(chk.category));
}
