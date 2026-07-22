'use client';

/**
 * NotebookSqlCell — one inline SQL question inside a notebook. It is a full
 * question (query + connection + params + @refs + viz), edited and run in place.
 *
 * It composes the leaf parts of the question page rather than reusing the
 * file-coupled QuestionViewV2: the SQL/GUI/Viz mode tabs (QueryModeSelector +
 * SqlEditor / QueryBuilderRoot / VizTypeSelector + VizConfigPanel) and the
 * results (QuestionVisualization), with execution via the file-decoupled
 * useQueryResult (keyed on query/params/db) and @-reference wiring via
 * useQuestionReferences.
 *
 * Execution is local (cells aren't files): the Run button snapshots the current
 * query/params/connection into `executed`, which drives useQueryResult. Editing
 * the query persists the cell but leaves `executed` untouched, so results stay
 * visible while typing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/components/kit/cn';
import NotebookCellHeader from './NotebookCellHeader';
import SqlEditor from '@/components/query-builder/SqlEditor';
import ParameterRow from '@/components/params/ParameterRow';
import DatabaseSelector from '@/components/selectors/DatabaseSelector';
import { QuestionVisualization } from '@/components/question/QuestionVisualization';
import { VizTypeSelector, isClassicVizType } from '@/components/question/VizTypeSelector';
import { VizConfigPanel } from '@/components/plotx/VizConfigPanel';
import { QueryModeSelector, type QueryTab } from '@/components/query-builder';
import { useQueryResult } from '@/lib/hooks/file-state-hooks';
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import { useConnections } from '@/lib/hooks/useConnections';
import { useContext as useSchemaContext } from '@/lib/hooks/useContext';
import { connectionTypeToDialect } from '@/lib/types';
import type {
  NotebookSqlCell as SqlCell, QuestionContent, VizSettings, FullQuery,
} from '@/lib/types';

export interface Executed {
  query: string;
  params: Record<string, unknown>;
  database: string;
}

interface NotebookSqlCellProps {
  cell: SqlCell;
  active?: boolean;
  onActivate?: (cellId: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Bumped by the header "Run all" command — re-running this cell on change. */
  runNonce?: number;
  readOnly?: boolean;
  /** Present mode: hide all chrome/editor — show just the chart. */
  presentMode?: boolean;
  filePath?: string;
  /** What this cell last ran — lifted to NotebookView so results survive the
      edit↔present remount (the present view is a separate subtree). */
  executed?: Executed | null;
  onExecutedChange?: (executed: Executed) => void;
  /** Persist a freshly-run result up to the notebook (cached into content.cellResults). */
  onPersistResult?: (cellId: string, executed: Executed, data: unknown) => void;
  onCellChange: (id: string, partial: Partial<SqlCell>) => void;
  onRemove: (id: string) => void;
}

// Stable empty params so execution doesn't refetch every render.
const EMPTY_PARAMS: Record<string, unknown> = {};

