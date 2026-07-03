/**
 * Check catalogs for the rubric — the display/eval source of truth for both scorers.
 *
 * - DETERMINISTIC_CHECKS: mirrors the static rules in `deterministic/*` (ruleId must match the
 *   finding a rule emits). Used to show which static checks PASSED.
 * - LLM_CHECKS: the CLOSED set of visual/subjective checks the LLM judge evaluates. Each is a
 *   specific pass/fail question grounded in data-viz research; the judge returns true/false +
 *   evidence per check, and `score-llm.server.ts` turns failures into findings. This replaces
 *   the old open-ended "find any problems" prompt.
 */
import type { RubricCategory, RubricFileType, RubricReport, RubricSeverity } from './types';

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
    { ruleId: 'dashboard.plot-too-small', label: 'Plots ≥3×3', category: 'clarity' },
    { ruleId: 'dashboard.visual-count', label: 'Visual count OK', category: 'clarity' },
    { ruleId: 'dashboard.too-much-text', label: 'Text is concise', category: 'clarity' },
    { ruleId: 'dashboard.no-parameters', label: 'Has parameters', category: 'clarity' },
    { ruleId: 'dashboard.no-description', label: 'Has a description', category: 'clarity' },
  ],
  story: [
    { ruleId: 'story.no-evidence', label: 'Has live evidence', category: 'correctness' },
    { ruleId: 'story.typed-number', label: 'Numbers are live', category: 'correctness' },
    { ruleId: 'story.undeclared-param', label: 'Params declared', category: 'correctness' },
    { ruleId: 'story.no-headline', label: 'Has a headline', category: 'clarity' },
    { ruleId: 'story.no-lead', label: 'Has a lead', category: 'clarity' },
    { ruleId: 'story.embed-too-narrow', label: 'Charts wide enough', category: 'clarity' },
    { ruleId: 'story.no-design-tokens', label: 'Design tokens defined', category: 'aesthetics' },
    { ruleId: 'story.too-many-colors', label: 'Palette disciplined', category: 'aesthetics' },
  ],
  context: [
    { ruleId: 'context.metric-no-sql', label: 'Metrics have SQL', category: 'correctness' },
    { ruleId: 'context.empty', label: 'Not empty', category: 'clarity' },
    { ruleId: 'context.doc-too-long', label: 'Docs are concise', category: 'clarity' },
  ],
};

// ─── LLM checks (closed set the judge evaluates pass/fail) ───────────────────────────────────

export interface LlmCheck {
  id: string;               // stable; finding ruleId is `llm.${id}`
  category: RubricCategory;
  severity: RubricSeverity;  // deduction if it FAILS
  label: string;            // neutral name shown in the table (pass or fail)
  question: string;         // the pass-condition the LLM evaluates (PASS = condition holds)
  fix: string;              // actionable fix shown when it fails
}

