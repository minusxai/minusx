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
import { Box, Text } from '@chakra-ui/react';
import NotebookCellHeader from './NotebookCellHeader';
import SqlEditor from '@/components/SqlEditor';
import ParameterRow from '@/components/ParameterRow';
import DatabaseSelector from '@/components/DatabaseSelector';
import { QuestionVisualization } from '@/components/question/QuestionVisualization';
import { VizTypeSelector } from '@/components/question/VizTypeSelector';
import { VizConfigPanel } from '@/components/plotx/VizConfigPanel';
import { QueryBuilderRoot, QueryModeSelector, type QueryTab } from '@/components/query-builder';
import { useQueryResult } from '@/lib/hooks/file-state-hooks';
import { useQuestionReferences } from '@/lib/hooks/useQuestionReferences';
import { useConnections } from '@/lib/hooks/useConnections';
import { useContext as useSchemaContext } from '@/lib/hooks/useContext';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { connectionTypeToDialect } from '@/lib/types';
import type {
  NotebookSqlCell as SqlCell, QuestionContent, QuestionReference, VizSettings, FullQuery,
} from '@/lib/types';

interface NotebookSqlCellProps {
  cell: SqlCell;
  active?: boolean;
  onActivate?: (cellId: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Bumped by the header "Run all" command — re-running this cell on change. */
  runNonce?: number;
  readOnly?: boolean;
  /** Present mode: hide all chrome/editor — show just the chart (auto-run). */
  presentMode?: boolean;
  filePath?: string;
  onCellChange: (id: string, partial: Partial<SqlCell>) => void;
  onRemove: (id: string) => void;
}

interface Executed {
  query: string;
  params: Record<string, unknown>;
  database: string;
  references: QuestionReference[];
}

// Stable empty params so present-mode execution doesn't refetch every render.
const EMPTY_PARAMS: Record<string, unknown> = {};

export default function NotebookSqlCell({
  cell, active = false, onActivate, collapsed = false, onToggleCollapse, runNonce = 0,
  readOnly = false, presentMode = false, filePath, onCellChange, onRemove,
}: NotebookSqlCellProps) {
  const handleChange = useCallback(
    (partial: Partial<SqlCell>) => onCellChange(cell.id, partial),
    [onCellChange, cell.id],
  );

  const activate = useCallback(() => {
    if (!active) onActivate?.(cell.id);
  }, [active, onActivate, cell.id]);

  const [executed, setExecuted] = useState<Executed | null>(null);
  // Present mode reuses whatever was already run — it does NOT re-execute.
  const { data, loading, error, refetch } = useQueryResult(
    executed?.query ?? '',
    executed?.params ?? EMPTY_PARAMS,
    executed?.database ?? '',
    executed?.references,
    { skip: !executed },
  );

  const { availableQuestions, resolvedReferences, referencedQuestions, mergedParameters, handleQueryChange } =
    useQuestionReferences(
      {
        query: cell.query,
        references: cell.references ?? [],
        parameters: cell.parameters ?? [],
        connection_name: cell.connection_name,
      },
      (updates) => handleChange(updates as Partial<SqlCell>),
    );

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
  const [canUseGUI, setCanUseGUI] = useState(true);
  const [guiError, setGuiError] = useState<string | null>(null);

  // Proactive GUI-compatibility check: dim the GUI tab when sqlToIR can't parse.
  useEffect(() => {
    let cancelled = false;
    const check = !cell.query?.trim()
      ? Promise.resolve<void>(undefined)
      : CompletionsAPI.sqlToIR({ sql: cell.query, dialect }).then(() => undefined);
    check.then(() => {
      if (cancelled) return;
      setCanUseGUI(true);
      setGuiError(null);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setCanUseGUI(false);
      setGuiError(err instanceof Error ? err.message : 'This query cannot be edited in GUI mode');
    });
    return () => { cancelled = true; };
  }, [cell.query, dialect]);

  const run = useCallback(() => {
    setExecuted({
      query: cell.query,
      params: cell.parameterValues ?? {},
      database: cell.connection_name,
      references: cell.references ?? [],
    });
    // If the same query was already executed, force a fresh fetch.
    refetch();
  }, [cell.query, cell.parameterValues, cell.connection_name, cell.references, refetch]);

  // Header "Run all" command: re-run this cell when the nonce changes.
  const lastRunNonce = useRef(runNonce);
  useEffect(() => {
    if (runNonce === lastRunNonce.current) return;
    lastRunNonce.current = runNonce;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- imperative "Run all" command from the header toolbar
    if (cell.query?.trim()) run();
  }, [runNonce, run, cell.query]);

  const setViz = useCallback(
    (patch: Partial<VizSettings>) => handleChange({ vizSettings: { ...cell.vizSettings, ...patch } }),
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
      <Box>
        {cell.name && <Text fontSize="sm" fontWeight="600" color="fg.muted" mb={2}>{cell.name}</Text>}
        <Box h="420px" display="flex" flexDirection="column">
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
        </Box>
      </Box>
    );
  }