export default function NotebookSqlCell({
  cell, active = false, onActivate, collapsed = false, onToggleCollapse, runNonce = 0,
  readOnly = false, presentMode = false, filePath, executed = null, onExecutedChange, onPersistResult, onCellChange, onRemove,
}: NotebookSqlCellProps) {
  const handleChange = useCallback(
    (partial: Partial<SqlCell>) => onCellChange(cell.id, partial),
    [onCellChange, cell.id],
  );

  const activate = useCallback(() => {
    if (!active) onActivate?.(cell.id);
  }, [active, onActivate, cell.id]);

  // `executed` is owned by NotebookView so results persist across present toggle.
  const { data, loading, error, refetch } = useQueryResult(
    executed?.query ?? '',
    executed?.params ?? EMPTY_PARAMS,
    executed?.database ?? '',
    { skip: !executed },
  );

  const mergedParameters = useMemo(() => cell.parameters ?? [], [cell.parameters]);
  // Debounced param sync on SQL edits (was part of the reference hook).
  const handleQueryChange = useCallback((query: string) => {
    handleChange({ query, parameters: syncParametersWithSQL(query, cell.parameters ?? []) } as Partial<SqlCell>);
  }, [handleChange, cell.parameters]);

  const { connections } = useConnections();
  const connectionType = cell.connection_name ? connections[cell.connection_name]?.metadata?.type : undefined;
  const dialect = connectionTypeToDialect(connectionType ?? '');

  // Schema for SQL autocomplete + GUI table filtering (from the notebook's context).
  const { databases: schemaData, hasContext } = useSchemaContext(filePath || '/org');
  const whitelistedSchema = hasContext
    ? schemaData?.find(db => db.databaseName === cell.connection_name)?.schemas
    : undefined;

  // Query mode: SQL editor, visual GUI builder, or chart config.
  const [queryMode, setQueryMode] = useState<QueryTab>('sql');
  // Rendered series count, reported by the chart so the sibling VizConfigPanel's
  // color swatches match split-by charts without re-aggregating the rows.
  const [chartSeriesCount, setChartSeriesCount] = useState<number | undefined>(undefined);

  // Proactive GUI-compatibility check: dim the GUI tab when the query can't be parsed.

  const run = useCallback(() => {
    onExecutedChange?.({
      query: cell.query,
      params: cell.parameterValues ?? {},
      database: cell.connection_name,
    });
    // If the same query was already executed, force a fresh fetch.
    refetch();
  }, [cell.query, cell.parameterValues, cell.connection_name, refetch, onExecutedChange]);

  // Persist a freshly-run result up to the notebook so it survives reload. The
  // capture itself no-ops when the identical data is already stored, so this
  // doesn't churn dirty state on rehydrate or re-render.
  useEffect(() => {
    if (readOnly || !executed || !data || !onPersistResult) return;
    onPersistResult(cell.id, executed, data);
  }, [data, executed, readOnly, onPersistResult, cell.id]);

  // Header "Run all" command: re-run this cell when the nonce changes.
  const lastRunNonce = useRef(runNonce);
  useEffect(() => {
    if (runNonce === lastRunNonce.current) return;
    lastRunNonce.current = runNonce;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- imperative "Run all" command from the header toolbar
    if (cell.query?.trim()) run();
  }, [runNonce, run, cell.query]);

  const setViz = useCallback(
    (patch: Partial<VizSettings>) => handleChange({ vizSettings: { ...(cell.vizSettings ?? { type: 'table' as const }), ...patch } }),
    [handleChange, cell.vizSettings],
  );

  const config = useMemo(() => ({
    showHeader: false,
    showJsonToggle: false,
    editable: !readOnly,
    viz: { showTypeButtons: false, showChartBuilder: true, typesButtonsOrientation: 'horizontal' as const, showTitle: false },
    fixError: true,
  }), [readOnly]);

  const vizType = cell.vizSettings?.type || 'table';

  // Present mode: render just the visualization (no header, editor, or tabs).
  // It shows results already run in this session; cells never run are skipped
  // (present does not execute queries — use "Run all" to refresh).
  if (presentMode) {
    if (!cell.query?.trim() || !executed) return null;
    return (
      <div>
        {cell.name && <p className="mb-2 text-sm font-semibold text-muted-foreground">{cell.name}</p>}
        <div className="flex h-[420px] flex-col">
          <QuestionVisualization
            currentState={cell as unknown as QuestionContent}
            config={{ showHeader: false, showJsonToggle: false, editable: false, viz: { showTypeButtons: false, showChartBuilder: false, typesButtonsOrientation: 'horizontal', showTitle: false }, fixError: true }}
            data={data}
            loading={loading && !data}
            error={error}
            onRetry={refetch}
            onVizTypeChange={() => {}}
            onAxisChange={() => {}}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-background transition-[border-color,box-shadow] duration-150',
        active
          ? 'border-[#16a085] shadow-[0_0_0_2px_#16a085] hover:border-[#16a085]'
          : 'border-border/60 hover:border-border',
      )}
      onMouseDownCapture={activate}
      onFocusCapture={activate}
    >
      <NotebookCellHeader
        cellType="sql"
        collapsed={collapsed}
        onToggleCollapse={() => onToggleCollapse?.()}
        name={cell.name ?? ''}
        onNameChange={(name) => handleChange({ name })}
        onRemove={() => onRemove(cell.id)}
        readOnly={readOnly}
        middle={
          <QueryModeSelector
            mode={queryMode}
            onModeChange={setQueryMode}
            canUseViz={!!data}
            size="sm"
          />
        }
        trailing={
          <DatabaseSelector
            value={cell.connection_name || ''}
            onChange={({ connection_name }: Pick<FullQuery, 'connection_name' | 'dialect'>) =>
              handleChange({ connection_name })}
          />
        }
      />

      {!collapsed && (
      <div>
      {/* Mode content */}
      {queryMode === 'sql' && (
        <div className="min-h-[120px]">
          <SqlEditor
            value={cell.query}
            onChange={handleQueryChange}
            onRun={run}
            readOnly={readOnly}
            showRunButton={!readOnly}
            showFormatButton={!readOnly}
            isRunning={loading && !data}
            schemaData={schemaData}
            databaseName={cell.connection_name}
            connectionType={connectionType}
          />
        </div>
      )}

      {queryMode === 'viz' && (
        <div className="flex max-h-[420px] flex-col gap-2 overflow-auto p-3">
          <VizTypeSelector value={vizType} onChange={(type) => { if (isClassicVizType(type)) setViz({ type }) }} orientation="grouped" />
          {vizType !== 'table' && data && (
            <VizConfigPanel
              columns={data.columns}
              types={data.types}
              chartType={vizType}
              initialXCols={cell.vizSettings?.xCols ?? undefined}
              initialYCols={cell.vizSettings?.yCols ?? undefined}
              initialYRightCols={cell.vizSettings?.yRightCols ?? undefined}
              onAxisChange={(xCols, yCols) => setViz({ xCols, yCols })}
              onYRightColsChange={(yRightCols) => setViz({ yRightCols })}
              initialTooltipCols={cell.vizSettings?.tooltipCols ?? undefined}
              onTooltipColsChange={(tooltipCols) => setViz({ tooltipCols })}
              initialPivotConfig={cell.vizSettings?.pivotConfig ?? undefined}
              onPivotConfigChange={(pivotConfig) => setViz({ pivotConfig })}
              initialGeoConfig={cell.vizSettings?.geoConfig ?? undefined}
              onGeoConfigChange={(geoConfig) => setViz({ geoConfig })}
              initialColumnFormats={cell.vizSettings?.columnFormats ?? undefined}
              onColumnFormatsChange={(columnFormats) => setViz({ columnFormats })}
              styleConfig={cell.vizSettings?.styleConfig ?? undefined}
              onStyleConfigChange={(styleConfig) => setViz({ styleConfig })}
              axisConfig={cell.vizSettings?.axisConfig ?? undefined}
              onAxisConfigChange={(axisConfig) => setViz({ axisConfig })}
              annotations={cell.vizSettings?.annotations ?? undefined}
              onAnnotationsChange={(annotations) => setViz({ annotations })}
              trendConfig={cell.vizSettings?.trendConfig ?? undefined}
              onTrendConfigChange={(trendConfig) => setViz({ trendConfig })}
              seriesCount={chartSeriesCount}
            />
          )}
        </div>
      )}

      {/* Parameters (current + referenced) */}
      {mergedParameters.length > 0 && (
        <ParameterRow
          parameters={mergedParameters}
          parameterValues={cell.parameterValues ?? undefined}
          lastSubmittedValues={executed?.params}
          onValueChange={(name, value) =>
            handleChange({ parameterValues: { ...(cell.parameterValues ?? {}), [name]: value } })}
          onSubmit={(values) => onExecutedChange?.({
            query: cell.query, params: values, database: cell.connection_name,
          })}
          onParametersChange={(parameters) => handleChange({ parameters })}
          database={cell.connection_name}
        />
      )}

      {/* Results — only after the cell has been run. Fixed height + minH:0 so
          the inner table/chart bounds to this area and scrolls (TableV2 scrolls
          internally) instead of the cell growing infinitely with the row count. */}
      {executed && (
        <div className="flex h-[380px] min-h-0 flex-col p-2">
          <QuestionVisualization
            currentState={cell as unknown as QuestionContent}
            config={config}
            data={data}
            loading={loading && !data}
            error={error}
            onRetry={refetch}
            onVizTypeChange={(type) => setViz({ type })}
            onAxisChange={(xCols, yCols) => setViz({ xCols, yCols })}
            onYRightColsChange={(yRightCols) => setViz({ yRightCols })}
            onTooltipColsChange={(tooltipCols) => setViz({ tooltipCols })}
            onPivotConfigChange={(pivotConfig) => setViz({ pivotConfig })}
            onGeoConfigChange={(geoConfig) => setViz({ geoConfig })}
            onColumnFormatsChange={(columnFormats) => setViz({ columnFormats })}
            onStyleConfigChange={(styleConfig) => setViz({ styleConfig })}
            onAxisConfigChange={(axisConfig) => setViz({ axisConfig })}
            onAnnotationsChange={(annotations) => setViz({ annotations })}
            onTrendConfigChange={(trendConfig) => setViz({ trendConfig })}
            onSeriesCountChange={setChartSeriesCount}
            onOpenVizTab={() => setQueryMode('viz')}
            onHideVizTab={() => setQueryMode('sql')}
            vizTabOpen={queryMode === 'viz'}
          />
        </div>
      )}
      </div>
      )}
    </div>
  );
}