export const LLM_CHECKS: Record<RubricFileType, LlmCheck[]> = {
  question: [
    { id: 'chart-type-fit', category: 'correctness', severity: 'error', label: 'Right chart for the data',
      question: 'The chart type matches the analytical intent (comparison → bar/column, trend over time → line, part-of-whole → pie/donut only with ≤5 slices, correlation → scatter, distribution → histogram). PASS if the type fits the data and question.',
      fix: 'Switch to the chart type that matches the question (e.g. line for a time trend, bar for a category comparison).' },
    { id: 'honest-scale', category: 'correctness', severity: 'error', label: 'Honest axes',
      question: 'The value axis is not misleading — bars/areas start at a zero baseline and there is no truncated or dual-axis distortion that exaggerates differences. PASS if the scale is honest.',
      fix: 'Start the value axis at zero (or clearly mark the break); avoid deceptive dual axes.' },
    { id: 'axes-labeled', category: 'clarity', severity: 'warn', label: 'Axes & legend labeled',
      question: 'Axes have clear titles with units, and any legend/series is labeled. PASS if a reader can tell what each axis and series means.',
      fix: 'Add axis titles with units and label the series/legend.' },
    { id: 'labels-legible', category: 'clarity', severity: 'warn', label: 'Legible labels',
      question: 'Tick and data labels are readable — not overlapping, truncated, or too dense to read. PASS if labels are legible.',
      fix: 'Reduce label density, rotate/abbreviate ticks, or filter categories so labels are readable.' },
    { id: 'not-overplotted', category: 'clarity', severity: 'warn', label: 'Not overplotted',
      question: 'The chart is not overcrowded — few enough series/points/categories (≈≤7 on color) that the pattern is visible. PASS if uncluttered.',
      fix: 'Reduce series/categories (top-N, group “other”) or use small multiples.' },
    { id: 'takeaway-obvious', category: 'clarity', severity: 'warn', label: 'Takeaway in seconds',
      question: 'A reader can grasp the main takeaway within a few seconds. PASS if the point is obvious at a glance.',
      fix: 'Sort/highlight the key values, add a title that states the takeaway, or annotate the key point.' },
    { id: 'clean-encoding', category: 'aesthetics', severity: 'warn', label: 'Clean, high data-ink',
      question: 'Minimal chart-junk — no unnecessary 3D, heavy gridlines, or decoration; good data-ink ratio. PASS if the encoding is clean.',
      fix: 'Remove 3D/gradients/heavy gridlines and non-data decoration.' },
  ],
  dashboard: [
    { id: 'coherent-narrative', category: 'correctness', severity: 'warn', label: 'Coherent story',
      question: 'The tiles together answer one coherent question, not a random grid of unrelated charts. PASS if coherent.',
      fix: 'Group related tiles and drop charts that don’t serve the dashboard’s decision.' },
    { id: 'clear-hierarchy', category: 'clarity', severity: 'warn', label: 'Clear hierarchy',
      question: 'There is a clear visual hierarchy — the most important metric is prominent (larger / top-left, F-pattern). PASS if the eye is guided to what matters.',
      fix: 'Promote the headline KPI (bigger tile, top-left) and de-emphasize secondary charts.' },
    { id: 'plots-readable', category: 'clarity', severity: 'error', label: 'Plots readable at tile size',
      question: 'Each chart is the right type and legible at its tile size (for example, a line chart with time axis with 2 width is too cramped. PASS if all charts are readable at their tile size.',
      fix: 'Enlarge cramped tiles or simplify the chart so it reads at tile size.' },
    { id: 'non-overlapping-plot-text', category: 'clarity', severity: 'error', label: 'No overlapping plot text',
      question: 'No chart text (labels, titles, annotations) overlaps with other text. PASS if all text is legible and not overlapping.',
      fix: 'Adjust text placement or tile size to prevent overlapping text.' },
    { id: 'consistent-formatting', category: 'aesthetics', severity: 'warn', label: 'Consistent formatting',
      question: 'Number formats, date formats, colors, and title styling are consistent across tiles. PASS if consistent.',
      fix: 'Unify number/date formats, the color palette, and title styling across tiles.' },
    { id: 'uncluttered-layout', category: 'aesthetics', severity: 'warn', label: 'Uncluttered layout',
      question: 'The layout is balanced with adequate whitespace — not cramped, lopsided, or overflowing. PASS if well-composed.',
      fix: 'Add spacing, align tiles to the grid, and balance the composition.' },
    { id: 'clean-text-styling', category: 'aesthetics', severity: 'warn', label: 'Clean text styling',
      question: 'Text elements (titles, labels, and text tiles) have appropriate, even padding/spacing and look clean — no cramped, oversized, or unnatural/weird padding (especially top/bottom padding). PASS if text is cleanly and consistently spaced.',
      fix: 'Give text consistent, comfortable padding aligned to the grid; remove cramped or oddly large/uneven spacing.' },
  ],
  story: [
    { id: 'single-lead', category: 'correctness', severity: 'error', label: 'One clear lead',
      question: 'The story states ONE clear lead finding — a claim containing a number — near the top. PASS if there is a single stated lead with a number.',
      fix: 'Open with one sentence stating the finding and its number.' },
    { id: 'evidence-supports-claims', category: 'correctness', severity: 'error', label: 'Claims are supported',
      question: 'Every claim is supported by the chart/number shown; nothing is overstated, extrapolated, or invented. PASS if honest and evidenced.',
      fix: 'Only claim what the referenced chart shows; remove or hedge unsupported statements.' },
    { id: 'headlines-are-findings', category: 'aesthetics', severity: 'warn', label: 'Headlines state findings',
      question: 'Section headlines state findings/conclusions, not just topics (“Revenue fell 12% in Q3”, not “Revenue”). PASS if headlines are findings.',
      fix: 'Rewrite headlines as the finding they introduce, not the topic.' },
    { id: 'frame-carries-insight', category: 'aesthetics', severity: 'warn', label: 'Frame carries insight',
      question: 'The prose/annotations around each chart carry the insight (what to notice), not a bare chart left to interpret. PASS if framed.',
      fix: 'Add a standfirst/annotation to each chart telling the reader what it shows.' },
    { id: 'embeds-well-sized', category: 'aesthetics', severity: 'warn', label: 'Embeds well-sized',
      question: 'Every chart/number embed fits its frame: no chart squeezed too small or too narrow to read, and no single_value/number stranded in a large mostly-empty box (dead space). Line/area/bar/scatter charts need ≥50% of the column width; pie/funnel need ≥34%. PASS if all embeds are well-proportioned with no wasted space.',
      fix: 'Size each embed to its content — give charts room (≥half the column), and shrink single_value/number cards so the figure fills them; drop packed multi-column grids that starve charts of width.' },
    { id: 'charts-render-cleanly', category: 'aesthetics', severity: 'warn', label: 'Charts render cleanly',
      question: 'Charts render cleanly and honestly: no misleading cratered/partial final period, no overlapping titles or labels, no broken/empty/all-zero plots. PASS if every chart renders without artifacts.',
      fix: 'Fix the chart at its source — trim an incomplete final period, resolve overlapping text, and ensure the query returns a clean series before embedding.' },
    { id: 'ugly-empty-space-alignment', category: 'aesthetics', severity: 'error', label: 'No ugly empty space',
        question: 'The story has no large empty space, misaligned charts or headings. The headings don’t wrap to multiple lines, and the charts are aligned to a grid. PASS if the story is visually tidy.',
        fix: 'Align charts to a grid, avoid multi-line headings, and remove large empty space.' },
    { id: 'readable-charts', category: 'aesthetics', severity: 'error', label: 'Charts are readable',
        question: 'Charts are readable: no overlapping labels, no font blending into the background, no tiny text, and no cramped or overplotted charts. PASS if all charts are legible.',
        fix: 'Fix the chart at its source — adjust label placement, font color, and size, and reduce overplotting before embedding.' },
    { id: 'Text is readable', category: 'aesthetics', severity: 'error', label: 'Text is readable',
        question: 'All text is readable: no tiny font, no low contrast, and no cramped or overlapping text. PASS if all text is legible.',
        fix: 'Increase font size, improve contrast, and adjust spacing to avoid cramped or overlapping text.'},
    { id: 'harmonious-chart-body', category: 'aesthetics', severity: 'error', label: 'Charts harmonize with the body',
      question: 'Charts harmonize with the story body: no chart is visually jarring or stylistically inconsistent with the surrounding text and story style. PASS if charts feel integrated and consistent with the story.',
      fix: 'Adjust chart styles, colors, and fonts or fix the body of the story to ensure visual harmony. This is critical for maintaining a cohesive visual narrative.' },
    { id: 'deliberate-palette', category: 'aesthetics', severity: 'warn', label: 'Deliberate palette',
      question: 'The design uses a deliberate palette with one protagonist accent and is NOT a generic AI-default look (cream+serif+terracotta, acid-green-on-black, purple gradients, generic hairline-rule broadsheet). PASS if the palette looks intentional and distinctive.',
      fix: 'Choose a deliberate 4–6 color palette with one accent; avoid the default AI looks.' },
    { id: 'typographic-craft', category: 'aesthetics', severity: 'warn', label: 'Typographic craft',
      question: 'Typography and spacing feel intentional — clear hierarchy, comfortable measure, good contrast and rhythm. PASS if the type feels crafted.',
      fix: 'Establish a type scale, generous spacing, and strong heading/body contrast.' },
  ],
  context: [], // a context is a non-visual knowledge file — deterministic checks only, no LLM judge
};

