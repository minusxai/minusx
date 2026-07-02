/**
 * File Health Rubric — shared report contract.
 *
 * A rubric scores the health of a BI file (question / dashboard / story) and returns
 * actionable findings the agent can act on. Two flavors produce the SAME shape:
 *  - deterministic: pure `content → RubricReport` (see `deterministic/*`, `scoring.ts`)
 *  - llm-judge:     `(content + screenshot) → RubricReport` (see `judge/*`)
 *
 * See `frontend/docs/rubrik.md` for the rule catalog and research backing.
 */
import type { FileType } from '@/lib/types';

export type RubricSeverity = 'error' | 'warn' | 'info';

/**
 * Analytic-rubric dimensions. Every finding belongs to exactly one.
 * - clarity: understandable at a glance (descriptions, headlines, query size)
 * - correctness: structurally sound & honest (params in sync, viz configured, layout integrity)
 * - craft: readability / right-chart-for-the-task / composition
 * - aesthetics: visual beauty & polish (palette, design tokens, does it look delightful)
 */
export type RubricCategory = 'clarity' | 'correctness' | 'craft' | 'aesthetics';

/** File types the rubric currently scores. */
export type RubricFileType = 'question' | 'dashboard' | 'story';

/**
 * One actionable problem found on a file. `detail` says what's wrong (with the offending
 * value); `fix` is an imperative instruction the agent can act on directly.
 */
export interface RubricFinding {
  ruleId: string;            // stable id, e.g. 'question.query-too-long'
  category: RubricCategory;
  severity: RubricSeverity;
  title: string;             // short human label
  detail: string;            // what's wrong
  fix: string;               // imperative, agent-actionable
}

export interface RubricCategoryScore {
  category: RubricCategory;
  score: number;             // 0–100
  weight: number;            // per-type category weight (sums to 1 across categories)
  findings: RubricFinding[];
}

export type RubricGrade = 'good' | 'fair' | 'poor';
export type RubricSource = 'deterministic' | 'llm-judge' | 'combined';

export interface RubricReport {
  fileType: FileType;
  source: RubricSource;
  overall: number;           // 0–100 weighted mean of category scores
  grade: RubricGrade;        // >=80 good / >=50 fair / else poor
  categories: RubricCategoryScore[];
}

/** A deterministic scorer is a pure function from a file's content to a flat findings list. */
export type DeterministicScorer<TContent = unknown> = (content: TContent) => RubricFinding[];
