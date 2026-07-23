'use client';

/**
 * QuestionViewV2 - Phase 3 Implementation
 * Props-based view with explicit execute pattern
 *
 * Key differences from QuestionView:
 * - Explicit "Execute" button separate from editing
 * - Shows old results while editing query
 * - Query results come from useQueryResult hook (via container)
 * - Stale data indication with refetch badge
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { debounce } from 'lodash';
import {
  LuChevronLeft,
  LuChevronRight,
  LuGripVertical,
  LuRefreshCw,
  LuTable2,
} from 'react-icons/lu';
import { QuestionContent, QuestionParameter, connectionTypeToDialect, type VisualizationType, type VizSettings, type DbFile } from '@/lib/types';
import SqlEditor from '../query-builder/SqlEditor';
import ParameterRow from '../params/ParameterRow';
import DatabaseSelector from '../selectors/DatabaseSelector';
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import { useContext as useSchemaContext } from '@/lib/hooks/useContext';
import { useConnections } from '@/lib/hooks/useConnections';
import { QuestionVisualization } from '../question/QuestionVisualization';
import { QuestionEmptyState } from '@/components/views/shared/empty-states';
import type { FileId, FileState } from '@/store/filesSlice';
import { QueryModeSelector, SemanticExplorer, type QueryTab } from '../query-builder';
import { VizPanel } from '../question/VizPanel';
import { useSemanticModels } from '@/lib/hooks/use-semantic-models';
import { VizTypeSelector, isClassicVizType } from '../question/VizTypeSelector';
import { VizConfigPanel } from '../plotx/VizConfigPanel';
import { VegaVizPanel } from '../viz/VegaVizPanel';
import { vizSettingsToEnvelope } from '@/lib/viz/from-vizsettings';
import { toVizColumns } from '@/lib/viz/query-data';
import { TableConditionalFormatPanel } from '../plotx/TableConditionalFormatPanel';
import { useSemanticCompat } from '@/lib/hooks/use-semantic-compat';
import { inferVizType, recommendedVizTypes } from '@/lib/semantic/infer-viz';
import SpreadsheetSourceEditor from '@/components/spreadsheet/SpreadsheetSourceEditor';
import { QUESTION_SPREADSHEET_LIMITS } from '@/lib/spreadsheet/materialize';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import { cn } from '@/components/kit/cn';

// Which side of the split view is collapsed (or neither). Page mode persists this
// globally in Redux (state.ui.questionCollapsedPanel); toolcall mode keeps it local
// to the caller since it has no layout effect there (see callers' comments).
type CollapsedPanel = 'none' | 'left' | 'right';

// ---------------------------------------------------------------------------
// Panel sizing — THE one place to tune the three-column layout. The left
// (query) column is a resizable percentage of the container width; the center
// (data/plot) column takes whatever is left. The right (viz settings) column
// is a FIXED pixel width — there's no use case for dragging it, and a fixed
// width keeps the icon grid / config controls legible instead of squeezed.
// ---------------------------------------------------------------------------
const PANEL_LAYOUT = {
  /** Left column: the GUI/SQL query surface (resizable). min/max bound the drag handle. */
  left: { initial: 35, min: 25, max: 65 },
  /** Right column: the viz settings panel — fixed pixel width, not draggable. */
  viz: { width: 320 },
} as const;

/**
 * Props for QuestionViewV2
 */
interface QuestionViewV2Props {
  viewMode: 'page' | 'toolcall';   // Full view or compact view (for toolcall)
  // Content (merged: content + persistableChanges + ephemeralChanges)
  content: QuestionContent;
  filePath?: string;               // File path for context lookup (schema autocomplete)
  questionId?: number;             // Question ID

  // Query result (from useQueryResult hook in container)
  queryData: any | null;           // Query result data (columns + rows)
  queryLoading: boolean;           // Currently fetching
  queryError: string | null;       // Query execution error
  queryStale: boolean;             // Data exists but is being refetched

  // Content-only state/handlers (header state lives in FileHeader via Redux)
  proposedQuery?: string;          // Proposed query for diff view (from pending confirmation)

  // Parameter state
  lastSubmittedParamValues?: Record<string, any>;

  // Original (saved) query for diff display in preview mode
  originalQuery?: string;

  // Container mode: 'preview' forces read-only with SQL diff
  mode?: 'view' | 'create' | 'preview';

  // If true, all editing is disabled (role-based permission)
  readOnly?: boolean;

  // Hide viz type buttons and viz settings toggle (chart still renders)
  showVizControls?: boolean;

  // Estimated query duration from analytics history (shown during loading)
  queryEstimatedDurationMs?: number | null;

  // --- Formerly-internal Redux state, now supplied by the caller (Container/View
  // convention — see CLAUDE.md "Component Patterns"). Page-mode containers
  // (QuestionContainerV2, CreateQuestionModalContainer) source these from Redux;
  // toolcall callers (InlineChart, ExecuteQueryDisplay) supply local/no-op values. ---

  // Raw file-edit-mode flag (sourced from selectFileEditMode by page containers).
  // The view derives the *effective* edit mode below via isPreview/readOnly.
  editMode?: boolean;

  // Split-panel collapse state + toggle.
  collapsedPanel: CollapsedPanel;
  onTogglePanel: (panel: CollapsedPanel) => void;

  // Referenced-question lookup (mirrors state.files.files) + setter used to persist
  // a freshly-fetched referenced question back into Redux.
  fileState: Record<FileId, FileState>;
  onSetFile: (file: DbFile) => void;

