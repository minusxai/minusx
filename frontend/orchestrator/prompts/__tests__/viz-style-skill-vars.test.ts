/**
 * The agent's styling knowledge is LIVE-GENERATED: the visualizations skill embeds the
 * rendered style schemas ({schema_viz_styles}) and the per-type capability table
 * ({viz_capabilities}) straight from VIZ_CAPABILITIES + the TypeBox schemas — so what the
 * LLM is told a viz type exposes can never drift from what the renderers honor.
 */
import { describe, it, expect } from 'vitest';
import { loadSkill } from '@/agents/skill-content';
import { VIZ_TYPES } from '@/lib/validation/atlas-schemas';

describe('visualizations skill — styling section', () => {
  const skill = loadSkill('visualizations') ?? '';

  it('resolves the live template vars (no raw placeholders leak)', () => {
    expect(skill).toBeTruthy();
    expect(skill).not.toContain('{viz_capabilities}');
    expect(skill).not.toContain('{schema_viz_styles}');
  });

  it('documents every viz type in the capabilities table', () => {
    for (const type of VIZ_TYPES) {
      expect(skill, `capabilities table missing '${type}'`).toContain(type);
    }
  });

  it('documents the expanded style surface and both escape hatches', () => {
    for (const needle of ['echartsOverrides', 'cssOverrides', 'background', 'legend', 'textColor', 'headerBg', 'StoryChartTheme', 'EmbedVizStyles']) {
      expect(skill, `missing '${needle}'`).toContain(needle);
    }
  });

  it('states the cascade precedence', () => {
    expect(skill).toContain('chartTheme < question vizSettings < embed styles');
  });
});

describe('stories skill — styling guidance', () => {
  const skill = loadSkill('stories') ?? '';

  it('teaches the styles prop and the chartTheme cascade', () => {
    expect(skill).toContain('styles={{');
    expect(skill).toContain('chartTheme');
  });

  it('no longer forbids styling chart internals', () => {
    expect(skill).not.toContain("never a chart's internals");
  });
});
