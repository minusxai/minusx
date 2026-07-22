'use client';

/**
 * The V2 pivot source renderer (RFC §10: DOM tier, second resident) — a thin
 * envelope adapter over the REAL PivotTable: aggregation (pure pivot-utils),
 * formulas, heatmap, subtotals, collapsible groups, and cell drilldown all
 * reused wholesale.
 *
 * Persisted state lives in the envelope: the typed PivotConfig structure plus
 * columnFormats / css. The css override is scoped to THIS instance under a
 * per-mount class; the contract is the `.mx-pivot` root + element selectors
 * (`.mx-pivot th { … }`).
 */
import { useId, useMemo, useState, useCallback } from 'react';
import { PivotTable } from '@/components/plotx/PivotTable';
import { DrillDownCard, type DrillDownState } from '@/components/plotx/DrillDownCard';
import { ChartError } from '@/components/plotx/ChartError';
import { aggregatePivotData, computeFormulas } from '@/lib/chart/pivot-utils';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { getPivotConfig, getVizColumnFormats, getVizCss, getTableConditionalFormats } from '@/lib/viz/encoding-edit';

export interface VizPivotViewProps {
  envelope: VizEnvelope;
  rows: Record<string, unknown>[];
  sql?: string;
  databaseName?: string;
  enableDrilldown?: boolean;
}

// Same policy the validator enforces (E_CSS) — render-time guard; violating css
// is dropped whole, not patched.
const isCssSafe = (css: string): boolean => !/@import/i.test(css) && !/url\s*\(/i.test(css);

export function VizPivotView({ envelope, rows, sql, databaseName, enableDrilldown }: VizPivotViewProps) {
  const scopeClass = `mx-viz-scope-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const css = getVizCss(envelope);
  const config = getPivotConfig(envelope);
  const columnFormats = getVizColumnFormats(envelope);
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);
  const closeDrillDown = useCallback(() => setDrillDown(null), []);

  const pivotData = useMemo(() => {
    if (!config || config.values.length === 0) return null;
    return aggregatePivotData(rows as Record<string, never>[], config);
  }, [rows, config]);

  const formulaResults = useMemo(() => {
    if (!pivotData || !config) return null;
    return computeFormulas(pivotData, config);
  }, [pivotData, config]);

  const handleCellClick = useCallback((filters: Record<string, string>, valueLabel: string, event: React.MouseEvent) => {
    setDrillDown({ filters, yColumn: valueLabel, position: { x: event.clientX, y: event.clientY } });
  }, []);

  if (!config || !pivotData || pivotData.cells.length === 0) {
    return (
      <ChartError
        variant="info"
        title="No data to display"
        message="Drag columns to Rows, Columns, and Values to build your pivot table"
      />
    );
  }

  return (
    <div className={`${scopeClass} flex min-h-0 w-full flex-1 flex-col p-3`}>
      {css && isCssSafe(css) && (
        // Native CSS nesting scopes every user rule under this instance.
        <style>{`.${scopeClass} { ${css} }`}</style>
      )}
      <PivotTable
        pivotData={pivotData}
        showRowTotals={config.showRowTotals !== false}
        showColTotals={config.showColumnTotals !== false}
        showHeatmap={config.showHeatmap !== false}
        compact={config.compact === true}
        heatmapScale={(config.heatmapScale as 'red-yellow-green' | 'green' | 'blue') ?? 'red-yellow-green'}
        rowDimNames={config.rows.map(col => columnFormats[col]?.alias || col)}
        colDimNames={config.columns.map(col => columnFormats[col]?.alias || col)}
        formulaResults={formulaResults}
        onCellClick={enableDrilldown ? handleCellClick : undefined}
        columnFormats={columnFormats}
        valueColumns={config.values.map(v => v.column)}
        conditionalFormats={getTableConditionalFormats(envelope)}
      />
      <DrillDownCard drillDown={drillDown} onClose={closeDrillDown} sql={sql} databaseName={databaseName} />
    </div>
  );
}