  // Handlers
  onChange: (updates: Partial<QuestionContent>) => void;
  onParameterValueChange?: (paramName: string, value: string | number | null) => void;  // Ephemeral
  onExecute: (overrideParamValues?: Record<string, any>) => void;  // Phase 3: Explicit execute

  /** Viz V2 format flag (uiSlice `vizV2`, passed down — views are Redux-free).
   * Off (V1): classic config panel for every question (saved envelopes ignored).
   * On (V2): the V2 Vega panel edits the saved `viz` envelope, or a legacy
   * chart's JIT-converted one — the first edit writes a real `viz` onto the
   * content (the file upgrades on Save). Semantic questions keep the classic
   * panel (type inference owns vizSettings). */
  vizV2Enabled?: boolean;
}

export default function QuestionViewV2({
  viewMode='page',
  content,
  filePath,
  questionId,
  queryData,
  queryLoading,
  queryError,
  queryStale,
  lastSubmittedParamValues,
  proposedQuery,
  originalQuery,
  mode = 'view',
  readOnly = false,
  showVizControls = true,
  queryEstimatedDurationMs,
  editMode: editModeProp = false,
  collapsedPanel,
  onTogglePanel,
  fileState,
  onSetFile,
  onChange,
  onParameterValueChange,
  onExecute,
  vizV2Enabled = true, // matches the product default (uiSlice vizV2); containers pass the live value
}: QuestionViewV2Props) {
  const fullMode = viewMode === 'page';
  const isPreview = mode === 'preview';

  // Get schema data for SQL autocomplete and GUI mode table filtering
  const { databases: schemaData, hasContext } = useSchemaContext(filePath || '/org');
  const whitelistedSchema = hasContext
    ? schemaData?.find(db => db.databaseName === content.connection_name)?.schemas
    : undefined;
  const { connections } = useConnections();
  const connectionType = content.connection_name ? connections[content.connection_name]?.metadata?.type : undefined;
  const dialect = connectionTypeToDialect(connectionType ?? '');
  // Query mode state (Semantic, SQL, or Viz). Declared before source callbacks
  // because an empty source can switch between query and spreadsheet freely.
  const [queryMode, setQueryMode] = useState<QueryTab>('sql');
  const [userPickedMode, setUserPickedMode] = useState(false);
  type SourceFamily = 'query' | 'spreadsheet';
  const spreadsheetHasData = !!content.spreadsheet
    && (content.spreadsheet.columns.length > 0 || content.spreadsheet.rows.length > 0);
  const queryHasData = !!content.query?.trim();
  const [sourceFamily, setSourceFamily] = useState<SourceFamily>(() =>
    content.spreadsheet ? 'spreadsheet' : 'query',
  );
  const effectiveSourceFamily: SourceFamily = spreadsheetHasData
    ? 'spreadsheet'
    : queryHasData ? 'query' : sourceFamily;
  // GUI/SQL run against the live warehouse connection; spreadsheet is throwaway
  // scratch data saved inside the question. The toolbar leans on these to make
  // that live-vs-scratch split unmistakable.
  const queryActive = effectiveSourceFamily === 'query';
  const spreadsheetActive = effectiveSourceFamily === 'spreadsheet';

  const activateSpreadsheet = useCallback(() => {
    if (queryHasData) return;
    setSourceFamily('spreadsheet');
    setUserPickedMode(false);
    setQueryMode('sql');
    if (!content.spreadsheet) onChange({ spreadsheet: { version: 1, columns: [], rows: [] } });
  }, [content.spreadsheet, onChange, queryHasData]);

  const activateQuery = useCallback(() => {
    if (spreadsheetHasData) return;
    setSourceFamily('query');
    if (content.spreadsheet) onChange({ spreadsheet: null });
  }, [content.spreadsheet, onChange, spreadsheetHasData]);

  // editMode: managed by FileHeader in Redux, supplied as a prop (see Props doc above).
  // The JSON/XML "Code view" is rendered centrally by FileView, so this view only
  // renders the visual surface.
  const editMode = (isPreview || readOnly) ? false : editModeProp;
  const [containerWidth, setContainerWidth] = useState(0);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Resizable panel state (percentages; see PANEL_LAYOUT for the defaults)
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(PANEL_LAYOUT.left.initial);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(PANEL_LAYOUT.left.initial);
  const rafRef = useRef<number | null>(null);
  // Live geo map view getter — populated by the map (ChartBuilder/GeoPlot) when it
  // mounts, read by the VizConfigPanel "Pin current view" button (a sibling of the map).
  const getMapViewRef = useRef<(() => { center: [number, number]; zoom: number } | null) | null>(null);
  const handleMapReady = useCallback((getView: () => { center: [number, number]; zoom: number } | null) => {
    getMapViewRef.current = getView;
  }, []);
  const getMapView = useCallback(() => getMapViewRef.current?.() ?? null, []);
  // Rendered series count, reported by the chart (which has the rows) and handed
  // to the sibling VizConfigPanel so its color swatches match the chart exactly
  // for split-by charts — without the panel re-aggregating the rows.
  const [chartSeriesCount, setChartSeriesCount] = useState<number | undefined>(undefined);
  const toggleCollapsedPanel = onTogglePanel;

  // Query mode state (Semantic, SQL, or Viz). The Semantic tab is the default
  // whenever the current SQL reliably detects as a semantic query (or a spec
  // was persisted); SQL otherwise. No explicit choice needed on mount — the
  // detection effect below promotes to Semantic exactly once.
  // The envelope the Viz panel edits. V1 mode (flag off): none — the classic
  // panel edits vizSettings and the converter never feeds the editor. V2 mode:
  // the saved `viz`, or — for a vizSettings-only chart — its JIT-converted
  // envelope; the first edit writes a real `viz` via onChange (the file
  // upgrades on Save). Semantic questions keep the classic panel: exploration
  // infers the chart type into vizSettings (typeLocked), which a written
  // envelope would sever; their charts still render V2 through the bridge.
  const effectiveViz = useMemo(() => {
    if (!vizV2Enabled) return null;
    if (content.viz != null) return content.viz;
    if (content.semanticQuery != null) return null;
    const legacyType = content.vizSettings?.type;
    if (!queryData || !legacyType || legacyType === 'table' || legacyType === 'pivot') return null;
    return vizSettingsToEnvelope(content.vizSettings!, toVizColumns(queryData.columns, queryData.types));
  }, [content.viz, content.vizSettings, content.semanticQuery, queryData, vizV2Enabled]);


  // Track container width for responsive layout
  useEffect(() => {
    if (!mainContentRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(mainContentRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // The semantic vocabulary: every AUTHORED model visible at this file's path
  // on its connection (Semantic_Model_v2.md §2.7 M5 — models are authored, not
  // derived from the schema, so this is a human-sized set fetched unscoped).
  // It's both the explorer's picker list and the gate: no authored models, no
  // GUI tab (a raw whitelisted table is no longer a reason to offer one).
  const { models: semanticModels } = useSemanticModels(filePath || '/org', content.connection_name);
  const showSemanticTab = semanticModels.length > 0;

  // Proactive GUI compatibility check: dims the GUI tab (with a tooltip reason) when
  // the query can't be parsed into the builder IR, so it's already disabled when the
  // user opens a question — no surprise on mode switch.
  const { detected: detectedSemanticSpec, canUseSemantic } = useSemanticCompat(
    content.query, dialect,
    { path: filePath || '/org', connectionName: content.connection_name, hasTables: showSemanticTab },
  );

  // Use compact layout when container is narrow (< 700px) - stacked vertical layout
  const useCompactLayout = (containerWidth > 0 && containerWidth < 700) || !fullMode;

  // The wide layout is THREE columns: query surface (GUI/SQL) | data/plot |
  // viz panel. The Viz tab therefore leaves the mode selector and becomes the
  // right-hand VizPanel column; compact (stacked) keeps the Viz tab since
  // there is no room for a third column.
  const showVizPanel = !useCompactLayout && showVizControls;
  // The viz column only makes sense once there are results to configure against.
  // Until the query has run (no queryData), hide the whole column — an empty
  // "Run the query to configure the viz." panel is just noise.
  const showVizColumn = showVizPanel && !!queryData;
  const [vizPanelOpen, setVizPanelOpen] = useState(true);

  // Fully derived mode: until the user explicitly picks a tab, Semantic is the
  // resting state whenever the query detects. A Semantic choice that loses its
  // footing (SQL edited into something non-semantic, models removed) falls
  // back to SQL rather than stranding the user on a dead tab. A Viz choice
  // carried over from the compact layout lands on SQL — viz lives in the
  // right-hand panel here.
  const semanticAvailable = showSemanticTab && (canUseSemantic || !!content.semanticQuery);
  const effectiveQueryMode: QueryTab =
    !userPickedMode && queryMode === 'sql' && detectedSemanticSpec ? 'semantic'
      : queryMode === 'semantic' && !semanticAvailable ? 'sql'
      : queryMode === 'viz' && showVizPanel ? 'sql'
      : queryMode;

  // Handle panel resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = leftPanelWidth;
  }, [leftPanelWidth]);

  const handleResizeMove = useCallback((clientX: number) => {
    if (!isResizing || !mainContentRef.current) return;

    // Cancel any pending animation frame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    // Schedule update on next animation frame for smooth 60fps
    rafRef.current = requestAnimationFrame(() => {
      if (!mainContentRef.current) return;
      const containerRect = mainContentRef.current.getBoundingClientRect();
      const deltaX = clientX - resizeStartX.current;
      const deltaPercent = (deltaX / containerRect.width) * 100;
      const newWidth = Math.max(PANEL_LAYOUT.left.min, Math.min(PANEL_LAYOUT.left.max, resizeStartWidth.current + deltaPercent));
      setLeftPanelWidth(newWidth);
    });
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsResizing(false);
  }, []);

  // Mouse event handlers for resize
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => handleResizeMove(e.clientX);
    const handleMouseUp = () => handleResizeEnd();

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Debounce timer ref for param/ref sync
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  // Handle structural parameter changes (type, label, etc.) — persistable
  const handleParametersStructuralChange = (updatedParams: QuestionParameter[]) => {
    onChange({ parameters: updatedParams });
  };

  // Handle parameter value change — persisted into file content (marks file dirty)
  const handleParameterValueChange = (paramName: string, value: string | number | null) => {
    if (onParameterValueChange) {
      onParameterValueChange(paramName, value);
    }
  };

  // Handle parameter submit (when user presses Enter or clicks Run)
  const handleParametersSubmit = (paramValues: Record<string, any>) => {
    onExecute(paramValues);
  };

  // Handle database change
  const handleDatabaseChange = ({ connection_name }: Pick<import('@/lib/types').FullQuery, 'connection_name' | 'dialect'>) => {
    onChange({ connection_name });
  };

  // Handle viz type change
  // A manual type pick LOCKS the chart type: semantic exploration stops
  // auto-switching it. Legacy files without the flag: a saved type outside
  // the old default family (table/bar/line) counts as a deliberate pick.
  const semanticSpec = detectedSemanticSpec ?? content.semanticQuery;
  const vizTypeLocked =
    content.vizSettings?.typeLocked
      ?? !['table', 'bar', 'line'].includes(content.vizSettings?.type ?? 'table');
  const recommendedTypes = useMemo(
    () => (semanticSpec ? recommendedVizTypes(semanticSpec) : undefined),
    [semanticSpec],
  );

  // vizSettings is optional (viz-first files omit it) — classic-panel edits start
  // from a just-in-time table base when it's absent.
  const baseVizSettings = (): VizSettings => content.vizSettings ?? { type: 'table' };

  const handleVizTypeChange = (type: VisualizationType) => {
    onChange({ vizSettings: { ...baseVizSettings(), type, typeLocked: true } });
  };

  // The Auto badge: locked → unlock and immediately re-infer from the spec;
  // already auto → lock the current type (freeze what you see).
  const handleToggleAutoType = () => {
    if (vizTypeLocked) {
      onChange({
        vizSettings: {
          ...baseVizSettings(),
          typeLocked: false,
          ...(semanticSpec ? { type: inferVizType(semanticSpec) } : {}),
        },
      });
    } else {
      onChange({ vizSettings: { ...baseVizSettings(), typeLocked: true } });
    }
  };

  // Handle chart axis change
  const handleAxisChange = (xCols: string[], yCols: string[]) => {
    onChange({
      vizSettings: {
        ...baseVizSettings(),
        xCols,
        yCols
      }
    });
  };

  const handleYRightColsChange = (yRightCols: string[]) => {
    onChange({
      vizSettings: {
        ...baseVizSettings(),
        yRightCols,
      }
    });
  };

  const handleTooltipColsChange = (tooltipCols: string[]) => {
    onChange({
      vizSettings: {
        ...baseVizSettings(),
        tooltipCols,
      }
    });
  };

  // Handle pivot config change
  const handlePivotConfigChange = (pivotConfig: import('@/lib/types').PivotConfig) => {
    onChange({ vizSettings: { ...baseVizSettings(), pivotConfig } });
  };

  // Handle geo config change
  const handleGeoConfigChange = (geoConfig: import('@/lib/types').GeoConfig) => {
    onChange({ vizSettings: { ...baseVizSettings(), geoConfig } });
  };

  // Handle column formats change
  const handleColumnFormatsChange = (columnFormats: Record<string, import('@/lib/types').ColumnFormatConfig>) => {
    onChange({ vizSettings: { ...baseVizSettings(), columnFormats } });
  };

  // Handle conditional formatting rule changes (table viz)
  const handleConditionalFormatsChange = (conditionalFormats: import('@/lib/types').ConditionalFormatRule[]) => {
    onChange({ vizSettings: { ...baseVizSettings(), conditionalFormats } });
  };

  // Handle shared visual style changes
  const handleStyleConfigChange = (styleConfig: import('@/lib/types').VisualizationStyleConfig) => {
    onChange({ vizSettings: { ...baseVizSettings(), styleConfig } });
  };

  const handleAnnotationsChange = (annotations: import('@/lib/types').ChartAnnotation[]) => {
    onChange({ vizSettings: { ...baseVizSettings(), annotations } });
  };

  const handleTrendConfigChange = (trendConfig: import('@/lib/types').TrendConfig) => {
    onChange({ vizSettings: { ...baseVizSettings(), trendConfig } });
  };

  // Handle axis config change (scale type)
  const handleAxisConfigChange = (axisConfig: import('@/lib/types').AxisConfig) => {
    onChange({ vizSettings: { ...baseVizSettings(), axisConfig } });
  };

  const parameters = useMemo(() => content.parameters || [], [content.parameters]);

  // Handle query execution (Run button / Cmd+Enter)
  // Build effective param values dict from content.parameterValues
  const handleExecute = useCallback(() => {
    onExecute(content.parameterValues ?? {});
  }, [onExecute, content.parameterValues]);

  // Semantic auto-run: every shelf edit compiles fresh SQL into content.query;
  // when enabled, that new query executes automatically (debounced) so the
  // chart tracks the exploration with no Run clicks. Keyed on the compiled
  // SQL — the ref remembers the last query already run (seeded with the
  // mount-time query, whose results the container loads anyway).
  const [semanticAutoRun, setSemanticAutoRun] = useState(true);
  const lastAutoRunQuery = useRef<string | undefined>(content.query);
  useEffect(() => {
    if (!semanticAutoRun || effectiveQueryMode !== 'semantic' || isPreview || readOnly) return;
    const query = content.query?.trim();
    if (!query || query === lastAutoRunQuery.current?.trim()) return;
    const timer = setTimeout(() => {
      lastAutoRunQuery.current = content.query;
      handleExecute();
    }, 400);
    return () => clearTimeout(timer);
  }, [content.query, semanticAutoRun, effectiveQueryMode, isPreview, readOnly, handleExecute]);

  const debouncedQueryUpdate = useMemo(
    () => debounce((query: string) => onChange({ query }), 150),
    [onChange]
  );

  // Handle query change with debounced param/ref sync
  const handleQueryChange = useCallback((newQuery: string) => {
    // Typing in the SQL editor IS choosing SQL for this session: detection may
    // still run (tab enablement), but it must never steal the tab mid-edit —
    // auto-promotion to the GUI is only for SQL you OPEN, not SQL you TYPE.
    setUserPickedMode(true);
    debouncedQueryUpdate(newQuery);

    // Debounce the param/ref sync (300ms)
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      // Sync declared parameters with the :params present in the SQL,
      // preserving user-set config for ones that remain.
      const updatedParams = syncParametersWithSQL(newQuery, parameters);
      onChange({ parameters: updatedParams });
    }, 300);
  }, [onChange, parameters]);

  // The full chart config block — rendered in the right-hand VizPanel column
  // (wide layout) or under the Viz tab (compact layout). Assembled here so the
  // handlers stay in one place regardless of where the block is mounted.
  // The Auto chart-type badge — lives in the Viz Settings header (wide
  // layout) or above the config block (compact Viz tab, which has no header).
  const autoTypeBadge = semanticSpec ? (
    <button
      type="button"
      aria-label="Toggle auto chart type"
      onClick={handleToggleAutoType}
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5',
        vizTypeLocked
          ? 'border-border bg-transparent text-muted-foreground hover:bg-muted'
          : 'border-[#16a085] bg-[#16a085]/10 text-[#16a085] hover:bg-[#16a085]/15',
      )}
      title={vizTypeLocked
        ? 'Chart type is pinned to your pick. Click to let exploration choose it again.'
        : 'Chart type follows your selection automatically. Click to pin the current type.'}
    >
      <LuRefreshCw size={10} />
      <span className="font-mono text-[10px] font-semibold">Auto</span>
    </button>
  ) : undefined;

  const vizConfigBody = queryData ? (
    <div className="flex flex-col gap-0 px-3 py-2">
      <VizTypeSelector
        value={content.vizSettings?.type || 'table'}
        onChange={(type) => { if (isClassicVizType(type)) handleVizTypeChange(type) }}
        orientation="grouped"
        recommended={recommendedTypes}
      />
      {content.vizSettings?.type === 'table' && (
        <TableConditionalFormatPanel
          columns={queryData.columns}
          rules={content.vizSettings?.conditionalFormats ?? undefined}
          onChange={handleConditionalFormatsChange}
        />
      )}
      {content.vizSettings?.type && content.vizSettings.type !== 'table' && (
        <VizConfigPanel
          columns={queryData.columns}
          types={queryData.types}
          chartType={content.vizSettings.type}
          initialXCols={content.vizSettings?.xCols ?? undefined}
          initialYCols={content.vizSettings?.yCols ?? undefined}
          initialYRightCols={content.vizSettings?.yRightCols ?? undefined}
          onAxisChange={handleAxisChange}
          onYRightColsChange={handleYRightColsChange}
          initialTooltipCols={content.vizSettings?.tooltipCols ?? undefined}
          onTooltipColsChange={handleTooltipColsChange}
          initialPivotConfig={content.vizSettings?.pivotConfig ?? undefined}
          onPivotConfigChange={handlePivotConfigChange}
          initialGeoConfig={content.vizSettings?.geoConfig ?? undefined}
          onGeoConfigChange={handleGeoConfigChange}
          initialColumnFormats={content.vizSettings?.columnFormats ?? undefined}
          onColumnFormatsChange={handleColumnFormatsChange}
          styleConfig={content.vizSettings?.styleConfig ?? undefined}
          onStyleConfigChange={handleStyleConfigChange}
          axisConfig={content.vizSettings?.axisConfig ?? undefined}
          onAxisConfigChange={handleAxisConfigChange}
          annotations={content.vizSettings?.annotations ?? undefined}
          onAnnotationsChange={handleAnnotationsChange}
          trendConfig={content.vizSettings?.trendConfig ?? undefined}
          onTrendConfigChange={handleTrendConfigChange}
          seriesCount={chartSeriesCount}
          getMapView={getMapView}
        />
      )}
    </div>
  ) : (
    <div className="px-3 py-4">
      <p className="font-mono text-xs text-muted-foreground">
        Run the query to configure the viz.
      </p>
    </div>
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-file-id={questionId}
    >
      {/* Main Content */}
      <div ref={mainContentRef} className="min-h-0 flex-1 overflow-hidden">
        {/* Visual View (the Code view is rendered upstream by FileView) */}
        {(
        <div
          className={cn(
            'flex h-full min-h-0 flex-1 gap-2 overflow-hidden',
            !useCompactLayout ? 'flex-row items-stretch' : 'flex-col',
          )}
        >

          {/* Collapsed Left Panel Strip */}
          {!useCompactLayout && collapsedPanel === 'left' && (
            <div
              className="my-2 flex w-[36px] shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-[#16a085] bg-[#16a085]/30 hover:bg-[#16a085]/50"
              onClick={() => toggleCollapsedPanel('none')}
              aria-label="Expand query panel"
              role="button"
            >
              <span
                className="text-xs font-semibold text-foreground"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
              >
                Query
              </span>
              <span className="text-foreground"><LuChevronRight size={14} /></span>
            </div>
          )}

          {/* Left Panel: SQL Editor + Parameters */}
          <div
            className={cn(
              collapsedPanel === 'left' && !useCompactLayout ? 'hidden' : 'flex',
              'relative ml-0 shrink-0 flex-col overflow-hidden',
              !useCompactLayout && collapsedPanel === 'right' && 'flex-1',
              !useCompactLayout ? 'my-2 rounded-lg border border-border bg-background' : 'my-0 w-full',
              !useCompactLayout && collapsedPanel === 'none' && 'min-w-[300px]',
            )}
            style={!useCompactLayout && collapsedPanel === 'none'
              ? { width: `calc(${leftPanelWidth}% - 8px)` }
              : undefined}
          >
            {/* SQL Editor Section */}
            <div
              className={cn(
                'flex min-h-0 flex-col overflow-hidden',
                !useCompactLayout && 'flex-1',
              )}
            >
            {<div className="shrink-0">
              {/* Query-mode tabs, then the database selector right beside them so
                  the active connection reads as part of the query surface. The DB
                  collapses to an icon+check only when there's a single connection;
                  with several it stays a full labeled dropdown (so you can't miss
                  which one a query runs against). The Spreadsheet toggle hugs the
                  right edge while the query block is present, and drops to the left
                  once that block vanishes (spreadsheet is the active source). */}
              <div className="flex items-center gap-1.5 px-3 py-2">
                {!spreadsheetHasData && (
                  /* LIVE SOURCE GROUP — GUI and SQL are two views of the SAME live
                     warehouse connection. A neutral container binds the tabs, the
                     connection selector, and a blue "LIVE" chip into one unit. The
                     accent is blue (echoing the connection), deliberately NOT the
                     green/teal the active tab already occupies — a green badge beside
                     the green-teal tab reads muddy. The LIVE chip shows only while
                     query is the active family. */
                  <div
                    className={cn(
                      'flex h-[34px] min-w-0 shrink items-center gap-1.5 rounded-lg border bg-muted/40 pl-[3px]',
                      queryActive ? 'pr-1.5' : 'pr-[3px]',
                    )}
                  >
                    <div className="shrink-0">
                      <QueryModeSelector
                        mode={effectiveQueryMode}
                        active={queryActive}
                        onModeChange={(m: QueryTab) => { activateQuery(); setUserPickedMode(true); setQueryMode(m); }}
                        showSemanticTab={showSemanticTab}
                        canUseSemantic={canUseSemantic}
                        showVizTab={showVizControls && useCompactLayout}
                        canUseViz={!!queryData}
                      />
                    </div>
                    {/* The connection only matters for GUI/SQL. Hide it when the
                        spreadsheet is the active surface — local data touches no
                        connection, so showing one here would be misleading. */}
                    {queryActive && (
                      <div className="min-w-0 shrink">
                        <DatabaseSelector
                          value={content.connection_name || ''}
                          onChange={handleDatabaseChange}
                          compact
                        />
                      </div>
                    )}
                    {queryActive && (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="flex shrink-0 cursor-default items-center gap-1 rounded-full border border-[#2980b9]/25 bg-[#2980b9]/10 px-1.5 py-0.5"
                              aria-label="Live connection"
                            >
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2980b9]" />
                              <span className="font-mono text-[10px] font-bold tracking-[0.04em] text-[#2980b9]">LIVE</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top">GUI &amp; SQL run live against this connection — results reflect current warehouse data</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                )}
                {/* Spacer only while the query block is shown — pushes the
                    spreadsheet toggle to the right; absent, it sits on the left. */}
                {!spreadsheetHasData && <div className="min-w-0 flex-1" />}
                {!queryHasData && (
                  /* SCRATCH SOURCE — same height and solid border as the live group so
                     the two sit as clean peers. Its "not live" meaning is carried by the
                     persistent "Scratch" label and the grey LOCAL chip once active — not
                     by a dashed border, which reads as unfinished next to the live group.
                     Fills solid teal when it's the active surface. */
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          role="group"
                          className={cn(
                            'flex h-[34px] shrink-0 cursor-pointer items-center gap-0 rounded-lg border px-2.5 transition-all duration-150',
                            spreadsheetActive
                              ? 'border-[#16a085] bg-[#16a085] text-white hover:bg-[#16a085] hover:text-white'
                              : 'border-border bg-muted/40 text-muted-foreground hover:border-foreground/30 hover:bg-muted hover:text-muted-foreground',
                          )}
                          aria-label="Spreadsheet"
                          onClick={activateSpreadsheet}
                        >
                          <span className="flex shrink-0"><LuTable2 size={14} /></span>
                          <span className="whitespace-nowrap pl-1.5 font-mono text-xs font-semibold">
                            {spreadsheetActive ? 'Spreadsheet' : 'Scratch'}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" portalled>Scratch data — type or paste rows. Not a live connection; saved inside this question.</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {/* LOCAL badge — the deliberate counterpart to the LIVE chip. Same
                    shape, but a STILL grey dot (no pulse): the absence of the pulse is
                    itself the "not live" signal. Shown only while the spreadsheet is
                    the active surface. */}
                {spreadsheetActive && (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className="flex shrink-0 cursor-default items-center gap-1 rounded-full border bg-muted px-1.5 py-0.5"
                          aria-label="Local data, not a live connection"
                        >
                          {/* Still dot — deliberately NOT pulsing: a pulse reads as "alive",
                              the opposite of what this badge means. Stillness IS the signal. */}
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                          <span className="font-mono text-[10px] font-bold tracking-[0.04em] text-muted-foreground">LOCAL</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" portalled>Local data — typed or pasted and saved in this question. It doesn&apos;t refresh from a connection.</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>

            </div>}

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* SQL Mode: Monaco Editor */}
                {effectiveSourceFamily === 'query' && effectiveQueryMode === 'sql' && (
                  <SqlEditor
                    readOnly={isPreview || !fullMode || readOnly}
                    value={isPreview ? (originalQuery ?? content.query) : content.query}
                    onChange={handleQueryChange}
                    onRun={handleExecute}
                    showRunButton={!isPreview}
                    showFormatButton={!isPreview}
                    isRunning={queryLoading && !queryData}
                    proposedValue={isPreview
                      ? (originalQuery !== content.query ? content.query : undefined)
                      : proposedQuery}
                    schemaData={schemaData}
                    databaseName={content.connection_name}
                    connectionType={connectionType}
                    fillHeight={!useCompactLayout}
                    editWithAgent={{ fileName: filePath?.split('/').pop() ?? 'query', filePath, questionId }}
                  />
                )}

                {/* Semantic Mode: the click-to-toggle explorer (shelves on top,
                    field columns below). Prefer the spec DETECTED from the
                    live SQL (covers agent-written queries) over the persisted
                    one. Shelf edits imply the viz: axis columns always track
                    the query; the chart TYPE follows the inference only while
                    UNLOCKED — any manual pick (vizSettings.typeLocked) is
                    respected until the Auto badge hands control back. */}
                {effectiveSourceFamily === 'query' && effectiveQueryMode === 'semantic' && showSemanticTab && (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <SemanticExplorer
                      models={semanticModels}
                      dialect={dialect}
                      path={filePath || '/org'}
                      connectionName={content.connection_name}
                      value={detectedSemanticSpec ?? content.semanticQuery}
                      onChange={(spec, sql, viz) => {
                        onChange({
                          semanticQuery: spec,
                          query: sql,
                          vizSettings: {
                            ...baseVizSettings(),
                            ...(vizTypeLocked ? {} : { type: viz.type }),
                            xCols: viz.xCols,
                            yCols: viz.yCols,
                          },
                        });
                      }}
                      onExecute={handleExecute}
                      isExecuting={queryLoading && !queryData}
                      autoRun={semanticAutoRun}
                      onToggleAutoRun={() => setSemanticAutoRun((a) => !a)}
                    />
                  </div>
                )}

                {effectiveSourceFamily === 'spreadsheet' && content.spreadsheet && (
                  <SpreadsheetSourceEditor
                    source={content.spreadsheet}
                    onChange={(spreadsheet) => onChange({ spreadsheet })}
                    onRun={handleExecute}
                    isRunning={queryLoading && !queryData}
                    limits={QUESTION_SPREADSHEET_LIMITS}
                    readOnly={isPreview || !fullMode || readOnly}
                  />
                )}

                {/* Viz Mode (V2 envelope): Fields / Settings / Spec subtabs (surgical spec edits).
                    Legacy CHART questions (vizSettings only, §21 bridge) edit the CONVERTED
                    envelope through the same panel — the first edit writes a real `viz` onto
                    the content, so the file upgrades on Save. Table/pivot keep the V1 panel. */}
                {queryMode === 'viz' && effectiveViz != null && (
                  <div className="flex flex-1 flex-col gap-0 overflow-auto px-3 py-2">
                    <VegaVizPanel
                      envelope={effectiveViz}
                      columns={queryData?.columns ?? []}
                      types={queryData?.types ?? []}
                      rows={queryData?.rows}
                      onVizChange={(viz) => onChange({ viz })}
                    />
                  </div>
                )}

                {/* Viz Mode (compact layout only): the same config block the
                    wide layout shows in the right-hand VizPanel column (which
                    carries the Auto badge in its header — here it sits on top) */}
                {effectiveQueryMode === 'viz' && effectiveViz == null && (
                  <div className="flex-1 overflow-auto">
                    {autoTypeBadge && (
                      <div className="flex items-center justify-end px-3 pt-2">
                        {autoTypeBadge}
                      </div>
                    )}
                    {vizConfigBody}
                  </div>
                )}
              </div>
          </div>
          </div>
          {/* End Left Panel */}

          {/* Resize Handle - Only in side-by-side mode */}
          {!useCompactLayout && collapsedPanel === 'none' && (
            <div
              className="group relative flex w-[8px] shrink-0 cursor-col-resize select-none items-center justify-center"
              onMouseDown={handleResizeStart}
              role="group"
            >
              {/* Vertical line */}
              <div
                className={cn(
                  'absolute inset-y-0 w-[2px] rounded-full transition-all duration-150 group-hover:bg-[#16a085]',
                  isResizing ? 'bg-[#16a085]' : 'bg-border',
                )}
              />
              {/* Center grip indicator with collapse arrows */}
              <div
                className={cn(
                  'absolute top-1/2 flex h-[72px] w-[20px] -translate-y-1/2 flex-col items-center justify-center gap-0 rounded-md shadow-sm transition-all duration-150 group-hover:bg-[#16a085]',
                  isResizing ? 'bg-[#16a085]' : 'bg-muted',
                )}
              >
                <div
                  className="cursor-pointer rounded-sm p-1 hover:opacity-70"
                  onClick={() => toggleCollapsedPanel('left')}
                  onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
                  aria-label="Collapse query panel"
                  role="button"
                >
                  <LuChevronLeft
                    size={12}
                    className={cn(isResizing ? 'text-white' : 'text-muted-foreground group-hover:text-white')}
                  />
                </div>
                <LuGripVertical
                  size={14}
                  className={cn(
                    'transition-colors duration-150',
                    isResizing ? 'text-white' : 'text-muted-foreground group-hover:text-white',
                  )}
                />
                <div
                  className="cursor-pointer rounded-sm p-1 hover:opacity-70"
                  onClick={() => toggleCollapsedPanel('right')}
                  onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
                  aria-label="Collapse results panel"
                  role="button"
                >
                  <LuChevronRight
                    size={12}
                    className={cn(isResizing ? 'text-white' : 'text-muted-foreground group-hover:text-white')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Collapsed Right Panel Strip */}
          {!useCompactLayout && collapsedPanel === 'right' && (
            <div
              className="my-2 flex w-[36px] shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-[#16a085] bg-[#16a085]/30 hover:bg-[#16a085]/50"
              onClick={() => toggleCollapsedPanel('none')}
              aria-label="Expand results panel"
              role="button"
            >
              <span className="text-foreground"><LuChevronLeft size={14} /></span>
              <span
                className="text-xs font-semibold text-foreground"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
              >
                Results
              </span>
            </div>
          )}

          {/* Right Panel: Results Section */}
          <div
            ref={resultsContainerRef}
            className={cn(
              collapsedPanel === 'right' && !useCompactLayout ? 'hidden' : 'flex',
              'mr-0 min-h-0 flex-1 flex-col overflow-hidden',
            )}
          >
            {effectiveSourceFamily !== 'spreadsheet' && parameters.length > 0 && (
              <ParameterRow
                parameters={parameters}
                parameterValues={content.parameterValues ?? undefined}
                lastSubmittedValues={lastSubmittedParamValues}
                onValueChange={handleParameterValueChange}
                onSubmit={handleParametersSubmit}
                onParametersChange={handleParametersStructuralChange}
                database={content.connection_name}
              />
            )}
            {!content.query?.trim() && !content.spreadsheet && !queryData ? (
              /* Empty state when no query written yet */
              <div className="flex flex-1 overflow-hidden rounded-lg bg-background">
                <QuestionEmptyState />
              </div>
            ) : (
              <QuestionVisualization
                currentState={content}
                config={{
                  showHeader: fullMode,
                  showJsonToggle: false,
                  editable: editMode,
                  viz: {
                    showTypeButtons: showVizControls,
                    showChartBuilder: showVizControls,
                    typesButtonsOrientation: 'horizontal',
                    showTitle: viewMode === 'toolcall'
                  },
                  fixError: true
                }}
                loading={queryLoading && !queryData}
                error={queryError}
                data={queryData}
                queryEstimatedDurationMs={queryEstimatedDurationMs}
                onVizTypeChange={handleVizTypeChange}
                onAxisChange={handleAxisChange}
                onYRightColsChange={handleYRightColsChange}
                onTooltipColsChange={handleTooltipColsChange}
                onPivotConfigChange={handlePivotConfigChange}
                onGeoConfigChange={handleGeoConfigChange}
                onColumnFormatsChange={handleColumnFormatsChange}
                onStyleConfigChange={handleStyleConfigChange}
                onAxisConfigChange={handleAxisConfigChange}
                onAnnotationsChange={handleAnnotationsChange}
                onTrendConfigChange={handleTrendConfigChange}
                onMapReady={handleMapReady}
                onSeriesCountChange={setChartSeriesCount}
                onVizChange={(viz) => onChange({ viz })}
                onOpenVizTab={() => {
                  if (showVizPanel) {
                    setVizPanelOpen(true);
                  } else {
                    if (collapsedPanel === 'left') toggleCollapsedPanel('none');
                    setQueryMode('viz');
                  }
                }}
                onHideVizTab={() => {
                  if (showVizPanel) setVizPanelOpen(false);
                  else toggleCollapsedPanel('left');
                }}
                vizTabOpen={showVizPanel ? vizPanelOpen : (queryMode === 'viz' && collapsedPanel !== 'left')}
              />
            )}
          </div>
          {/* End Center Panel */}

          {/* Collapse rail — a slim, NON-draggable divider between the data and
              viz columns, carrying just the collapse chevron centered on the
              border (where the old resize grip sat). No drag: the viz column is
              a fixed width (see PANEL_LAYOUT.viz). */}
          {showVizColumn && vizPanelOpen && (
            <div
              className="group relative flex w-[8px] shrink-0 items-center justify-center"
              role="group"
            >
              {/* Vertical edge line */}
              <div className="absolute inset-y-0 w-[2px] rounded-full bg-border transition-all duration-150 group-hover:bg-[#16a085]" />
              {/* Collapse chevron pill, centered on the edge */}
              <button
                type="button"
                className="absolute top-1/2 flex h-[36px] w-[20px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-md bg-muted text-muted-foreground shadow-sm transition-all duration-150 group-hover:bg-[#16a085] group-hover:text-white"
                aria-label="Collapse viz panel"
                onClick={() => setVizPanelOpen(false)}
              >
                <LuChevronRight size={14} />
              </button>
            </div>
          )}

          {/* Right Column: the viz panel — chart config for ALL questions.
              Fixed pixel width, not draggable (see PANEL_LAYOUT.viz); collapse
              lives on the edge rail's chevron and the panel header's chevron. */}
          {showVizColumn && vizPanelOpen && (
            <div
              className="my-2 mr-2 shrink-0 overflow-hidden rounded-lg border border-border bg-background"
              style={{ width: `${PANEL_LAYOUT.viz.width}px` }}
            >
              <VizPanel headerExtra={autoTypeBadge} onCollapse={() => setVizPanelOpen(false)}>
                {/* The right column follows the vizV2 flag like the compact Viz
                    tab: V2 panel (own type grid + Fields/Settings/Spec) edits
                    the saved or converted envelope; classic config otherwise. */}
                {effectiveViz != null ? (
                  <div className="flex flex-col gap-0 px-3 py-2">
                    <VegaVizPanel
                      envelope={effectiveViz}
                      columns={queryData?.columns ?? []}
                      types={queryData?.types ?? []}
                      rows={queryData?.rows}
                      onVizChange={(viz) => onChange({ viz })}
                    />
                  </div>
                ) : (
                  vizConfigBody
                )}
              </VizPanel>
            </div>
          )}

          {/* Collapsed Viz Panel Strip */}
          {showVizColumn && !vizPanelOpen && (
            <div
              className="my-2 mr-2 flex w-[36px] shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-[#16a085] bg-[#16a085]/30 hover:bg-[#16a085]/50"
              onClick={() => setVizPanelOpen(true)}
              aria-label="Expand viz panel"
              role="button"
            >
              <span className="text-foreground"><LuChevronLeft size={14} /></span>
              <span
                className="text-xs font-semibold text-foreground"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
              >
                Viz Settings
              </span>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
