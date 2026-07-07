/**
 * Viz styling contracts — expanded VisualizationStyleConfig (curated levers + the two
 * escape hatches), the story-level chartTheme cascade field, and the EmbedVizStyles
 * presentation-only subset for saved-question story embeds.
 */
import { describe, it, expect } from 'vitest';
import { validateFileState } from '@/lib/validation/content-validators';
import { contentSchemaText } from '@/lib/validation/atlas-json-schemas';

const question = (styleConfig: unknown) => ({
  type: 'question' as const,
  content: {
    query: 'SELECT 1 AS n',
    connection_name: 'duckdb',
    vizSettings: { type: 'bar', xCols: ['n'], yCols: ['n'], styleConfig },
    parameters: null,
    description: null,
  },
});

describe('expanded VisualizationStyleConfig', () => {
  it('accepts all curated levers', () => {
    expect(validateFileState(question({
      colors: { '0': 'danger' },
      opacity: 0.8,
      background: '#101822',
      textColor: '#f7f0df',
      titleColor: '#ffffff',
      smooth: false,
      legend: { show: true, position: 'bottom' },
      table: {
        headerBg: '#1a2b4a',
        headerTextColor: '#ffffff',
        rowStripe: true,
        stripeBg: 'rgba(0,0,0,0.04)',
        borderColor: '#334',
        cellFontSize: 13,
      },
    }))).toBeNull();
  });

  it('accepts the echartsOverrides escape hatch (arbitrary option fragment)', () => {
    expect(validateFileState(question({
      echartsOverrides: { grid: { left: 8 }, legend: { itemGap: 24 }, series: [{ symbol: 'none' }] },
    }))).toBeNull();
  });

  it('accepts the cssOverrides escape hatch (raw scoped CSS string)', () => {
    expect(validateFileState(question({
      cssOverrides: 'thead th { letter-spacing: 0.08em; } td { font-variant-numeric: tabular-nums; }',
    }))).toBeNull();
  });

  it('still accepts legacy styleConfig with only the original fields', () => {
    expect(validateFileState(question({ colors: { '0': 'teal' }, stacked: false }))).toBeNull();
  });

  it('rejects an invalid legend position', () => {
    expect(validateFileState(question({ legend: { position: 'diagonal' } }))).not.toBeNull();
  });

  it('rejects a non-string cssOverrides', () => {
    expect(validateFileState(question({ cssOverrides: { thead: 'nope' } }))).not.toBeNull();
  });
});

describe('StoryContent.chartTheme', () => {
  it('accepts a story-wide chart theme', () => {
    expect(validateFileState({
      type: 'story',
      content: {
        description: null,
        story: '<div data-question-id="7" style="width:100%;height:420px"></div>',
        chartTheme: {
          palette: ['#0f4c81', '#e8a33d', '#7bb3a0'],
          background: '#fdfaf3',
          textColor: '#2b2b2b',
          legend: { position: 'bottom' },
        },
      },
    })).toBeNull();
  });

  it('accepts chartTheme: null and stories without the field (back-compat)', () => {
    expect(validateFileState({ type: 'story', content: { description: null, story: null, chartTheme: null } })).toBeNull();
    expect(validateFileState({ type: 'story', content: { description: null, story: null } })).toBeNull();
  });

  it('rejects a non-array palette', () => {
    expect(validateFileState({
      type: 'story',
      content: { description: null, story: null, chartTheme: { palette: '#0f4c81' } },
    })).not.toBeNull();
  });

  it('is advertised in the agent-facing story schema (skill template var)', () => {
    const text = contentSchemaText('story');
    expect(text).toContain('chartTheme');
    expect(text).toContain('palette');
  });
});
