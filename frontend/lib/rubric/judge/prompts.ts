/**
 * Per-type judge criteria, injected as the `{criteria}` var into the `micro.rubric_judge`
 * prompt (`orchestrator/prompts/prompts.yaml`). The shared reviewer preamble + JSON output
 * format live in that prompt; this only carries the per-file-type focus, distilled from the
 * skill_* prompts.
 */
import type { RubricFileType } from '../types';

const PER_TYPE: Record<RubricFileType, string> = {
  question: `This is a single question (one chart or table). Focus on: is the chart type the right fit for the
data and the question (comparison → bar, trend → line, part-of-whole → pie only with few slices, correlation
→ scatter)? Are axes/units/legends labeled and readable? Overplotting, too many colors, or a misleading
scale? Would a reader grasp the takeaway in a few seconds?`,
  dashboard: `This is a dashboard (multiple tiles). Focus on: is there a clear visual hierarchy (most important
KPI prominent, F-pattern top-left emphasis)? Do the tiles tell one coherent story or a random grid? Are the
charts individually the right type and readable at tile size? Is it cluttered or well-composed?`,
  story: `This is a data story (an editorial page with embedded live charts/numbers). Focus (from the story
craft bar): does it make ONE clear argument with a stated lead finding (a claim with a number), not just
decoration? Do headlines state findings, not topics? Is there a deliberate palette with one protagonist
accent — and NOT an AI-default look (cream+serif+terracotta, acid-green-on-black, purple gradients, generic
hairline-rule broadsheet)? Does the frame around each chart carry the insight? Is it honest about the data?`,
};

export function judgeCriteria(fileType: RubricFileType): string {
  return PER_TYPE[fileType];
}
