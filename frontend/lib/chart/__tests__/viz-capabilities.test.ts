/**
 * VIZ_CAPABILITIES — the single source of truth for what each viz type exposes:
 * renderer, drop zones, human-UI panels, applicable style levers, and escape hatches.
 * Drives AxisBuilder panel visibility, the agent's live-generated styling docs, and
 * registry-based viz warnings — so it must stay exhaustive and internally consistent.
 */
import { describe, it, expect } from 'vitest';
import { VIZ_TYPES } from '@/lib/validation/atlas-schemas';
import { VIZ_CAPABILITIES } from '../viz-capabilities';

describe('VIZ_CAPABILITIES registry', () => {
  it('has an entry for every canonical viz type', () => {
    for (const type of VIZ_TYPES) {
      expect(VIZ_CAPABILITIES[type], `missing capability entry for '${type}'`).toBeDefined();
    }
    expect(Object.keys(VIZ_CAPABILITIES).sort()).toEqual([...VIZ_TYPES].sort());
  });

  it('exposes echartsOverrides exactly for ECharts-rendered types', () => {
    for (const type of VIZ_TYPES) {
      const cap = VIZ_CAPABILITIES[type];
      expect(cap.levers.echartsOverrides, type).toBe(cap.renderer === 'echarts');
    }
  });

  it('exposes cssOverrides exactly for DOM/Leaflet-rendered types (the non-canvas hatch)', () => {
    for (const type of VIZ_TYPES) {
      const cap = VIZ_CAPABILITIES[type];
      expect(cap.levers.cssOverrides, type).toBe(cap.renderer !== 'echarts');
    }
  });

  it('non-echarts types declare css hooks so the agent knows what to target', () => {
    for (const type of VIZ_TYPES) {
      const cap = VIZ_CAPABILITIES[type];
      if (cap.levers.cssOverrides) {
        expect(cap.cssHooks.length, `'${type}' exposes cssOverrides but documents no hooks`).toBeGreaterThan(0);
      } else {
        expect(cap.cssHooks).toEqual([]);
      }
    }
  });

  it('table-group levers are consistent: styleConfig.table only for table/pivot renderers', () => {
    for (const type of VIZ_TYPES) {
      const cap = VIZ_CAPABILITIES[type];
      const hasTableLever = cap.levers.styleConfig.includes('table');
      expect(hasTableLever, type).toBe(cap.renderer === 'table' || cap.renderer === 'pivot');
      expect(cap.levers.conditionalFormats, type).toBe(cap.renderer === 'table');
    }
  });

  // Blue→red guard for the Phase 4 swap: the registry's panels must exactly reproduce
  // AxisBuilder's current CHART_SETTINGS behavior for the ECharts chart types.
  it('panel visibility matches the legacy AxisBuilder CHART_SETTINGS values', () => {
    const legacy: Record<string, { xAxisSettings: boolean; yAxisSettings: boolean; style: boolean; annotations: boolean }> = {
      line:      { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: true },
      bar:       { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: true },
      area:      { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: true },
      scatter:   { xAxisSettings: true,  yAxisSettings: true,  style: true,  annotations: true },
      funnel:    { xAxisSettings: false, yAxisSettings: false, style: true,  annotations: false },
      pie:       { xAxisSettings: false, yAxisSettings: false, style: true,  annotations: false },
      waterfall: { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: false },
      combo:     { xAxisSettings: false, yAxisSettings: true,  style: true,  annotations: false },
      radar:     { xAxisSettings: false, yAxisSettings: false, style: true,  annotations: false },
    };
    for (const [type, expected] of Object.entries(legacy)) {
      const { panels } = VIZ_CAPABILITIES[type as keyof typeof VIZ_CAPABILITIES];
      expect({
        xAxisSettings: panels.xAxisSettings,
        yAxisSettings: panels.yAxisSettings,
        style: panels.style,
        annotations: panels.annotations,
      }, type).toEqual(expected);
    }
    // `row` is a horizontal bar rendered by the same builder — defaults applied today.
    expect(VIZ_CAPABILITIES.row.panels).toMatchObject({ yAxisSettings: true, style: true });
  });

  it('config groups route to the right types', () => {
    expect(VIZ_CAPABILITIES.pivot.levers.configGroup).toBe('pivotConfig');
    expect(VIZ_CAPABILITIES.geo.levers.configGroup).toBe('geoConfig');
    expect(VIZ_CAPABILITIES.trend.levers.configGroup).toBe('trendConfig');
    expect(VIZ_CAPABILITIES.single_value.levers.configGroup).toBe('singleValueConfig');
    expect(VIZ_CAPABILITIES.bar.levers.configGroup).toBeNull();
  });

  it('every entry carries a non-empty prompt note', () => {
    for (const type of VIZ_TYPES) {
      expect(VIZ_CAPABILITIES[type].notes.length, type).toBeGreaterThan(0);
    }
  });
});
