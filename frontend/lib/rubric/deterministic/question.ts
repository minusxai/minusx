import type { QuestionContent } from '@/lib/types';
import type { RubricFinding } from '../types';
import { estimateTokens, extractSqlParams, finding, isBlank } from './shared';

const QUERY_TOKENS_WARN = 400;
const QUERY_TOKENS_ERROR = 800;
const MAX_SERIES = 5;

const SIMPLIFY_FIX =
  'Simplify the SQL: extract reusable sub-queries into @-referenced saved questions, drop unused columns, and push aggregation into the warehouse.';

/** Deterministic health findings for a question. Pure function of content. */
export function scoreQuestion(content: QuestionContent): RubricFinding[] {
  const out: RubricFinding[] = [];
  const query = content.query ?? '';
  const viz = content.vizSettings;

  // query-too-long (clarity)
  const tokens = estimateTokens(query);
  if (tokens > QUERY_TOKENS_ERROR) {
    out.push(finding('question.query-too-long', 'clarity', 'error', 'Query is very large',
      `The SQL is ~${tokens} tokens (over ${QUERY_TOKENS_ERROR}).`, SIMPLIFY_FIX));
  } else if (tokens > QUERY_TOKENS_WARN) {
    out.push(finding('question.query-too-long', 'clarity', 'warn', 'Query is long',
      `The SQL is ~${tokens} tokens (over ${QUERY_TOKENS_WARN}).`, SIMPLIFY_FIX));
  }

  // no-description (clarity)
  if (isBlank(content.description)) {
    out.push(finding('question.no-description', 'clarity', 'info', 'No description',
      'The question has no description.',
      'Add a one-line description stating what this question answers.'));
  }

  // param ↔ :token sync (correctness)
  const used = new Set(extractSqlParams(query));
  const declared = (content.parameters ?? []).map((p) => p.name);
  const declaredSet = new Set(declared);
  for (const name of used) {
    if (!declaredSet.has(name)) {
      out.push(finding('question.undeclared-param', 'correctness', 'error', 'Undeclared parameter',
        `SQL references :${name} but it is not declared in parameters.`,
        `Declare parameter :${name} (text/number/date) or remove the token.`));
    }
  }
  for (const name of declared) {
    if (!used.has(name)) {
      out.push(finding('question.unused-param', 'correctness', 'info', 'Unused parameter',
        `Parameter ${name} is declared but never referenced in the SQL.`,
        `Remove the unused ${name} parameter or reference :${name} in the SQL.`));
    }
  }

  // viz-config-incomplete (correctness) — only pivot genuinely requires its config
  if (viz?.type === 'pivot') {
    const pc = viz.pivotConfig;
    const empty = !pc
      || ((pc.values?.length ?? 0) === 0 && (pc.rows?.length ?? 0) === 0 && (pc.columns?.length ?? 0) === 0);
    if (empty) {
      out.push(finding('question.viz-config-incomplete', 'correctness', 'error', 'Pivot not configured',
        'The pivot chart has no rows, columns, or value measures.',
        'Configure the pivot (rows, columns, at least one value measure) or switch to a table.'));
    }
  }

  // pie-multi-measure (correctness — a pie/funnel physically can't represent >1 measure)
  if ((viz?.type === 'pie' || viz?.type === 'funnel') && (viz.yCols?.length ?? 0) > 1) {
    out.push(finding('question.pie-multi-measure', 'correctness', 'warn', 'Pie/funnel with multiple measures',
      `A ${viz.type} chart has ${viz.yCols!.length} measures; it can only show one.`,
      'Keep a single yCols value, or use a bar chart to compare multiple measures.'));
  }

  // too-many-series (clarity — technically shows the data, just cluttered)
  if ((viz?.type === 'line' || viz?.type === 'bar' || viz?.type === 'area') && (viz.yCols?.length ?? 0) > MAX_SERIES) {
    out.push(finding('question.too-many-series', 'clarity', 'warn', 'Too many series',
      `The chart has ${viz.yCols!.length} series (more than ${MAX_SERIES}).`,
      'More than 5 series is hard to read (the ≤7 rule). Split into small multiples or drop series.'));
  }

  return out;
}
