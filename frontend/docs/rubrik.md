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
type RubricCategory = 'correctness' | 'clarity' | 'aesthetics';

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
  overall: number;                    // 1–5 weighted
  grade: 'good' | 'fair' | 'poor';    // >=4 / >=2.5 / else
  categories: RubricCategoryScore[];
}
```

### The three categories — a priority waterfall

Only three, and orthogonal. A rule belongs to the **first** category whose test it fails, in
this order — so there's always exactly one home for a new rule:

1. **correctness** — *"If ignored, is it wrong, broken, or dishonest?"* (params in sync, viz
   configured, layout integrity, fabricated/typed numbers, a chart that physically can't
   represent the data like pie-with-2-measures).
2. **clarity** — *"It's correct, but is it hard to understand at a glance?"* (missing
   description/headline/labels, query too long to reason about, too many series, tile too small,
   too many/few tiles).
3. **aesthetics** — *"It works and reads fine, but does it look unpolished/generic?"* (palette,
   typography, design tokens, composition, AI-default look). Mostly LLM-judge territory — beauty
   can't be measured statically.

## Scoring math

A deliberately **coarse 1–5 scale** (avoids false precision / variance). Each category starts
at **5**; deduct per finding — **error −2, warn −1, info −0.5** — then round to the nearest 0.5
and clamp to [1, 5]. Overall = weighted mean of category scores (same 1–5 scale). Weights and
deductions are constants in one place (`scoring.ts`) so they calibrate against a human gold set
later. Note the baseline is always 5 regardless of how many rules a category has — a category is
only penalized for *actual* findings, so adding more granular checks never harshens a clean file.

| type | correctness | clarity | aesthetics |
|---|---|---|---|
| question  | 0.5  | 0.35 | 0.15 |
| dashboard | 0.45 | 0.35 | 0.2 |
| story     | 0.3  | 0.3  | 0.4 |

Grade bands: `overall >= 4 → good`, `>= 2.5 → fair`, else `poor`.

## Rule catalog — Question (`QuestionContent`)

| ruleId | category | severity | trigger | fix |
|---|---|---|---|---|
| `query-too-long` | clarity | warn / error | est. tokens of `query` (chars ÷ 4) > 400 (warn) / > 800 (error) | Simplify the SQL: extract reusable sub-queries into `@`-referenced saved questions, drop unused columns, push aggregation into the warehouse. |
| `no-description` | clarity | info | `description` blank | Add a one-line description stating what this question answers. |
| `undeclared-param` | correctness | error | a `:token` in `query` is not declared in `parameters` | Declare `:{name}` in parameters (text/number/date) or remove the token. |
| `unused-param` | correctness | info | a declared parameter is never referenced in `query` | Remove the unused `{name}` parameter or reference `:{name}` in the SQL. |
| `viz-config-incomplete` | correctness | error | `type` is `pivot` and `pivotConfig` is missing or has no `values` (and no `rows`/`columns`) | Configure the pivot (rows, columns, at least one value measure) or switch to `table`. |
| `pie-multi-measure` | correctness | warn | `type` ∈ {pie, funnel} and `yCols.length > 1` | Pie/funnel show a single measure. Keep one `yCols`, or use a bar chart. |
| `too-many-series` | clarity | warn | `type` ∈ {line, bar, area} and `yCols.length > 5` | More than 5 series is hard to read (≤7 rule). Split into small multiples or drop series. |
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
| `tile-too-small` | clarity | warn | a question tile has `w < 3` or `h < 3` | Question tiles need ≥3×3 to be legible; enlarge tile {id}. |
| `visual-count` | clarity | error / warn | question count `< 1` (error, empty) / `> 9` (warn) | Keep 5–9 visuals per dashboard; split into multiple dashboards or drop low-value charts. |
| `duplicate-question` | correctness | info | the same question id is referenced more than once | Reference question {id} once; parameterize instead of duplicating. |
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
| `no-design-tokens` | aesthetics | info | the `<style>` block has < 2 distinct hex colors, or no `font-family` | Define a deliberate palette (4–6 named hex colors) and ~3 font roles before styling. |
| `too-many-colors` | aesthetics | info | the `<style>` block has > 10 distinct hex colors | Reduce to a disciplined 4–6 color palette with one protagonist accent. |

> Fuzzy craft judgments — forbidden default palettes (cream+serif+terracotta,
> acid-green-on-black, purple gradients), "does the headline actually make a claim", "does the
> frame carry the insight" — need the rendered page and are **LLM-judge** criteria, not
> deterministic.

## LLM judge

`lib/rubric/judge/judge.server.ts` — `judgeFile({ fileType, content, screenshotUrl, model? })
→ Promise<RubricReport>`. Grades the subjective / visual dimensions the deterministic pass
can't (right-chart-for-the-data, does the frame carry the insight, does the story look
crafted vs AI-default). Emits `source: 'llm-judge'`.

**Standalone, not an orchestrator tool run.** It builds a one-shot `Context` and calls
`streamSimple` directly, so it can be invoked from a tool handler *or* an API route without
spinning up an `Orchestrator`. The LLM call is **dependency-injected** (`callModel` param,
defaults to `streamSimple(...).result()`) so tests drive it with a fake message — no provider,
no faux registration.

**Same findings shape as the deterministic scorers.** The judge's structured-output tool
`SubmitRubric` returns a *flat* `findings[]` (category, severity, title, detail, fix) — NOT a
pre-scored nested report. Those findings flow through the same `buildReport`, so both flavors
are scored identically and merge cleanly. Judge findings get a generated
`ruleId: judge.<category>.<index>`. Structured output is forced via the TypeBox `SubmitRubric`
tool (the `agents/eval/submit-tools.ts` idiom); the tool is defined but **not executed** — we
read the `toolCall` args straight off the assistant message.

```ts
// SubmitRubric params
{ findings: Array<{ category: 'correctness'|'clarity'|'aesthetics';
                    severity: 'error'|'warn'|'info';
                    title: string; detail: string; fix: string }> }  // [] if genuinely good
