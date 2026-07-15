/**
 * Shared-tooltip guide-line injection (Viz Arch V2).
 *
 * Bounds invariant: the guide `rule` must read its height from the rest-at-zero
 * `mxGuideH` signal, never from the fit-solved `height` signal — a hidden rule spanning
 * the plot must contribute ZERO bounds to the `autosize: fit` solve. It only grows to
 * the plot height on hover, when the layout is settled (VegaChart drives the signal).
 * (The silent-blank-chart bug this was once suspected of causing turned out to be the
 * tooltip-suppression ordering in VegaChart — covered by vega-chart-render.ui.test.tsx.)
 */
import { describe, it, expect } from 'vitest';
import { injectGuideMark } from '../guide-mark';

const compiledBar = () => ({
  marks: [{ type: 'rect', from: { data: 'main' }, encode: {} }],
  signals: [{ name: 'width', value: 400 }, { name: 'height', value: 300 }],
});

describe('injectGuideMark', () => {
  it('prepends the guide rule behind the data marks', () => {
    const spec = compiledBar();
    expect(injectGuideMark(spec)).toBe(true);
    expect(spec.marks[0].type).toBe('rule'); // unshifted → renders first → behind data
    expect(spec.marks[1].type).toBe('rect');
  });

  it('declares the mxGuidePx / mxGuideOn / mxGuideH signals', () => {
    const spec = compiledBar();
    injectGuideMark(spec);
    const names = spec.signals.map((s: { name: string }) => s.name);
    expect(names).toContain('mxGuidePx');
    expect(names).toContain('mxGuideOn');
    expect(names).toContain('mxGuideH');
  });

  it('rests mxGuideH at 0 so the guide adds no bounds to the autosize:fit solve', () => {
    const spec = compiledBar();
    injectGuideMark(spec);
    const guideH = spec.signals.find((s: { name: string }) => s.name === 'mxGuideH') as { value: number };
    expect(guideH.value).toBe(0);
  });

  it('the guide height references mxGuideH and NEVER the fit-solved `height` signal', () => {
    const spec = compiledBar();
    injectGuideMark(spec);
    const rule = spec.marks[0] as unknown as { encode: { update: { y2: { signal: string } } } };
    // `height` is the fit-solved signal — referencing it would feed the hidden guide's
    // full-plot bounds into the autosize solve.
    expect(rule.encode.update.y2.signal).toBe('mxGuideH');
    expect(rule.encode.update.y2.signal).not.toBe('height');
  });

  it('is a no-op for composed / empty-mark specs (nothing to unshift into)', () => {
    expect(injectGuideMark({ marks: [] })).toBe(false);
    expect(injectGuideMark({})).toBe(false);
  });
});
