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
import { DEFAULT_IMAGE_VARIANT, variantKey } from '../../test/qa/image-variants';

const runA: RunData = {
  meta: { label: 'run-a', target: 'https://a.example' },
  rows: [
    { flow: 'Chat Question', metric: 'pass', value: true, kind: 'pass' },
    { flow: 'Chat Question', metric: 'cost_usd', value: 0.0123, kind: 'number' },
    { flow: 'Chat Question', metric: 'cost_usd', value: 0.011, kind: 'number' },
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
    // An image row with no recorded variant reads as the default one, so a run
    // captured before the variant matrix existed still renders.
    expect(image.values).toEqual([{ [variantKey(DEFAULT_IMAGE_VARIANT)]: 'screens/chat.png' }, null]);
  });

  it('collects an image row captured in several variants into one keyed set', () => {
    const run: RunData = {
      meta: { label: 'variants', target: 'local' },
      rows: [
        { flow: 'Story Creation', metric: 'story', value: 'screens/s-laptop-pw.png', kind: 'image', variant: { size: 'laptop', renderer: 'playwright' } },
        { flow: 'Story Creation', metric: 'story', value: 'screens/s-laptop-dl.png', kind: 'image', variant: { size: 'laptop', renderer: 'download' } },
        { flow: 'Story Creation', metric: 'story', value: 'screens/s-mobile-pw.png', kind: 'image', variant: { size: 'mobile', renderer: 'playwright' } },
      ],
    };
    const image = mergeRuns([run]).flows[0].metrics[0];
    expect(image.values[0]).toEqual({
      'laptop:playwright': 'screens/s-laptop-pw.png',
      'laptop:download': 'screens/s-laptop-dl.png',
      'mobile:playwright': 'screens/s-mobile-pw.png',
    });
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
    // Column targets are clickable links to the runs' deployments.
    expect(html).toContain('<a href="https://a.example"');
    expect(html).toContain('<a href="https://b.example"');
    expect(html).toContain('PASS');
    expect(html).toContain('FAIL');
    expect(html).toContain('150');
    // Fractional values (cost) keep enough precision to compare — never "0".
    expect(html).toContain('0.0233');
    expect(html).toContain(`data:image/png;base64,${png.toString('base64')}`);
    // The run that has no image for the row renders a placeholder, not a broken tag.
    expect(html).toContain('—');
  });

  it('emits one img per captured variant, tagged so the settings toggle can switch between them', () => {
    const run: RunData = {
      meta: { label: 'variants', target: 'local' },
      rows: [
        { flow: 'Story Creation', metric: 'story', value: 'a.png', kind: 'image', variant: { size: 'laptop', renderer: 'playwright' } },
        { flow: 'Story Creation', metric: 'story', value: 'b.png', kind: 'image', variant: { size: 'mobile', renderer: 'download' } },
      ],
    };
    const html = renderHtml(mergeRuns([run]), { resolveImage: (_c, rel) => Buffer.from(rel) });
    expect(html).toContain('data-variant="laptop:playwright"');
    expect(html).toContain('data-variant="mobile:download"');
    expect(html).toContain(`data:image/png;base64,${Buffer.from('a.png').toString('base64')}`);
    expect(html).toContain(`data:image/png;base64,${Buffer.from('b.png').toString('base64')}`);
  });

  it('still renders an image value from an older report.json (a bare path, no variants)', () => {
    const legacy = {
      columns: [{ label: 'old', target: 'local' }],
      flows: [{ flow: 'F', metrics: [{ metric: 'story', kind: 'image' as const, values: ['screens/old.png'] }] }],
    };
    const html = renderHtml(legacy, { resolveImage: () => Buffer.from('old-bytes') });
    expect(html).toContain('data-variant="laptop:playwright"');
    expect(html).toContain(`data:image/png;base64,${Buffer.from('old-bytes').toString('base64')}`);
  });

  it('renders the settings control, its Size/Renderer toggles, and the lightbox', () => {
    const html = renderHtml(mergeRuns([runA]), { resolveImage: () => Buffer.from('x') });
    // The settings box and the two toggle groups it opens.
    expect(html).toContain('aria-label="Open report settings"');
    expect(html).toContain('aria-label="Image size"');
    expect(html).toContain('aria-label="Image renderer"');
    // Defaults: laptop + playwright, i.e. exactly what the old report showed.
    expect(html).toContain('value="laptop" checked');
    expect(html).toContain('value="playwright" checked');
    // Lightbox: thumbnails open it, and it can escape the data: URL restriction.
    expect(html).toContain('aria-label="Close image preview"');
    expect(html).toContain('aria-label="Open image in new tab"');
    expect(html).toContain('createObjectURL');
  });
});
