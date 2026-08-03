/**
 * Unit tests for the QA report merge + render logic (`scripts/qa-report.ts`).
 * The CLI shell (arg parsing, fs walking) is exercised by real runs; what is
 * pinned here is the semantics of merging N runs into one comparison table:
 *   - rows keyed by (flow, metric); a metric missing from a run renders null
 *   - duplicate rows within one run: numbers SUM, pass ANDs, text/image last-wins
 *   - HTML embeds labels, PASS/FAIL, and base64 data URIs for images
 */
import { describe, it, expect } from 'vitest';
import { mergeRuns, renderHtml, type RunData } from '../qa-report';

const runA: RunData = {
  meta: { label: 'run-a', target: 'https://a.example' },
  rows: [
    { flow: 'Chat Question', metric: 'pass', value: true, kind: 'pass' },
    { flow: 'Chat Question', metric: 'total_tokens', value: 100, kind: 'number' },
    { flow: 'Chat Question', metric: 'total_tokens', value: 50, kind: 'number' },
    { flow: 'Chat Question', metric: 'conversation', value: 'screens/chat.png', kind: 'image' },
    { flow: 'Only In A', metric: 'pass', value: true, kind: 'pass' },
  ],
};

const runB: RunData = {
  meta: { label: 'run-b', target: 'https://b.example' },
  rows: [
    { flow: 'Chat Question', metric: 'pass', value: true, kind: 'pass' },
    { flow: 'Chat Question', metric: 'pass', value: false, kind: 'pass' },
    { flow: 'Chat Question', metric: 'total_tokens', value: 70, kind: 'number' },
  ],
};

describe('mergeRuns', () => {
  it('merges rows by (flow, metric) into one column per run', () => {
    const merged = mergeRuns([runA, runB]);
    expect(merged.columns.map((c) => c.label)).toEqual(['run-a', 'run-b']);

    const chat = merged.flows.find((f) => f.flow === 'Chat Question')!;
    const tokens = chat.metrics.find((m) => m.metric === 'total_tokens')!;
    expect(tokens.values).toEqual([150, 70]); // duplicates within a run SUM
    expect(tokens.kind).toBe('number');
  });

  it('ANDs duplicate pass rows within a run', () => {
    const merged = mergeRuns([runA, runB]);
    const chat = merged.flows.find((f) => f.flow === 'Chat Question')!;
    const pass = chat.metrics.find((m) => m.metric === 'pass')!;
    expect(pass.values).toEqual([true, false]); // run-b had a failing test in the flow
  });

  it('renders null for a metric a run never recorded (asymmetric flows degrade gracefully)', () => {
    const merged = mergeRuns([runA, runB]);
    const onlyA = merged.flows.find((f) => f.flow === 'Only In A')!;
    const pass = onlyA.metrics.find((m) => m.metric === 'pass')!;
    expect(pass.values).toEqual([true, null]);

    const chat = merged.flows.find((f) => f.flow === 'Chat Question')!;
    const image = chat.metrics.find((m) => m.metric === 'conversation')!;
    expect(image.values).toEqual(['screens/chat.png', null]);
  });
});

describe('renderHtml', () => {
  it('renders labels, PASS/FAIL, numbers, and inlines images as data URIs', () => {
    const merged = mergeRuns([runA, runB]);
    const png = Buffer.from('fake-png-bytes');
    const html = renderHtml(merged, {
      resolveImage: (col, rel) => (col === 0 && rel === 'screens/chat.png' ? png : null),
    });
    expect(html).toContain('run-a');
    expect(html).toContain('run-b');
    expect(html).toContain('PASS');
    expect(html).toContain('FAIL');
    expect(html).toContain('150');
    expect(html).toContain(`data:image/png;base64,${png.toString('base64')}`);
    // The run that has no image for the row renders a placeholder, not a broken tag.
    expect(html).toContain('—');
  });
});