```

- **Input** = `fileToMarkup(fileType, content)` as text + (when available) the rendered
  full-file screenshot as an `{ type:'image', url }` content block. **The judge is most
  valuable WITH the visual** — the screenshot is what lets it grade aesthetics + visual clarity. The URL is
  the one the app already captures + uploads on the send path
  (`lib/screenshot/app-state-screenshot.ts`, the same image the `Screenshot` tool surfaces),
  carried on `fileState.image.url`. The `CheckFileHealth` tool pulls it from the current
  app-state file; the API route takes a client-captured screenshot in the POST body. It never
  renders anything itself; with no screenshot it falls back to markup-only.
- **Model** = dedicated **Opus 4.8** (`getModel('anthropic', 'claude-opus-4-8')`), independent
  of any chat model, with a `setJudgeModel` test seam.
- **Prompts** (`judge/prompts.ts`) — a shared reviewer preamble + per-type criteria distilled
  from `skill_questions` / `skill_dashboards` / `skill_stories`. The judge is told to skip
  lint-style issues the deterministic pass already covers.
- **Robustness** — if the model doesn't call `SubmitRubric`, or a finding is malformed
  (missing category/severity/title), it's dropped; worst case is an empty (5/5) judge report.
- `combineReports(deterministic, judge)` flattens both reports' findings and rebuilds one with
  `source: 'combined'`.

Pattern lineage: the dedicated-Opus-judge idea is from
`agents/benchmark-analyst/double-check-benchmark.ts`; the typed-Submit-tool-for-structured-
output idea from `agents/eval/submit-tools.ts`.

## Consumption

1. **Auto-inject (deterministic).** Attached to the augmented file shape the agent sees, at
   `readFilesServer` (`lib/api/file-state.server.ts`) plus the create/edit tool-result
   projection. Cheap + pure, safe every time. The LLM judge is never auto-run (too expensive).
2. **Agent tool.** `CheckFileHealth(fileId, { llmJudge? })` in
   `agents/analyst/health-tools.ts`, loads content via `FilesAPI.loadFile`, runs the
   deterministic scorer + (when `llmJudge`) the judge, reusing the current file's app-state
   screenshot (`fileState.image.url`) so the judge grades the visual. Registered in
   `analyst-agent.ts`, `web-analyst.ts`, and `V2_REGISTRABLES`.
3. **UI + API.** `FileHealthBadge` (`components/FileHealthPanel.tsx`) in the shared
   `FileHeader` badge row (question/dashboard/story only) — a Lighthouse-style score pill that
   opens a panel of per-category scores + findings + fixes. It computes the **deterministic**
   report client-side from Redux `selectMergedContent` (instant, live-edit aware, no fetch),
   and a "Run visual review" button captures the file screenshot (`useScreenshot`) and POSTs it
   to run the judge. API: `GET /api/files/[id]/rubric` (deterministic) / `POST { screenshot }`
   (deterministic + judge, combined), modeled on `app/api/files/[id]/preview/route.ts`.

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