/** Render the LLM checklist for a file type into the prompt (`{checklist}` var). */
export function formatChecklist(fileType: RubricFileType): string {
  return LLM_CHECKS[fileType].map((c) => `- ${c.id} [${c.category}]: ${c.question}`).join('\n');
}

const llmToRubricCheck = (c: LlmCheck): RubricCheck => ({ ruleId: `llm.${c.id}`, label: c.label, category: c.category });

/**
 * Checks that PASSED for a report: not fired and in an assessed category. Deterministic checks
 * always count (they run whenever their category is assessed); LLM checks count only when the
 * LLM actually ran (`llmRan`).
 */
export function passedChecks(fileType: RubricFileType, report: RubricReport, llmRan: boolean): RubricCheck[] {
  const fired = new Set(report.categories.flatMap((c) => c.findings).map((f) => f.ruleId));
  const assessed = new Set(report.categories.filter((c) => c.assessed).map((c) => c.category));
  const keep = (chk: RubricCheck) => !fired.has(chk.ruleId) && assessed.has(chk.category);

  const det = (DETERMINISTIC_CHECKS[fileType] ?? []).filter(keep);
  const llm = llmRan ? (LLM_CHECKS[fileType] ?? []).map(llmToRubricCheck).filter(keep) : [];
  return [...det, ...llm];
}
