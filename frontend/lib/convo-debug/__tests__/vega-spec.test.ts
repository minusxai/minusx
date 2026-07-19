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
  it('emits a HORIZONTAL stacked bar spec (turns as rows, tokens left→right, symlog scale)', () => {
    const { spec } = buildDebugVegaSpec(model().bars, 'expected');
    expect(spec.data).toBeUndefined();
    const encoding = spec.encoding as Record<string, Record<string, unknown>>;
    // Horizontal: turns on y (top→bottom), token length on x (left→right).
    expect(encoding.y.field).toBe('bar');
    expect(encoding.x.field).toBe('tokens');
    // Symlog keeps small bars visible without breaking near-zero values.
    expect((encoding.x.scale as { type?: string })?.type).toBe('symlog');
    // NO aggregation: each row must stay its own stacked segment (separate
    // tool-call/result sizes) and keep barIndex/componentIndex on the datum
    // for click-to-inspect. A `detail` channel provides the per-row stacking.
    expect((encoding.x as { aggregate?: string }).aggregate).toBeUndefined();
    expect((encoding.detail as { field?: string }).field).toBe('componentIndex');
    expect(encoding.color.field).toBe('component');
    const mark = spec.mark as { type?: string; stroke?: string };
    expect(mark.type).toBe('bar');
    // Hairline stroke so consecutive same-color segments (two ReadFiles
    // results) remain visually separate blocks.
    expect(mark.stroke).toBeTruthy();
  });

  it('keys segment color by tool name for tool calls and results', () => {
    const m = model();
    const { rows, spec } = buildDebugVegaSpec(m.bars, 'expected');
    expect(rows.some((r) => r.component === 'ToolCalls · ExecuteQuery')).toBe(true);
    expect(rows.some((r) => r.component === 'ToolResult · ExecuteQuery')).toBe(true);
    const color = (spec.encoding as Record<string, unknown>).color as { scale?: { domain?: string[] } };
    expect(color.scale?.domain).toContain('ToolCalls · ExecuteQuery');
    expect(color.scale?.domain).toContain('ToolResult · ExecuteQuery');
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

  it('uses a deterministic color domain covering exactly the segment labels present', () => {
    const m = model();
    const { spec } = buildDebugVegaSpec(m.bars, 'expected');
    const color = (spec.encoding as Record<string, unknown>).color as { scale?: { domain?: string[]; range?: string[] } };
    const present = new Set(
      m.bars.flatMap((b) => b.components.map((c) => (c.toolName ? `${c.type} · ${c.toolName}` : c.type))),
    );
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
