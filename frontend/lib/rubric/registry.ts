/**
 * Deterministic rubric entrypoint: maps a file type to its pure scorer and assembles the
 * report. This is what auto-inject, the CheckFileHealth tool, and the API route all call.
 */
import type { DeterministicScorer, RubricCategory, RubricFileType, RubricReport } from './types';
import { buildReport } from './scoring';
import { scoreQuestion } from './deterministic/question';
import { scoreDashboard } from './deterministic/dashboard';
import { scoreStory } from './deterministic/story';

const SCORERS: Record<RubricFileType, DeterministicScorer> = {
  question: scoreQuestion as DeterministicScorer,
  dashboard: scoreDashboard as DeterministicScorer,
  story: scoreStory as DeterministicScorer,
};

/**
 * Which categories the DETERMINISTIC scorer actually evaluates per file type. Aesthetics is
 * judge-only for question/dashboard (no static beauty rules), so it's not claimed here — the
 * report marks it unassessed rather than a misleading 5/5. The judge assesses all three.
 */
const DETERMINISTIC_COVERAGE: Record<RubricFileType, RubricCategory[]> = {
  question: ['correctness', 'clarity'],
  dashboard: ['correctness', 'clarity'],
  story: ['correctness', 'clarity', 'aesthetics'],
};

const RUBRIC_FILE_TYPES = Object.keys(SCORERS) as RubricFileType[];

export function isRubricFileType(type: string): type is RubricFileType {
  return (RUBRIC_FILE_TYPES as string[]).includes(type);
}

/** Run the deterministic scorer for a supported file type and build its report. */
export function scoreFileDeterministic(fileType: RubricFileType, content: unknown): RubricReport {
  const findings = SCORERS[fileType](content);
  return buildReport(fileType, 'deterministic', findings, DETERMINISTIC_COVERAGE[fileType]);
}
