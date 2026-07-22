import { describe, it, expect } from 'vitest';
import { createHeadlessEditor } from '@lexical/headless';
import { $getRoot, $createParagraphNode, $insertNodes } from 'lexical';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import { $createMetricNode, $isMetricNode } from '../MetricNode';
import { DOCS_TRANSFORMERS, DOCS_NODES } from '../docs-transformers';

function makeEditor() {
  return createHeadlessEditor({ nodes: DOCS_NODES, onError: (e) => { throw e; } });
}

/** All MetricNodes anywhere in the tree (metrics are INLINE — they live inside paragraphs). */
function parseMetrics(markdown: string) {
  const editor = makeEditor();
  editor.update(
    () => { const root = $getRoot(); root.clear(); $convertFromMarkdownString(markdown, DOCS_TRANSFORMERS, root, true); },
    { discrete: true },
  );
  const metrics: Array<{ name: string; description?: string; sql?: string }> = [];
  editor.getEditorState().read(() => {
    const visit = (node: import('lexical').LexicalNode) => {
      if ($isMetricNode(node)) metrics.push(node.getMetricData());
      if ('getChildren' in node) (node as import('lexical').ElementNode).getChildren().forEach(visit);
    };
    $getRoot().getChildren().forEach(visit);
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

describe('metric-transformer (inline directive)', () => {
  const INLINE_FULL = ':metric{name="Monthly Revenue" description="Revenue per month" sql="SELECT sum(amount) AS revenue"}';

  it('parses an inline metric directive into a MetricNode', () => {
    const metrics = parseMetrics(`We track ${INLINE_FULL} every week.`);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toEqual({
      name: 'Monthly Revenue',
      description: 'Revenue per month',
      sql: 'SELECT sum(amount) AS revenue',
    });
  });

  it('round-trips an inline metric INSIDE a sentence, preserving the surrounding text', () => {
    const md = `We track ${INLINE_FULL} every week.`;
    const out = roundTrip(md);
    expect(out).toContain('We track ');
    expect(out).toContain(' every week.');
    expect(out).toContain(':metric{name="Monthly Revenue" description="Revenue per month" sql="SELECT sum(amount) AS revenue"}');
  });

  it('a metric inserted at the text selection (the + menu path) survives markdown export', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        root.append(paragraph);
        paragraph.select();
        $insertNodes([$createMetricNode({ name: 'Monthly Revenue', sql: 'SELECT 1' })]);
      },
      { discrete: true },
    );

    let out = '';
    editor.getEditorState().read(() => { out = $convertToMarkdownString(DOCS_TRANSFORMERS, undefined, true); });
    expect(out).toContain(':metric{name="Monthly Revenue" sql="SELECT 1"}');
  });

  it('round-trips multi-line SQL via newline escaping (stays on one markdown line)', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        root.append(paragraph);
        paragraph.select();
        $insertNodes([$createMetricNode({ name: 'Rev', sql: 'SELECT a\nFROM b' })]);
      },
      { discrete: true },
    );
    let out = '';
    editor.getEditorState().read(() => { out = $convertToMarkdownString(DOCS_TRANSFORMERS, undefined, true); });
    expect(out).toContain('sql="SELECT a\\nFROM b"');

    const metrics = parseMetrics(out);
    expect(metrics[0].sql).toBe('SELECT a\nFROM b');
  });

  it('a name-only metric emits no empty description/sql attributes', () => {
    const out = roundTrip(':metric{name="Active Users"}');
    expect(out).toContain(':metric{name="Active Users"}');
    expect(out).not.toContain('description=');
    expect(out).not.toContain('sql=');
  });

  it('preserves escaped quotes in the name', () => {
    const md = ':metric{name="The \\"big\\" number"}';
    const metrics = parseMetrics(md);
    expect(metrics[0].name).toBe('The "big" number');
    expect(roundTrip(md)).toContain('name="The \\"big\\" number"');
  });

  it('SQL containing braces stays inside the directive', () => {
    const md = ':metric{name="J" sql="SELECT json_extract(x, \'$.a\') FROM t WHERE y = \'{}\'"}';
    const metrics = parseMetrics(md);
    expect(metrics[0].sql).toBe("SELECT json_extract(x, '$.a') FROM t WHERE y = '{}'");
  });

  it('LEGACY: still imports the old fenced :::metric block (wrapped into a paragraph)', () => {
    const legacy = ':::metric{name="Monthly Revenue" description="Revenue per month"}\nSELECT sum(amount) AS revenue\nFROM orders\n:::';
    const metrics = parseMetrics(legacy);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toEqual({
      name: 'Monthly Revenue',
      description: 'Revenue per month',
      sql: 'SELECT sum(amount) AS revenue\nFROM orders',
    });
    // …and re-exports in the new inline form.
    const out = roundTrip(legacy);
    expect(out).toContain(':metric{name="Monthly Revenue" description="Revenue per month" sql="SELECT sum(amount) AS revenue\\nFROM orders"}');
  });

  it('coexists with surrounding markdown', () => {
    const md = `## Metrics\n\nSee :metric{name="Monthly Revenue"} for details.\n\nSome trailing text.`;
    const out = roundTrip(md);
    expect(out).toContain('## Metrics');
    expect(out).toContain(':metric{name="Monthly Revenue"}');
    expect(out).toContain('Some trailing text.');
  });
});
