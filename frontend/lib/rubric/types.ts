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
export type RubricFileType = 'question' | 'dashboard' | 'story' | 'context';

/** Which scorer produced a finding — a deterministic rule, or the LLM checklist. */
export type FindingSource = 'rule' | 'llm';

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
  source: FindingSource;     // 'rule' (deterministic) or 'llm'
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

export interface RubricReport {
  fileType: FileType;
  overall: number;           // 1–5 weighted mean of assessed category scores
  grade: RubricGrade;        // >=4 good / >=2.5 fair / else poor
  categories: RubricCategoryScore[];
}

/**
 * Optional cross-file context for deterministic scorers. Content-only rules ignore it; a few
 * rules need light info from referenced files (e.g. a dashboard tile's chart TYPE lives on the
 * referenced question, not in the dashboard content).
 */
export interface DeterministicContext {
  /** viz `type` per referenced question id (for dashboard tile rules). */
  vizTypeByQuestionId?: Record<number, string>;
}

/** A deterministic scorer is a (mostly) pure function from a file's content to findings. */
export type DeterministicScorer<TContent = unknown> = (content: TContent, ctx?: DeterministicContext) => RubricFinding[];

/**
 * Lean, agent-facing projection of a report (auto-injected into what the LLM reads). Drops the
 * internal `weight` / `assessed` bookkeeping and omits categories the source didn't score —
 * just the overall, grade, and each scored category's findings.
 */
export interface AgentRubricCategory {
  category: RubricCategory;
  score: number;
  findings: RubricFinding[];
}
export interface AgentRubric {
  overall: number;
  grade: RubricGrade;
  categories: AgentRubricCategory[];
}
