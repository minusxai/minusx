/**
 * Per-type judge rubrics. The judge sees the file markup + a rendered screenshot and
 * grades the SUBJECTIVE / VISUAL dimensions the deterministic pass can't — so these focus on
 * "is this the right chart", "does the frame carry the insight", "does it look crafted".
 * Criteria are distilled from the skill_* prompts in orchestrator/prompts/prompts.yaml.
 */
import type { RubricFileType } from '../types';

const SHARED = `You are a strict but fair reviewer of BI artifacts. You are given a file's markup and a
screenshot of how it renders. Grade only what you can SEE and what the markup shows — never invent problems.
Judge across three categories, assigning each finding to the FIRST that applies (priority order):
(1) correctness — is it wrong, broken, or dishonest? does the visual actually support its claim; are
labels/units/axes honest; is it even the right chart for the data. (2) clarity — it's correct, but is it
hard to understand at a glance? readability, overload, missing labels. (3) aesthetics — it works and reads
fine, but is it genuinely beautiful and polished (deliberate palette, typography, composition, visual
delight) or generic/AI-default?
Report each problem as one finding with a category, a severity (error = misleads or breaks the point,
warn = notably weakens it, info = polish), a short title, a concrete detail, and an imperative fix the
author can act on. If the artifact is genuinely good, return NO findings. Do not restate deterministic/lint
issues (query length, missing params) — focus on what needs human/visual judgment. Call SubmitRubric exactly once.`;

const PER_TYPE: Record<RubricFileType, string> = {
  question: `This is a single question (one chart or table).
Judge: is the chart type the right fit for the data and the question being asked (comparison → bar,
trend → line, part-of-whole → pie only with few slices, correlation → scatter)? Are axes/units/legends
labeled and readable? Is there overplotting, too many colors, or a misleading scale? Would a reader grasp
the takeaway in a few seconds?`,
  dashboard: `This is a dashboard (multiple tiles).
Judge: is there a clear visual hierarchy (most important KPI prominent, F-pattern top-left emphasis)? Do
the tiles tell one coherent story or are they a random grid? Are the charts individually the right type and
readable at tile size? Is it cluttered or well-composed?`,
  story: `This is a data story (an editorial page with embedded live charts/numbers).
Judge (from the story craft bar): does it make ONE clear argument with a stated lead finding (a claim with a
number), not just decoration? Do headlines state findings, not topics? Is there a deliberate palette with one
protagonist accent — and NOT an AI-default look (cream+serif+terracotta, acid-green-on-black, purple
gradients, generic hairline-rule broadsheet)? Does the frame around each chart carry the insight? Is it
honest about what the data shows?`,
};

export function judgeSystemPrompt(fileType: RubricFileType): string {
  return `${SHARED}\n\n${PER_TYPE[fileType]}`;
}
