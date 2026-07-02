# File Health Rubric

A **Lighthouse/linter for BI files**: pure functions that score the health of `question`,
`dashboard`, and `story` files and return **actionable, research-backed findings** the agent
can read and act on to improve the file.

Two flavors, one shared report contract:

- **Deterministic** — `content → RubricReport`. Cheap, synchronous, content-only (no I/O, no
  query results). Auto-injected on every file read / edit / create so the agent always sees
  current health.
- **LLM judge** — `(content + rendered screenshot) → RubricReport`. Judges the subjective /
  visual dimensions a static check can't (does the chart support the claim, does the story
  look crafted). Async, on-demand (tool call / UI request). Reuses the existing full-file
  screenshot pipeline (`lib/screenshot/app-state-screenshot.ts`).

Both emit the same `RubricReport`, so a **combined** report is just a merge.

## Why an analytic rubric (not one number)

Research on rubric-based evaluation is consistent: decompose quality into **atomic,
independently-scored criteria** rather than a single conflated score — it avoids halo
effects, makes each failure individually actionable, and calibrates better against human
judgment. When an LLM does the judging, **force structured output** to cut verbosity and
position bias.

- Analytic rubrics & evidence-grounded scoring: [Rulers / evidence-anchored LLM eval](https://arxiv.org/html/2601.08654v1)
- Calibrating LLM-judge scores to a human gold set: [GoDaddy](https://www.godaddy.com/resources/news/calibrating-scores-of-llm-as-a-judge)
- Structured output to reduce judge bias: [Monte Carlo — LLM-as-judge best practices](https://montecarlo.ai/blog-llm-as-judge/)

The dashboard/chart rules below are grounded in established data-viz guidance:

- 5–9 visuals per dashboard, F-pattern hierarchy, chart-fits-the-task, ≤7 categories on color:
  [AHRQ](https://www.ahrq.gov/evidencenow/tools/dashboard-best-practice.html),
  [Tableau](https://www.tableau.com/visualization/data-visualization-best-practices),
  [Sigma](https://www.sigmacomputing.com/blog/best-practices-dashboard-design-examples)
- Data-ink ratio & graphical perception for chart-type fit:
  [Sisense](https://www.sisense.com/blog/4-design-principles-creating-better-dashboards/)

Story craft/honesty rules are lifted from our own `skill_stories` prompt
(`orchestrator/prompts/prompts.yaml`) — a story is an argument with live numbers, not
decoration.

## Report contract

```ts
type RubricSeverity = 'error' | 'warn' | 'info';
type RubricCategory = 'clarity' | 'correctness' | 'craft';

interface RubricFinding {
  ruleId: string;            // stable, e.g. 'question.query-too-long'
  category: RubricCategory;
  severity: RubricSeverity;
  title: string;             // short human label
  detail: string;            // what's wrong, includes the offending value
  fix: string;               // imperative, agent-actionable
}
interface RubricCategoryScore {
  category: RubricCategory; score: number; weight: number; findings: RubricFinding[];
}
interface RubricReport {
  fileType: FileType;
  source: 'deterministic' | 'llm-judge' | 'combined';
  overall: number;                    // 0–100 weighted
  grade: 'good' | 'fair' | 'poor';    // >=80 / >=50 / else
  categories: RubricCategoryScore[];
}
```

## Scoring math

Each category starts at 100; deduct per finding — **error −25, warn −10, info −3** — floored
at 0. Overall = weighted mean of category scores. Weights and deductions are constants in one
place (`scoring.ts`) so they calibrate against a human gold set later.

| type | clarity | correctness | craft |
|---|---|---|---|
| question  | 0.3 | 0.5 | 0.2 |
| dashboard | 0.2 | 0.5 | 0.3 |
| story     | 0.3 | 0.3 | 0.4 |

Grade bands: `overall >= 80 → good`, `>= 50 → fair`, else `poor`.

## Rule catalog — Question (`QuestionContent`)

| ruleId | category | severity | trigger | fix |
|---|---|---|---|---|
| `query-too-long` | clarity | warn / error | est. tokens of `query` (chars ÷ 4) > 400 (warn) / > 800 (error) | Simplify the SQL: extract reusable sub-queries into `@`-referenced saved questions, drop unused columns, push aggregation into the warehouse. |
| `no-description` | clarity | info | `description` blank | Add a one-line description stating what this question answers. |
| `undeclared-param` | correctness | error | a `:token` in `query` is not declared in `parameters` | Declare `:{name}` in parameters (text/number/date) or remove the token. |
| `unused-param` | correctness | info | a declared parameter is never referenced in `query` | Remove the unused `{name}` parameter or reference `:{name}` in the SQL. |
| `viz-config-incomplete` | correctness | error | `type` is `pivot` and `pivotConfig` is missing or has no `values` (and no `rows`/`columns`) | Configure the pivot (rows, columns, at least one value measure) or switch to `table`. |
| `pie-multi-measure` | craft | warn | `type` ∈ {pie, funnel} and `yCols.length > 1` | Pie/funnel show a single measure. Keep one `yCols`, or use a bar chart. |
| `too-many-series` | craft | warn | `type` ∈ {line, bar, area} and `yCols.length > 5` | More than 5 series is hard to read (≤7 rule). Split into small multiples or drop series. |
| `low-trust-sql` | correctness | info | `[[trust:low]]` appears in `query` or `description` | Verify this novel SQL against the schema/context; reuse a trusted saved question if one exists. |

> Only `pivot` genuinely requires its config object — `trendConfig` / `singleValueConfig` /
> `geoConfig` are optional decoration with sensible defaults, so they are **not** flagged
> deterministically (the judge covers softer "is this the right chart" calls). Column-fit
> checks that need actual query results (e.g. >7 real categories) are also judge territory —
> the deterministic pass is strictly content-only.

## Rule catalog — Dashboard (`DashboardContent`)

Only `question` assets (`FileReference`, `type:'question'`) count as "visuals"; inline
text/image/divider assets are ignored for counting.

| ruleId | category | severity | trigger | fix |
|---|---|---|---|---|
| `asset-not-in-layout` | correctness | error | a question asset id has no entry in `layout.items` | Add a layout item (≥3×3) for question {id}, or remove it from assets. |
| `layout-orphan` | correctness | error | a `layout.items` id has no matching asset | Remove layout item {id}, or add the matching question to assets. |
| `tile-overlap` | correctness | warn | two layout rects overlap on the 12-col grid | Reposition tiles so their grid rectangles don't overlap. |
| `tile-too-small` | craft | warn | a question tile has `w < 3` or `h < 3` | Question tiles need ≥3×3 to be legible; enlarge tile {id}. |
| `visual-count` | craft | error / warn | question count `< 1` (error, empty) / `> 9` (warn) | Keep 5–9 visuals per dashboard; split into multiple dashboards or drop low-value charts. |
| `duplicate-question` | craft | info | the same question id is referenced more than once | Reference question {id} once; parameterize instead of duplicating. |
| `no-description` | clarity | info | `description` blank | Add a description stating the dashboard's decision purpose. |

> `asset-not-in-layout` / `layout-orphan` only fire when a `layout` with `items` exists — a
> dashboard with no explicit layout is auto-laid-out and not penalized.

## Rule catalog — Story (`StoryContent`, body parsed from the `story` JSX field)

| ruleId | category | severity | trigger | fix |
|---|---|---|---|---|
| `no-evidence` | correctness | error | zero `<Question>` / `<Number>` embeds in the body | Back the narrative with at least one live chart (`<Question>`) or number (`<Number>`). |
| `no-headline` | clarity | warn | body has no `<h1>` / `<h2>` heading | Add a headline that states the finding (a claim with a number), not a topic. |
| `typed-number` | correctness | warn | a factual figure (`$`/`%`/thousands-separator or ≥4 digits) sits in prose text, not inside a `<Number>` / `single_value` embed | Replace the typed figure "{x}" with a live `<Number>` embed so it can't go stale or be wrong. |
| `no-lead` | clarity | info | `description` blank | State the single lead finding (with its number) in the description. |
| `no-design-tokens` | craft | info | the `<style>` block has < 2 distinct hex colors, or no `font-family` | Define a deliberate palette (4–6 named hex colors) and ~3 font roles before styling. |
| `too-many-colors` | craft | info | the `<style>` block has > 10 distinct hex colors | Reduce to a disciplined 4–6 color palette with one protagonist accent. |

> Fuzzy craft judgments — forbidden default palettes (cream+serif+terracotta,
> acid-green-on-black, purple gradients), "does the headline actually make a claim", "does the
> frame carry the insight" — need the rendered page and are **LLM-judge** criteria, not
> deterministic.

## LLM judge

`lib/rubric/judge/judge.server.ts`: a dedicated **Opus** judge
(`getModel('anthropic', 'claude-opus-4-8')`, with a `setJudgeModel` test seam) called via
`orchestrator.callLLM`, with structured output forced through a typed `SubmitRubric` TypeBox
tool (the same idiom as `agents/eval/submit-tools.ts`). Input = the file markup
(`fileToMarkup`) plus the already-uploaded full-file screenshot as an image content block.
Per-type prompts derive their rubric from the `skill_questions` / `skill_dashboards` /
`skill_stories` blocks. Emits a `RubricReport` with `source: 'llm-judge'`; the combined report
merges its categories with the deterministic ones. Pattern cloned from
`agents/benchmark-analyst/double-check-benchmark.ts`.

## Consumption

1. **Auto-inject (deterministic).** Attached to the augmented file shape the agent sees, at
   `readFilesServer` (`lib/api/file-state.server.ts`) plus the create/edit tool-result
   projection. Cheap + pure, safe every time. The LLM judge is never auto-run (too expensive).
2. **Agent tool.** `CheckFileHealth(fileId, { llmJudge? })` in
   `agents/analyst/health-tools.ts`, loads content via `FilesAPI.loadFile`, runs the
   deterministic scorer + optional judge. Registered in `analyst-agent.ts` and
   `V2_REGISTRABLES`.
3. **UI + API.** `GET /api/files/[id]/rubric` (deterministic) / `POST { screenshot }`
   (judge), modeled on `app/api/files/[id]/preview/route.ts`; a Lighthouse-style panel on the
   file page (Chakra, theme colors).

## Layout

```
frontend/lib/rubric/
  types.ts            report contracts
  scoring.ts          pure: findings[] → category scores → weighted overall + grade
  registry.ts         FileType → deterministic scorer + per-type category weights
  deterministic/
    shared.ts         :param extraction, token estimate, hex/palette scan, story walk
    question.ts       QuestionContent → RubricFinding[]
    dashboard.ts      DashboardContent → RubricFinding[]
    story.ts          StoryContent   → RubricFinding[]
  judge/
    judge.server.ts   (content + screenshot) → RubricReport
    prompts.ts        per-type judge prompts
  __tests__/          deterministic + scoring unit tests (node project)
```
