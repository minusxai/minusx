import { describe, it, expect } from 'vitest';
import { createHeadlessEditor } from '@lexical/headless';
import { $getRoot } from 'lexical';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import { $isMetricNode } from '../MetricNode';
import { DOCS_TRANSFORMERS, DOCS_NODES } from '../docs-transformers';

function makeEditor() {
  return createHeadlessEditor({ nodes: DOCS_NODES, onError: (e) => { throw e; } });
}

function parseMetrics(markdown: string) {
  const editor = makeEditor();
  editor.update(
    () => { const root = $getRoot(); root.clear(); $convertFromMarkdownString(markdown, DOCS_TRANSFORMERS, root, true); },
    { discrete: true },
  );
  const metrics: Array<{ name: string; description?: string; sql?: string }> = [];
  editor.getEditorState().read(() => {
    $getRoot().getChildren().forEach((n) => { if ($isMetricNode(n)) metrics.push(n.getMetricData()); });
  });
  return metrics;
}

function roundTrip(markdown: string) {
  const editor = makeEditor();
  editor.update(
    () => { const root = $getRoot(); root.clear(); $convertFromMarkdownString(markdown, DOCS_TRANSFORMERS, root, true); },
    { discrete: true },
  );
  let out = '';
  editor.getEditorState().read(() => { out = $convertToMarkdownString(DOCS_TRANSFORMERS, undefined, true); });
  return out;
}

describe('metric-transformer', () => {
  const FULL = ':::metric{name="Monthly Revenue" description="Revenue per month"}\nSELECT sum(amount) AS revenue\nFROM orders\n:::';

  it('parses a metric block into a MetricNode with name, description, and sql', () => {
    const metrics = parseMetrics(FULL);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toEqual({
      name: 'Monthly Revenue',
      description: 'Revenue per month',
      sql: 'SELECT sum(amount) AS revenue\nFROM orders',
    });
  });

  it('round-trips a full metric (name + description + multi-line sql)', () => {
    const out = roundTrip(FULL);
    expect(out).toContain(':::metric{name="Monthly Revenue" description="Revenue per month"}');
    expect(out).toContain('SELECT sum(amount) AS revenue\nFROM orders');
    expect(out.trimEnd().endsWith(':::')).toBe(true);
  });

  it('parses a name-only metric (no description, no sql)', () => {
    const metrics = parseMetrics(':::metric{name="Active Users"}\n:::');
    expect(metrics[0]).toEqual({ name: 'Active Users', description: undefined, sql: undefined });
  });

  it('round-trips a name-only metric without emitting empty attributes', () => {
    const out = roundTrip(':::metric{name="Active Users"}\n:::');
    expect(out).toContain(':::metric{name="Active Users"}');
    expect(out).not.toContain('description=');
  });

  it('preserves escaped quotes in the name', () => {
    const md = ':::metric{name="The \\"big\\" number"}\n:::';
    const metrics = parseMetrics(md);
    expect(metrics[0].name).toBe('The "big" number');
    expect(roundTrip(md)).toContain('name="The \\"big\\" number"');
  });

  it('coexists with surrounding markdown', () => {
    const md = `## Metrics\n\n${FULL}\n\nSome trailing text.`;
    const out = roundTrip(md);
    expect(out).toContain('## Metrics');
    expect(out).toContain(':::metric{name="Monthly Revenue"');
    expect(out).toContain('Some trailing text.');
  });
});
