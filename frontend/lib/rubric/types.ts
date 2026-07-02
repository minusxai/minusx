/**
 * File Health Rubric — shared report contract.
 *
 * A rubric scores the health of a BI file (question / dashboard / story) and returns
 * actionable findings the agent can act on. Two flavors produce the SAME shape:
 *  - deterministic: pure `content → RubricReport` (see `deterministic/*`, `scoring.ts`)
 *  - llm:           `(content + screenshot) → RubricReport` (see `llm/*`)
 *
 * See `frontend/docs/rubrik.md` for the rule catalog and research backing.
 */
import type { FileType } from '@/lib/types';

export type RubricSeverity = 'error' | 'warn' | 'info';

/**
 * Analytic-rubric dimensions. Three orthogonal buckets, assigned by a PRIORITY WATERFALL —
 * a rule belongs to the FIRST category whose test it fails, in this order:
 * - correctness: "If ignored, is it wrong, broken, or dishonest?" (params, viz config, layout
 *   integrity, fabricated numbers, a chart that physically can't represent the data)
 * - clarity: "It's correct, but is it hard to understand at a glance?" (labels, descriptions,
 *   headlines, query bloat, too many series, tile too small, overload)
 * - aesthetics: "It works and reads fine, but does it look unpolished/generic?" (palette,
 *   typography, design tokens, composition, AI-default look)
 */
export type RubricCategory = 'correctness' | 'clarity' | 'aesthetics';

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
  score: number | null;      // 1–5, or null when this source didn't assess the category
  weight: number;            // per-type category weight (sums to 1 across categories)
  assessed: boolean;         // did this source actually evaluate this category? (e.g. deterministic
                             // never assesses aesthetics for question/dashboard — judge-only there)
  findings: RubricFinding[];
}

export type RubricGrade = 'good' | 'fair' | 'poor';
export type RubricSource = 'deterministic' | 'llm' | 'combined';

export interface RubricReport {
  fileType: FileType;
  source: RubricSource;
  overall: number;           // 0–100 weighted mean of category scores
  grade: RubricGrade;        // >=80 good / >=50 fair / else poor
  categories: RubricCategoryScore[];
}

/** A deterministic scorer is a pure function from a file's content to a flat findings list. */
export type DeterministicScorer<TContent = unknown> = (content: TContent) => RubricFinding[];
