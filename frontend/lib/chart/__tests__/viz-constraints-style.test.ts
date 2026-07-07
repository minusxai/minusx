/**
 * Registry-driven style warnings — when the agent sets an escape hatch or style group on a
 * type whose renderer ignores it, EditFile's vizWarning tells it immediately (instead of the
 * agent believing the styling landed). Applicability comes from VIZ_CAPABILITIES.
 */
import { describe, it, expect } from 'vitest';
import { getVizSettingsWarning } from '../viz-constraints';
import type { VizSettings } from '@/lib/validation/atlas-schemas';

const viz = (partial: Partial<VizSettings>): VizSettings => ({
  type: 'bar', xCols: ['m'], yCols: ['r'], ...partial,
});

describe('getVizSettingsWarning — escape-hatch / style-group applicability', () => {
  it('warns when echartsOverrides is set on a non-ECharts type (table), pointing at cssOverrides', () => {
    const warning = getVizSettingsWarning(viz({ type: 'table', styleConfig: { echartsOverrides: { grid: { left: 8 } } } }));
    expect(warning).toContain('echartsOverrides');
    expect(warning).toContain('cssOverrides');
  });

  it('warns when cssOverrides is set on a canvas type (line), pointing at echartsOverrides', () => {
    const warning = getVizSettingsWarning(viz({ type: 'line', styleConfig: { cssOverrides: 'td { color: red; }' } }));
    expect(warning).toContain('cssOverrides');
    expect(warning).toContain('echartsOverrides');
  });

  it('warns when styleConfig.table is set on a chart type', () => {
    const warning = getVizSettingsWarning(viz({ type: 'line', styleConfig: { table: { headerBg: '#111' } } }));
    expect(warning).toContain('styleConfig.table');
  });

  it('stays silent when the hatch matches the renderer', () => {
    expect(getVizSettingsWarning(viz({ styleConfig: { echartsOverrides: { grid: { left: 8 } } } }))).toBeNull();
    expect(getVizSettingsWarning(viz({ type: 'pivot', xCols: [], yCols: [], pivotConfig: { rows: ['a'], columns: [], values: [{ column: 'r' }] }, styleConfig: { cssOverrides: 'td { color: red; }', table: { headerBg: '#111' } } }))).toBeNull();
    expect(getVizSettingsWarning(viz({ type: 'table', xCols: [], yCols: [], styleConfig: { table: { rowStripe: false } } }))).toBeNull();
  });

  it('keeps the structural constraints (trend without a date X still warns)', () => {
    const warning = getVizSettingsWarning(
      viz({ type: 'trend', xCols: ['name'], yCols: ['r'] }),
      ['name', 'r'],
      ['VARCHAR', 'INTEGER'],
    );
    expect(warning).toContain('date/time');
  });
});
