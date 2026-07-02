import type { ContextAgentContent } from '@/lib/validation/atlas-schemas';
import type { RubricFinding } from '../types';
import { estimateTokens, finding, isBlank } from './shared';

export const MAX_DOC_TOKENS = 1000;

/**
 * Deterministic health findings for a context (the knowledge layer). Scores the agent-facing
 * shape (`ContextAgentContent`: docs / metrics / annotations). No aesthetics — it's not visual.
 */
export function scoreContext(content: ContextAgentContent): RubricFinding[] {
  const out: RubricFinding[] = [];
  const docs = content.docs ?? [];
  const metrics = content.metrics ?? [];
  const annotations = content.annotations ?? [];

  // empty-context (clarity, warn) — nothing to check further
  if (docs.length === 0 && metrics.length === 0 && annotations.length === 0) {
    out.push(finding('context.empty', 'clarity', 'warn', 'Empty context',
      'The context has no docs, metrics, or annotations.',
      'Document the domain: add docs (narrative), metrics (named, SQL-backed definitions), and annotations (table/column meanings).'));
    return out;
  }

  // doc-too-long (clarity, error) — each doc should stay under ~1000 tokens to be usable
  docs.forEach((d, i) => {
    const tokens = estimateTokens(d.content ?? '');
    if (tokens > MAX_DOC_TOKENS) {
      out.push(finding('context.doc-too-long', 'clarity', 'error', 'Doc too long',
        `Doc "${d.title ?? `#${i + 1}`}" is ~${tokens} tokens (over ${MAX_DOC_TOKENS}).`,
        'Split this doc into smaller focused docs, or move detail into metrics/annotations — an over-long doc bloats context and is hard to use.'));
    }
  });

  // metric-no-sql (correctness, warn) — a metric without SQL isn't computable
  for (const m of metrics) {
    if (isBlank(m.sql)) {
      out.push(finding('context.metric-no-sql', 'correctness', 'warn', 'Metric without SQL',
        `Metric "${m.name}" has no SQL definition.`,
        `Define the SQL for "${m.name}" so it computes a real value.`));
    }
  }

  return out;
}
