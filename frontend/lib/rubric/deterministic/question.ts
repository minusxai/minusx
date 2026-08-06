import type { QuestionContent } from '@/lib/types';
import { getEnvelopeVizType, getPivotConfig, getZoneFields } from '@/lib/viz/encoding-edit';
import type { RubricFinding } from '../types';
import { estimateTokens, extractSqlParams, finding, isBlank } from './shared';
import { questionVegaLiteSpec, unlabeledAxesDetail } from './question-vega';

const QUERY_TOKENS_WARN = 400;
const QUERY_TOKENS_ERROR = 800;
const MAX_SERIES = 5;

const SIMPLIFY_FIX =
  'Simplify the SQL: extract reusable sub-queries into @-referenced saved questions, drop unused columns, and push aggregation into the warehouse.';

/** Deterministic health findings for a question. Pure function of content. */
export function scoreQuestion(content: QuestionContent): RubricFinding[] {
  const out: RubricFinding[] = [];
  const query = content.query ?? '';
  // V2 is authoritative whenever present. Legacy settings are only a fallback for files that
  // have not been upgraded yet — never mix fields from both representations.
  const envelope = content.viz ?? undefined;
  const legacy = envelope ? undefined : content.vizSettings ?? undefined;
  const vizType = envelope ? getEnvelopeVizType(envelope) : legacy?.type;
  const measureChannel = vizType === 'pie' ? 'theta'
    : vizType === 'funnel' ? 'value'
      : vizType === 'bar' || vizType === 'line' || vizType === 'area' ? 'y'
        : undefined;
  const measureFields = envelope
    ? measureChannel ? getZoneFields(envelope, measureChannel) : []
    : legacy?.yCols ?? [];

  // Query size thresholds (clarity): separate checks keep one severity per check.
  const tokens = estimateTokens(query);
  if (tokens > QUERY_TOKENS_ERROR) {
    out.push(finding('question.query-extreme', 'Query is extremely large',
      `The SQL is ~${tokens} tokens (over ${QUERY_TOKENS_ERROR}).`, SIMPLIFY_FIX));
  } else if (tokens > QUERY_TOKENS_WARN) {
    out.push(finding('question.query-too-long', 'Query is long',
      `The SQL is ~${tokens} tokens (over ${QUERY_TOKENS_WARN}).`, SIMPLIFY_FIX));
  }

  // no-description (clarity)
  if (isBlank(content.description)) {
    out.push(finding('question.no-description', 'No description',
      'The question has no description.',
      'Add a one-line description stating what this question answers.'));
  }

  // param ↔ :token sync (correctness)
  const used = new Set(extractSqlParams(query));
  const declared = (content.parameters ?? []).map((p) => p.name);
  const declaredSet = new Set(declared);
  for (const name of used) {
    if (!declaredSet.has(name)) {
      out.push(finding('question.undeclared-param', 'Undeclared parameter',
        `SQL references :${name} but it is not declared in parameters.`,
        `Declare parameter :${name} (text/number/date) or remove the token.`));
    }
  }
  for (const name of declared) {
    if (!used.has(name)) {
      out.push(finding('question.unused-param', 'Unused parameter',
        `Parameter ${name} is declared but never referenced in the SQL.`,
        `Remove the unused ${name} parameter or reference :${name} in the SQL.`));
    }
  }

  // viz-config-incomplete (correctness) — only pivot genuinely requires its config
  if (vizType === 'pivot') {
    const pc = envelope ? getPivotConfig(envelope) : legacy?.pivotConfig;
    const empty = !pc
      || ((pc.values?.length ?? 0) === 0 && (pc.rows?.length ?? 0) === 0 && (pc.columns?.length ?? 0) === 0);
    if (empty) {
      out.push(finding('question.viz-config-incomplete', 'Pivot not configured',
        'The pivot chart has no rows, columns, or value measures.',
        'Configure the pivot (rows, columns, at least one value measure) or switch to a table.'));
    }
  }

  // pie-multi-measure (correctness — a pie/funnel physically can't represent >1 measure)
  if ((vizType === 'pie' || vizType === 'funnel') && measureFields.length > 1) {
    out.push(finding('question.pie-multi-measure', 'Pie/funnel with multiple measures',
      `A ${vizType} chart has ${measureFields.length} measures; it can only show one.`,
      'Keep a single value measure, or use a bar chart to compare multiple measures.'));
  }

  // too-many-series (clarity — technically shows the data, just cluttered)
  if ((vizType === 'line' || vizType === 'bar' || vizType === 'area') && measureFields.length > MAX_SERIES) {
    out.push(finding('question.too-many-series', 'Too many series',
      `The chart has ${measureFields.length} series (more than ${MAX_SERIES}).`,
      'More than 5 series is hard to read (the ≤7 rule). Split into small multiples or drop series.'));
  }

  // Vega-backed checks: inspect the canonical V2 spec (or a legacy file's deterministic V2
  // conversion). Native Vega is intentionally skipped — its scale/axis graph is not Vega-Lite.
  const spec = questionVegaLiteSpec(content);
  const axesDetail = spec ? unlabeledAxesDetail(spec, vizType) : undefined;
  if (axesDetail) {
    out.push(finding('question.axes-labeled', 'Axis labels suppressed', axesDetail,
      'Show tick labels and give the axis a clear title (Vega-Lite may derive it from the field).'));
  }

  return out;
}
