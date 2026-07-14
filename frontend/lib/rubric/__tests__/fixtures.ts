/** Minimal content builders for rubric tests. Defaults describe a HEALTHY file. */
import type { DashboardContent, QuestionContent, StoryContent, VizSettings } from '@/lib/types';
import type { ContextAgentContent } from '@/lib/validation/atlas-schemas';

export function makeContext(overrides: Partial<ContextAgentContent> = {}): ContextAgentContent {
  return {
    docs: [{ content: 'Revenue is recognized monthly.', title: 'Revenue', description: 'How revenue works', childPaths: null, draft: null, alwaysInclude: null }],
    metrics: [{ name: 'mrr', description: 'Monthly recurring revenue', sql: 'SELECT SUM(mrr) FROM m', connection: null, schema: null, table: null }],
    annotations: null,
    skills: null,
    evals: null,
    ...overrides,
  };
}

export function makeViz(overrides: Partial<VizSettings> = {}): VizSettings {
  return { type: 'table', ...overrides };
}

export function makeQuestion(overrides: Partial<QuestionContent> = {}): QuestionContent {
  return {
    description: 'Monthly revenue by region.',
    query: 'SELECT region, SUM(revenue) AS revenue FROM sales GROUP BY region',
    vizSettings: makeViz(),
    parameters: null,
    parameterValues: null,
    connection_name: 'warehouse',
   
    cachePolicy: null,
    ...overrides,
  };
}

export function makeDashboard(overrides: Partial<DashboardContent> = {}): DashboardContent {
  // 5 questions, each present in the layout in a 6x4 tile, non-overlapping.
  const ids = [1, 2, 3, 4, 5];
  return {
    description: 'Revenue overview.',
    assets: ids.map((id) => ({ type: 'question' as const, id })),
    layout: {
      items: ids.map((id, i) => ({ id, x: (i % 2) * 6, y: Math.floor(i / 2) * 4, w: 6, h: 4 })),
    },
    parameterValues: { region: '' }, // healthy dashboard has a filter
    ...overrides,
  };
}

const GOOD_STORY = `<div class="story">
  <style>{\`.story{font-family:Inter,sans-serif;color:#111827;background:#ffffff;padding:0 48px}
    h1{color:#2563eb} .accent{color:#f59e0b} .muted{color:#6b7280}\`}</style>
  <h1>Revenue climbed sharply this quarter</h1>
  <p>The headline: <Number id={5} prefix="$" /> in new revenue.</p>
  <Question id={7} height="420px" />
</div>`;

export function makeStory(overrides: Partial<StoryContent> = {}): StoryContent {
  return {
    description: 'Revenue grew 20% on the back of the west region.',
    story: GOOD_STORY,
    suggestedQuestions: null,
    colorMode: null,
    parameterValues: null,
    ...overrides,
  };
}
