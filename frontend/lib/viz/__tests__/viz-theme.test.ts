import { describe, it, expect } from 'vitest';
import { getVegaLiteConfig } from '@/lib/viz/theme';
import { COLOR_PALETTE } from '@/lib/chart/echarts-theme';

describe('getVegaLiteConfig', () => {
  it('uses JetBrains Mono across text roles in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const config = getVegaLiteConfig(mode) as Record<string, any>;
      expect(config.font).toContain('JetBrains Mono');
    }
  });

  it('uses the shared MinusX palette as the category range (no drift from ECharts)', () => {
    const config = getVegaLiteConfig('dark') as Record<string, any>;
    expect(config.range.category).toEqual(COLOR_PALETTE);
  });

  it('light and dark differ in foreground text color', () => {
    const light = getVegaLiteConfig('light') as Record<string, any>;
    const dark = getVegaLiteConfig('dark') as Record<string, any>;
    expect(light.axis.labelColor).not.toEqual(dark.axis.labelColor);
  });

  it('keeps the chart background transparent (the card owns the surface)', () => {
    const config = getVegaLiteConfig('dark') as Record<string, any>;
    expect(config.background).toBe('transparent');
  });

  it('places legends on top with the title inline-left', () => {
    const config = getVegaLiteConfig('dark') as Record<string, any>;
    expect(config.legend.orient).toBe('top');
    expect(config.legend.titleOrient).toBe('left');
  });

  it('enables encoding tooltips on all marks by default', () => {
    const config = getVegaLiteConfig('dark') as Record<string, any>;
    expect(config.mark.tooltip).toEqual({ content: 'encoding' });
  });

  it('defaults quantitative labels to SI units (20,000 → 20k)', () => {
    const config = getVegaLiteConfig('dark') as Record<string, any>;
    expect(config.numberFormat).toBe('.3~s');
  });
});
