import { describe, it, expect } from 'vitest';
import { buildDebugVegaSpec } from '@/lib/convo-debug/vega-spec';
import { buildConvoDebugModel } from '@/lib/convo-debug';
import { makeInput, user, assistant, toolResult, rootInvocation, logEntry } from './fixtures';

function model() {
  const a1 = assistant(
    [{ type: 'toolCall', id: 't1', name: 'ExecuteQuery', arguments: {} }],
    { stopReason: 'toolUse' },
  );
  const a2 = assistant([{ type: 'text', text: 'done' }]);
  const input = makeInput({
    systemPrompt: 'sys',
    messages: [user('question'), a1, toolResult('t1', 'ExecuteQuery', 'rows'), a2],
    log: [rootInvocation('r1'), logEntry(a1, 'r1'), logEntry(toolResult('t1', 'ExecuteQuery', 'rows'), 'r1'), logEntry(a2, 'r1')],
  });
  return buildConvoDebugModel(input);
}

describe('buildDebugVegaSpec', () => {
  it('emits a stacked bar spec keyed to the reserved named dataset (no inline data)', () => {
    const { spec } = buildDebugVegaSpec(model().bars, 'expected');
    expect(spec.data).toBeUndefined();
    const encoding = spec.encoding as Record<string, Record<string, unknown>>;
    expect(encoding.x.field).toBe('bar');
    expect(encoding.y.field).toBe('tokens');
    expect((encoding.y as { aggregate?: string }).aggregate).toBe('sum');
    expect(encoding.color.field).toBe('component');
    const mark = typeof spec.mark === 'string' ? spec.mark : (spec.mark as { type?: string })?.type;
    expect(mark).toBe('bar');
  });

  it('emits one row per component carrying click/tooltip payload', () => {
    const m = model();
    const { rows } = buildDebugVegaSpec(m.bars, 'expected');
    const componentCount = m.bars.reduce((s, b) => s + b.components.length, 0);
    expect(rows).toHaveLength(componentCount);
    for (const row of rows) {
      expect(typeof row.barIndex).toBe('number');
      expect(typeof row.componentIndex).toBe('number');
      expect(typeof row.bar).toBe('string');
      expect(typeof row.component).toBe('string');
      expect(typeof row.tokens).toBe('number');
      expect(typeof row.cost).toBe('string');
    }
    // Bars keep x order via barIndex; rows reference real bars.
    const barLabels = new Set(m.bars.map((b) => b.label));
    for (const row of rows) expect(barLabels.has(row.bar as string)).toBe(true);
  });

  it('uses a deterministic color domain covering exactly the component types present', () => {
    const m = model();
    const { spec } = buildDebugVegaSpec(m.bars, 'expected');
    const color = (spec.encoding as Record<string, unknown>).color as { scale?: { domain?: string[]; range?: string[] } };
    const present = new Set(m.bars.flatMap((b) => b.components.map((c) => c.type)));
    expect(new Set(color.scale?.domain)).toEqual(present);
    expect(color.scale?.range).toHaveLength(color.scale?.domain?.length ?? 0);
    // Same input → same spec (determinism).
    const again = buildDebugVegaSpec(m.bars, 'expected');
    expect(again.spec).toEqual(spec);
  });

  it('switches the per-bar cost annotation with costMode', () => {
    const m = model();
    const expected = buildDebugVegaSpec(m.bars, 'expected');
    const actual = buildDebugVegaSpec(m.bars, 'actual');
    // Rows must re-render with the other mode's cost labels (they may coincide
    // numerically at 0 rates; assert the mode is stamped for tooltips).
    expect(expected.rows.every((r) => r.costMode === 'expected')).toBe(true);
    expect(actual.rows.every((r) => r.costMode === 'actual')).toBe(true);
  });
});

describe('buildConvoDebugModel (composition)', () => {
  it('returns bars + calls + totals wired together', () => {
    const m = model();
    expect(m.bars.length).toBe(4);
    expect(m.calls.length).toBe(2);
    expect(m.totals.actualTotalUsd).toBeGreaterThanOrEqual(0);
  });
});
