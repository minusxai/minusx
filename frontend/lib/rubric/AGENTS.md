# lib/rubric — file health scoring

A Lighthouse-style linter for BI files. Pure functions that score a `question`, `dashboard`,
`story`, or `context` file and return **actionable findings the agent can act on**, not a number
for a human to admire. Two scorers share one report contract:

- **Deterministic** — `content → RubricReport`. Synchronous, content-only, no I/O and no query
  results. Runs inside EditFile/CreateFile, and is the fallback when a full review can't screenshot.
- **LLM judge** — `(content + rendered screenshot) → RubricReport`. Covers the subjective and
  visual dimensions a static check cannot reach (does the chart support the claim, does the story
  look crafted). Async, on demand, reuses the full-file screenshot pipeline.

It owns scoring and the rule catalog. It does **not** own capture (`lib/screenshot/`), the tool
plumbing that surfaces reports (`lib/tools/handlers/file-review.ts`), or the UI.

## Architecture

```
                       deterministic/{question,dashboard,story,context}.ts
                                     │  (+ shared.ts, story-layout.ts)
  content ─→ score-file.server.ts ──┤
                                     │  llm/score-llm.server.ts  ←── screenshot
                                     ▼
                          scoring.ts ─→ RubricReport ─→ AgentRubric (lean projection)
```

- `registry.ts` maps file type → its deterministic check set; `checks.ts` holds the rules.
- `scoring.ts` is the **only** place weights, deductions and grade bands live, so the whole rubric
  can be recalibrated against a human gold set from one file.
- `types.ts` defines `RubricFinding` / `RubricCategoryScore` / `RubricReport`. Every finding carries
  its own `source: 'rule' | 'llm'` — there is no report-level source, which is what lets a
  deterministic and a judge report merge into one combined report with no reconciliation step.

## Design rules

**Three categories, applied as a priority waterfall.** A rule belongs to the **first** category
whose test it fails, in this order — so a new rule always has exactly one home:

1. `correctness` — if ignored, is it wrong, broken, or dishonest?
2. `clarity` — it's correct, but is it hard to understand at a glance?
3. `aesthetics` — it works and reads fine, but does it look unpolished or generic? Mostly judge
   territory; beauty can't be measured statically.

**Analytic, not conflated.** Quality is decomposed into atomic independently-scored criteria rather
than one number — this avoids halo effects, makes each failure individually actionable, and
calibrates better against human judgment. When the LLM judges, output is forced into structure to
cut verbosity and position bias. Sources: [evidence-anchored LLM
eval](https://arxiv.org/html/2601.08654v1), [calibrating judge scores to a human gold
set](https://www.godaddy.com/resources/news/calibrating-scores-of-llm-as-a-judge), [structured
output to reduce judge bias](https://montecarlo.ai/blog-llm-as-judge/).

**The dashboard and chart thresholds are not arbitrary** — 5–9 visuals per dashboard, F-pattern
hierarchy, chart-fits-the-task, ≤7 categories on color come from
[AHRQ](https://www.ahrq.gov/evidencenow/tools/dashboard-best-practice.html),
[Tableau](https://www.tableau.com/visualization/data-visualization-best-practices),
[Sigma](https://www.sigmacomputing.com/blog/best-practices-dashboard-design-examples), and
data-ink / graphical-perception guidance from
[Sisense](https://www.sisense.com/blog/4-design-principles-creating-better-dashboards/). Story
craft and honesty rules come from our own `skill_stories` prompt in
`frontend/orchestrator/prompts/prompts.yaml` — a story is an argument with live numbers, not
decoration. **Change a threshold and you are overruling a citation; say why in the commit.**

## Gotchas

- **`error` is a gate, not a deduction.** Any `error` finding zeroes its category *and* the overall
  score (grade `poor`) until fixed — it does not subtract a weight. So an otherwise perfect file
  with one undeclared param scores 0, deliberately: the agent must always fix errors, and should
  try to fix warnings.
- **Every category baselines at 5 regardless of how many rules it has.** A category is only
  penalized for actual findings, so adding more granular checks never harshens a clean file. Do not
  "balance" rule counts across categories — that instinct is wrong here.
- **The scale is deliberately coarse** (0–5, deductions rounded to the nearest 0.5). Finer
  granularity buys false precision and variance, not signal.
- **The deterministic pass is content-only, with one exception.** It never sees query results.
  The exception: dashboard tile rules may read a referenced question's chart *type* via
  `DeterministicContext.vizTypeByQuestionId`, because a tile's viz type lives on the question, not
  the dashboard. Anything needing real result data (e.g. "does this actually have >7 categories")
  is judge territory.
- **Only `pivot` genuinely requires its config object.** `trendConfig` / `singleValueConfig` /
  `geoConfig` are optional decoration with sensible defaults and are deliberately NOT flagged
  deterministically. Adding a `*-config-incomplete` rule for them will produce false positives.
- **Only `question` assets count as dashboard "visuals".** Inline text, image and divider assets
  are ignored for counting rules.
- **`ruleId`s are stable identifiers**, namespaced by file type (`question.query-too-long`,
  `dashboard.tile-overlap`, `story.no-evidence`). They appear in agent-visible output and in tests
  — renaming one is a breaking change, not a cleanup.

## Code pointers

| Task | File |
|---|---|
| Add or change a rule | `frontend/lib/rubric/deterministic/` (per file type) + `frontend/lib/rubric/checks.ts` |
| Change weights, deductions, grade bands | `frontend/lib/rubric/scoring.ts` — the single source |
| Change the report shape | `frontend/lib/rubric/types.ts` |
| Wire a new file type into scoring | `frontend/lib/rubric/registry.ts` + `frontend/lib/rubric/score-file.server.ts` |
| Change what the judge looks at | `frontend/lib/rubric/llm/score-llm.server.ts` |
| Change how reports reach the agent | `frontend/lib/tools/handlers/file-review.ts`, `frontend/agents/analyst/health-tools.ts` |
| Change the UI panel | `frontend/components/file-browser/FileHealthPanel.tsx` |
| Story-specific layout checks | `frontend/lib/rubric/deterministic/story-layout.ts` |