  return (
    <Box
      borderWidth="1px"
      borderColor={active ? 'accent.teal' : 'border.muted'}
      borderRadius="md"
      bg="bg.canvas"
      overflow="hidden"
      transition="border-color 0.15s, box-shadow 0.15s"
      boxShadow={active ? '0 0 0 2px var(--chakra-colors-accent-teal)' : undefined}
      _hover={{ borderColor: active ? 'accent.teal' : 'border.default' }}
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
            canUseGUI={canUseGUI}
            guiError={guiError ?? undefined}
            showVizTab={!!data}
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
      <Box>
      {/* Mode content */}
      {queryMode === 'sql' && (
        <Box minH="120px">
          <SqlEditor
            value={cell.query}
            onChange={handleQueryChange}
            onRun={run}
            readOnly={readOnly}
            showRunButton={!readOnly}
            showFormatButton={!readOnly}
            isRunning={loading && !data}
            availableReferences={availableQuestions}
            validReferenceAliases={referencedQuestions.map(r => r.alias)}
            resolvedReferences={resolvedReferences}
            schemaData={schemaData}
            databaseName={cell.connection_name}
            connectionType={connectionType}
          />
        </Box>
      )}

      {queryMode === 'gui' && (
        <Box p={2} maxH="360px" overflow="auto">
          <QueryBuilderRoot
            databaseName={cell.connection_name || ''}
            dialect={dialect}
            sql={cell.query}
            onSqlChange={handleQueryChange}
            onExecute={run}
            isExecuting={loading && !data}
            availableQuestions={availableQuestions}
            whitelistedSchema={whitelistedSchema}
          />
        </Box>
      )}

      {queryMode === 'viz' && (
        <Box p={3} display="flex" flexDirection="column" gap={2} maxH="420px" overflow="auto">
          <VizTypeSelector value={vizType} onChange={(type) => setViz({ type })} orientation="grouped" />
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
            />
          )}
        </Box>
      )}

      {/* Parameters (current + referenced) */}
      {mergedParameters.length > 0 && (
        <ParameterRow
          parameters={mergedParameters}
          parameterValues={cell.parameterValues ?? undefined}
          lastSubmittedValues={executed?.params}
          onValueChange={(name, value) =>
            handleChange({ parameterValues: { ...(cell.parameterValues ?? {}), [name]: value } })}
          onSubmit={(values) => setExecuted({
            query: cell.query, params: values, database: cell.connection_name, references: cell.references ?? [],
          })}
          onParametersChange={(parameters) => handleChange({ parameters })}
          database={cell.connection_name}
        />
      )}

      {/* Results — only after the cell has been run. Fixed height + minH:0 so
          the inner table/chart bounds to this area and scrolls (TableV2 scrolls
          internally) instead of the cell growing infinitely with the row count. */}
      {executed && (
        <Box h="380px" minH={0} display="flex" flexDirection="column" p={2}>
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
            onOpenVizTab={() => setQueryMode('viz')}
            onHideVizTab={() => setQueryMode('sql')}
            vizTabOpen={queryMode === 'viz'}
          />
        </Box>
      )}
      </Box>
      )}
    </Box>
  );
}
