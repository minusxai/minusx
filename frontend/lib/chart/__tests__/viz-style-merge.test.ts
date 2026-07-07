/**
 * The render-time style cascade for story-embedded questions:
 *   story chartTheme  <  question vizSettings  <  embed styles prop
 * Merge is presentation-only (styleConfig/axisConfig/columnFormats/conditionalFormats/
 * singleValueConfig) and never mutates or leaks into the saved question content.
 * `null` in VizSettings means "unset", so overlay layers are null-pruned before merging —
 * a question's explicit `styleConfig: null` must NOT erase a story theme default.
 */
import { describe, it, expect } from 'vitest';
import type { VizSettings } from '@/lib/validation/atlas-schemas';
import { pruneNulls, chartThemeToVizPartial, resolveEffectiveVizSettings } from '../viz-style-merge';

const base: VizSettings = {
  type: 'bar',
  xCols: ['month'],
  yCols: ['revenue', 'cost'],
  styleConfig: { colors: { '1': 'danger' }, stacked: false },
  axisConfig: null,
};

describe('pruneNulls', () => {
  it('drops null/undefined recursively, keeps falsy non-null values', () => {
    expect(pruneNulls({ a: null, b: undefined, c: 0, d: false, e: '', f: { g: null, h: 'x' } }))
      .toEqual({ c: 0, d: false, e: '', f: { h: 'x' } });
  });

  it('leaves arrays intact (replace semantics, not merged)', () => {
    expect(pruneNulls({ a: [1, 2], b: { c: ['x'] } })).toEqual({ a: [1, 2], b: { c: ['x'] } });
  });
});

describe('chartThemeToVizPartial', () => {
  it('maps palette to an index→color styleConfig.colors map', () => {
    const partial = chartThemeToVizPartial({ palette: ['#111111', '#222222'] });
    expect(partial.styleConfig?.colors).toEqual({ '0': '#111111', '1': '#222222' });
  });

  it('carries background/text/title/legend into styleConfig', () => {
    const partial = chartThemeToVizPartial({
      background: '#fdfaf3', textColor: '#2b2b2b', titleColor: '#000000', legend: { position: 'bottom' },
    });
    expect(partial.styleConfig).toMatchObject({
      background: '#fdfaf3', textColor: '#2b2b2b', titleColor: '#000000', legend: { position: 'bottom' },
    });
  });

  it('returns an empty partial for null/undefined themes', () => {
    expect(chartThemeToVizPartial(null)).toEqual({});
    expect(chartThemeToVizPartial(undefined)).toEqual({});
  });
});

describe('resolveEffectiveVizSettings — precedence theme < question < embed', () => {
  it('theme provides defaults the question does not set', () => {
    const out = resolveEffectiveVizSettings(base, { background: '#fdfaf3', textColor: '#2b2b2b' });
    expect(out.styleConfig).toMatchObject({ background: '#fdfaf3', textColor: '#2b2b2b', stacked: false });
  });

  it('question values beat theme values', () => {
    const withBg: VizSettings = { ...base, styleConfig: { ...base.styleConfig, background: '#000000' } };
    const out = resolveEffectiveVizSettings(withBg, { background: '#fdfaf3' });
    expect(out.styleConfig?.background).toBe('#000000');
  });

  it('embed styles beat both theme and question', () => {
    const out = resolveEffectiveVizSettings(
      { ...base, styleConfig: { ...base.styleConfig, background: '#000000' } },
      { background: '#fdfaf3', textColor: '#2b2b2b' },
      { styleConfig: { background: '#101822' } },
    );
    expect(out.styleConfig?.background).toBe('#101822');
    expect(out.styleConfig?.textColor).toBe('#2b2b2b'); // theme default survives underneath
    expect(out.styleConfig?.stacked).toBe(false);       // question value survives
  });

  it("a question's explicit null styleConfig does NOT erase theme defaults", () => {
    const out = resolveEffectiveVizSettings({ ...base, styleConfig: null }, { background: '#fdfaf3' });
    expect(out.styleConfig?.background).toBe('#fdfaf3');
  });

  it('per-index question color beats the theme palette at that index only', () => {
    const out = resolveEffectiveVizSettings(base, { palette: ['#111111', '#222222', '#333333'] });
    expect(out.styleConfig?.colors).toEqual({ '0': '#111111', '1': 'danger', '2': '#333333' });
  });

  it('arrays replace wholesale (conditionalFormats from embed wins outright)', () => {
    const rule = { id: 'r1', column: 'n', operator: '>' as const, value: '5', target: 'cell' as const, bgColor: '#fde68a' };
    const baseWithRules: VizSettings = {
      ...base,
      type: 'table',
      conditionalFormats: [{ ...rule, id: 'old', bgColor: '#ffffff' }, { ...rule, id: 'old2' }],
    };
    const out = resolveEffectiveVizSettings(baseWithRules, null, { conditionalFormats: [rule] });
    expect(out.conditionalFormats).toEqual([rule]);
  });

  it('never touches non-presentation fields (type, columns, pivotConfig)', () => {
    const out = resolveEffectiveVizSettings(
      base,
      { background: '#fdfaf3' },
      // a hostile/over-broad embed payload: non-presentation keys must be ignored
      { styleConfig: { background: '#101822' }, type: 'pie', xCols: ['hacked'] } as never,
    );
    expect(out.type).toBe('bar');
    expect(out.xCols).toEqual(['month']);
    expect(out.yCols).toEqual(['revenue', 'cost']);
  });

  it('no theme and no embed returns settings equal to base, and never mutates base', () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    const out = resolveEffectiveVizSettings(base);
    expect(out).toEqual(base);
    resolveEffectiveVizSettings(base, { background: '#fdfaf3' }, { styleConfig: { textColor: '#fff' } });
    expect(base).toEqual(snapshot);
  });

  it('tolerates a question with NO vizSettings (optional in QuestionContent) — themes onto the table default', () => {
    const out = resolveEffectiveVizSettings(undefined, { background: '#fdfaf3' }, { styleConfig: { textColor: '#2b2b2b' } });
    expect(out.type).toBe('table');
    expect(out.styleConfig).toMatchObject({ background: '#fdfaf3', textColor: '#2b2b2b' });
    expect(resolveEffectiveVizSettings(null)).toEqual({ type: 'table' });
  });

  it('merges columnFormats per column (embed adds a column format without erasing others)', () => {
    const b: VizSettings = { ...base, columnFormats: { revenue: { prefix: '$' } } };
    const out = resolveEffectiveVizSettings(b, null, { columnFormats: { cost: { suffix: '%' } } });
    expect(out.columnFormats).toEqual({ revenue: { prefix: '$' }, cost: { suffix: '%' } });
  });
});
