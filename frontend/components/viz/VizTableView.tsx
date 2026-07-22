'use client';

/**
 * The V2 table source renderer (RFC §10: the DOM tier) — a thin envelope adapter
 * over the REAL TableV2, so every table capability (sorting, faceted filters,
 * column visibility/resize, virtualization, stats, CSV, drilldown, header format
 * editor) is reused wholesale.
 *
 * Persisted state lives in the envelope: columnFormats / conditionalFormats /
 * css. The css override is scoped to THIS instance via native CSS nesting under
 * a per-mount class, written against the stable .mx-* class contract (see
 * VizSourceTable in atlas-schemas). Chrome has no toggles by design — surfaces
 * and overrides hide it with `.mx-toolbar { display: none }`.
 */
import { useId } from 'react';
import { TableV2 } from '@/components/plotx/TableV2';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { getVizColumnFormats, getTableConditionalFormats, getVizCss, setVizColumnFormats } from '@/lib/viz/encoding-edit';

export interface VizTableViewProps {
  envelope: VizEnvelope;
  columns: string[];
  types: string[];
  rows: Record<string, unknown>[];
  sql?: string;
  databaseName?: string;
  enableDrilldown?: boolean;
  /** Envelope write-back for header format edits. Omit for read-only surfaces. */
  onVizChange?: (envelope: VizEnvelope) => void;
}

// Same policy the validator enforces (E_CSS) — a render-time guard for envelopes
// written outside the validated paths. Violating css is dropped whole, not patched.
const isCssSafe = (css: string): boolean => !/@import/i.test(css) && !/url\s*\(/i.test(css);

export function VizTableView({ envelope, columns, types, rows, sql, databaseName, enableDrilldown, onVizChange }: VizTableViewProps) {
  const scopeClass = `mx-viz-scope-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const css = getVizCss(envelope);
  const columnFormats = getVizColumnFormats(envelope);

  return (
    <div className={`${scopeClass} flex min-h-0 w-full flex-1 flex-col`}>
      {css && isCssSafe(css) && (
        // Native CSS nesting scopes every user rule under this instance.
        <style>{`.${scopeClass} { ${css} }`}</style>
      )}
      <TableV2
        columns={columns}
        types={types}
        rows={rows}
        sql={sql}
        databaseName={databaseName}
        enableDrilldown={enableDrilldown}
        columnFormats={Object.keys(columnFormats).length > 0 ? columnFormats : undefined}
        onColumnFormatsChange={onVizChange ? (formats) => onVizChange(setVizColumnFormats(envelope, formats)) : undefined}
        conditionalFormats={getTableConditionalFormats(envelope)}
        d3Formats
      />
    </div>
  );
}
