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
  Box,
  Text,
  HStack,
} from '@chakra-ui/react';
import {
  LuChevronLeft,
  LuChevronRight,
  LuGripVertical,
  LuRefreshCw,
} from 'react-icons/lu';
import { QuestionContent, QuestionParameter, connectionTypeToDialect, type VisualizationType, type DbFile } from '@/lib/types';
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
import { deriveModelStubs, type ModelStub } from '@/lib/semantic/derive';
import { useSemanticModels } from '@/lib/hooks/use-semantic-models';
import { VizTypeSelector } from '../question/VizTypeSelector';
import { VizConfigPanel } from '../plotx/VizConfigPanel';
import { VizSpecInspector } from '../viz/VizSpecInspector';
import { VegaEncodingPanel } from '../viz/VegaEncodingPanel';
import { TableConditionalFormatPanel } from '../plotx/TableConditionalFormatPanel';
import { useSemanticCompat } from '@/lib/hooks/use-semantic-compat';
import { inferVizType, recommendedVizTypes } from '@/lib/semantic/infer-viz';

// Which side of the split view is collapsed (or neither). Page mode persists this
// globally in Redux (state.ui.questionCollapsedPanel); toolcall mode keeps it local
// to the caller since it has no layout effect there (see callers' comments).
type CollapsedPanel = 'none' | 'left' | 'right';

// ---------------------------------------------------------------------------
// Panel sizing — THE one place to tune the three-column layout. Everything is
// a percentage of the container width; the center (data/plot) column takes
// whatever the other two leave. min/max bound the drag handles.
// ---------------------------------------------------------------------------
const PANEL_LAYOUT = {
  /** Left column: the GUI/SQL query surface. */
  left: { initial: 35, min: 25, max: 65 },
  /** Right column: the viz settings panel. */
  viz: { initial: 20, min: 15, max: 25 },
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
  const [queryMode, setQueryMode] = useState<QueryTab>('sql');
  const [userPickedMode, setUserPickedMode] = useState(false);

  // Semantic tier: one derived model per whitelisted table. Stubs (names only)
  // come from the schema already in the store; full model vocabulary is fetched
  // ON DEMAND for the tables in play — never in bulk (multi-MB on large
  // workspaces). Memoized: stable identities keep the detection effect quiet.
  const semanticStubs = useMemo(() => {
    const db = schemaData?.find((d) => d.databaseName === content.connection_name);
    return db ? deriveModelStubs([db]) : [];
  }, [schemaData, content.connection_name]);
  const [pickedTables, setPickedTables] = useState<string[]>([]);
  const semanticTables = useMemo(() => {
    const tables = [...pickedTables];
    if (content.semanticQuery?.table) tables.push(content.semanticQuery.table);
    return tables;
  }, [pickedTables, content.semanticQuery?.table]);

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

  // Proactive GUI compatibility check: dims the GUI tab (with a tooltip reason) when
  // the query can't be parsed into the builder IR, so it's already disabled when the
  // user opens a question — no surprise on mode switch.
  const { detected: detectedSemanticSpec, canUseSemantic } = useSemanticCompat(
    content.query, dialect,
    { path: filePath || '/org', connectionName: content.connection_name, hasTables: semanticStubs.length > 0 },
  );
  const builderTables = useMemo(
    () => (detectedSemanticSpec?.table ? [...semanticTables, detectedSemanticSpec.table] : semanticTables),
    [semanticTables, detectedSemanticSpec?.table],
  );
  const { models: semanticModels } = useSemanticModels(
    filePath || '/org', content.connection_name, builderTables,
  );
  const showSemanticTab = semanticStubs.length > 0;

  // Use compact layout when container is narrow (< 700px) - stacked vertical layout
  const useCompactLayout = (containerWidth > 0 && containerWidth < 700) || !fullMode;

  // The wide layout is THREE columns: query surface (GUI/SQL) | data/plot |
  // viz panel. The Viz tab therefore leaves the mode selector and becomes the
  // right-hand VizPanel column; compact (stacked) keeps the Viz tab since
  // there is no room for a third column.
  const showVizPanel = !useCompactLayout && showVizControls;
  const [vizPanelOpen, setVizPanelOpen] = useState(true);
  // Viz panel resize state (percentage, like the left panel; see PANEL_LAYOUT)
  const [vizPanelWidth, setVizPanelWidth] = useState<number>(PANEL_LAYOUT.viz.initial);
  const [isVizResizing, setIsVizResizing] = useState(false);
  const vizResizeStartX = useRef<number>(0);
  const vizResizeStartWidth = useRef<number>(PANEL_LAYOUT.viz.initial);
  const vizRafRef = useRef<number | null>(null);

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

  // Viz panel resize (mirrors the left handle; drag left = wider panel)
  const handleVizResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsVizResizing(true);
    vizResizeStartX.current = e.clientX;
    vizResizeStartWidth.current = vizPanelWidth;
  }, [vizPanelWidth]);

  useEffect(() => {
    if (!isVizResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (vizRafRef.current) cancelAnimationFrame(vizRafRef.current);
      vizRafRef.current = requestAnimationFrame(() => {
        if (!mainContentRef.current) return;
        const containerRect = mainContentRef.current.getBoundingClientRect();
        const deltaPercent = ((vizResizeStartX.current - e.clientX) / containerRect.width) * 100;
        setVizPanelWidth(Math.max(PANEL_LAYOUT.viz.min, Math.min(PANEL_LAYOUT.viz.max, vizResizeStartWidth.current + deltaPercent)));
      });
    };
    const handleMouseUp = () => {
      if (vizRafRef.current) {
        cancelAnimationFrame(vizRafRef.current);
        vizRafRef.current = null;
      }
      setIsVizResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (vizRafRef.current) cancelAnimationFrame(vizRafRef.current);
    };
  }, [isVizResizing]);

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

  const handleVizTypeChange = (type: VisualizationType) => {
    onChange({ vizSettings: { ...content.vizSettings, type, typeLocked: true } });
  };

  // The Auto badge: locked → unlock and immediately re-infer from the spec;
  // already auto → lock the current type (freeze what you see).
  const handleToggleAutoType = () => {
    if (vizTypeLocked) {
      onChange({
        vizSettings: {
          ...content.vizSettings,
          typeLocked: false,
          ...(semanticSpec ? { type: inferVizType(semanticSpec) } : {}),
        },
      });
    } else {
      onChange({ vizSettings: { ...content.vizSettings, typeLocked: true } });
    }
  };

  // Handle chart axis change
  const handleAxisChange = (xCols: string[], yCols: string[]) => {
    onChange({
      vizSettings: {
        ...content.vizSettings,
        xCols,
        yCols
      }
    });
  };

  const handleYRightColsChange = (yRightCols: string[]) => {
    onChange({
      vizSettings: {
        ...content.vizSettings,
        yRightCols,
      }
    });
  };

  const handleTooltipColsChange = (tooltipCols: string[]) => {
    onChange({
      vizSettings: {
        ...content.vizSettings,
        tooltipCols,
      }
    });
  };

  // Handle pivot config change
  const handlePivotConfigChange = (pivotConfig: import('@/lib/types').PivotConfig) => {
    onChange({ vizSettings: { ...content.vizSettings, pivotConfig } });
  };

  // Handle geo config change
  const handleGeoConfigChange = (geoConfig: import('@/lib/types').GeoConfig) => {
    onChange({ vizSettings: { ...content.vizSettings, geoConfig } });
  };

  // Handle column formats change
  const handleColumnFormatsChange = (columnFormats: Record<string, import('@/lib/types').ColumnFormatConfig>) => {
    onChange({ vizSettings: { ...content.vizSettings, columnFormats } });
  };

  // Handle conditional formatting rule changes (table viz)
  const handleConditionalFormatsChange = (conditionalFormats: import('@/lib/types').ConditionalFormatRule[]) => {
    onChange({ vizSettings: { ...content.vizSettings, conditionalFormats } });
  };

  // Handle shared visual style changes
  const handleStyleConfigChange = (styleConfig: import('@/lib/types').VisualizationStyleConfig) => {
    onChange({ vizSettings: { ...content.vizSettings, styleConfig } });
  };

  const handleAnnotationsChange = (annotations: import('@/lib/types').ChartAnnotation[]) => {
    onChange({ vizSettings: { ...content.vizSettings, annotations } });
  };

  const handleTrendConfigChange = (trendConfig: import('@/lib/types').TrendConfig) => {
    onChange({ vizSettings: { ...content.vizSettings, trendConfig } });
  };

  // Handle axis config change (scale type)
  const handleAxisConfigChange = (axisConfig: import('@/lib/types').AxisConfig) => {
    onChange({ vizSettings: { ...content.vizSettings, axisConfig } });
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
    <HStack
      as="button"
      aria-label="Toggle auto chart type"
      onClick={handleToggleAutoType}
      gap={1} px={2} py={0.5}
      borderRadius="md" border="1px solid"
      borderColor={vizTypeLocked ? 'border.muted' : 'accent.teal'}
      bg={vizTypeLocked ? 'transparent' : 'accent.teal/10'}
      color={vizTypeLocked ? 'fg.subtle' : 'accent.teal'}
      cursor="pointer"
      _hover={{ bg: vizTypeLocked ? 'bg.muted' : 'accent.teal/15' }}
      title={vizTypeLocked
        ? 'Chart type is pinned to your pick. Click to let exploration choose it again.'
        : 'Chart type follows your selection automatically. Click to pin the current type.'}
    >
      <LuRefreshCw size={10} />
      <Text fontSize="2xs" fontFamily="mono" fontWeight="600">Auto</Text>
    </HStack>
  ) : undefined;

  const vizConfigBody = queryData ? (
    <Box px={3} py={2} display="flex" flexDirection="column" gap={0}>
      <VizTypeSelector
        value={content.vizSettings?.type || 'table'}
        onChange={handleVizTypeChange}
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
    </Box>
  ) : (
    <Box px={3} py={4}>
      <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
        Run the query to configure the viz.
      </Text>
    </Box>
  );

  return (
    <Box
      display="flex"
      flexDirection="column"
      overflow="hidden"
      flex="1"
      minH="0"
      data-file-id={questionId}
    >
      {/* Main Content */}
      <Box ref={mainContentRef} flex={1} overflow="hidden" minHeight="0">
        {/* Visual View (the Code view is rendered upstream by FileView) */}
        {(
        <Box
          display="flex"
          flexDirection={!useCompactLayout ? 'row' : 'column'}
          alignItems={!useCompactLayout ? 'stretch' : undefined}
          gap={2}
          h="100%"
          flex={1}
          overflow="hidden"
          minHeight="0"
        >

          {/* Collapsed Left Panel Strip */}
          {!useCompactLayout && collapsedPanel === 'left' && (
            <Box
              bg="accent.teal/30"
              border="1px solid"
              borderColor="accent.teal"
              width="36px"
              flexShrink={0}
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              cursor="pointer"
              onClick={() => toggleCollapsedPanel('none')}
              aria-label="Expand query panel"
              role="button"
              _hover={{ bg: 'accent.teal/50' }}
              my={2}
              borderRadius="lg"
              gap={2}
            >
              <Text
                fontSize="xs"
                color="fg.default"
                fontWeight="600"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
              >
                Query
              </Text>
              <Box color="fg.default"><LuChevronRight size={14} /></Box>
            </Box>
          )}

          {/* Left Panel: SQL Editor + Parameters */}
          <Box
            display={collapsedPanel === 'left' && !useCompactLayout ? 'none' : 'flex'}
            flexDirection="column"
            flexShrink={0}
            flex={!useCompactLayout && collapsedPanel === 'right' ? 1 : undefined}
            width={!useCompactLayout ? (collapsedPanel === 'none' ? `calc(${leftPanelWidth}% - 8px)` : undefined) : '100%'}
            minWidth={!useCompactLayout && collapsedPanel === 'none' ? '300px' : undefined}
            position="relative"
            borderRadius={!useCompactLayout ? 'lg' : undefined}
            border={!useCompactLayout ? '1px solid' : undefined}
            borderColor={!useCompactLayout ? 'border.muted' : undefined}
            bg={!useCompactLayout ? 'bg.canvas' : undefined}
            overflow="hidden"
            my={!useCompactLayout ? 2 : 0}
            ml={0}
          >
            {/* SQL Editor Section */}
            <Box
              borderColor="border.muted"
              flex={!useCompactLayout ? 1 : undefined}
              display="flex"
              flexDirection="column"
              minHeight={0}
              overflow="hidden"
            >
            {<Box flexShrink={0}>
              {/* Tab selector + DB selector row */}
              <HStack px={3} py={2} gap={2} align="center">
                <Box flex={1} minWidth={0}>
                  <QueryModeSelector
                    mode={effectiveQueryMode}
                    onModeChange={(m: QueryTab) => { setUserPickedMode(true); setQueryMode(m); }}
                    showSemanticTab={showSemanticTab}
                    canUseSemantic={canUseSemantic}
                    showVizTab={showVizControls && useCompactLayout}
                    canUseViz={!!queryData}
                  />
                </Box>
                <Box flexShrink={0}>
                  <DatabaseSelector
                    value={content.connection_name || ''}
                    onChange={handleDatabaseChange}
                  />
                </Box>
              </HStack>

            </Box>}

              <Box flex={1} minHeight={0} display="flex" flexDirection="column" overflow="hidden">
                {/* SQL Mode: Monaco Editor */}
                {effectiveQueryMode === 'sql' && (
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
                {effectiveQueryMode === 'semantic' && showSemanticTab && (
                  <Box flex={1} overflow="hidden" display="flex" flexDirection="column" minHeight={0}>
                    <SemanticExplorer
                      models={semanticModels}
                      stubs={semanticStubs}
                      onSelectModel={(stub: ModelStub) => setPickedTables((prev) => prev.includes(stub.table) ? prev : [...prev, stub.table])}
                      dialect={dialect}
                      path={filePath || '/org'}
                      connectionName={content.connection_name}
                      value={detectedSemanticSpec ?? content.semanticQuery}
                      onChange={(spec, sql, viz) => {
                        onChange({
                          semanticQuery: spec,
                          query: sql,
                          vizSettings: {
                            ...content.vizSettings,
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
                  </Box>
                )}

                {/* Viz Mode (V2 envelope): drop-zone lens (surgical channel edits) + spec inspector */}
                {queryMode === 'viz' && content.viz != null && (
                  <Box flex={1} overflow="auto" px={3} py={2} display="flex" flexDirection="column" gap={0}>
                    {queryData && (
                      <VegaEncodingPanel
                        envelope={content.viz}
                        columns={queryData.columns}
                        types={queryData.types}
                        onVizChange={(viz) => onChange({ viz })}
                      />
                    )}
                    <VizSpecInspector envelope={content.viz} />
                  </Box>
                )}

                {/* Viz Mode (compact layout only): the same config block the
                    wide layout shows in the right-hand VizPanel column (which
                    carries the Auto badge in its header — here it sits on top) */}
                {effectiveQueryMode === 'viz' && content.viz == null && (
                  <Box flex={1} overflow="auto">
                    {autoTypeBadge && (
                      <HStack justify="flex-end" px={3} pt={2}>
                        {autoTypeBadge}
                      </HStack>
                    )}
                    {vizConfigBody}
                  </Box>
                )}
              </Box>
          </Box>
          </Box>
          {/* End Left Panel */}

          {/* Resize Handle - Only in side-by-side mode */}
          {!useCompactLayout && collapsedPanel === 'none' && (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="8px"
              cursor="col-resize"
              onMouseDown={handleResizeStart}
              userSelect="none"
              flexShrink={0}
              position="relative"
              role="group"
            >
              {/* Vertical line */}
              <Box
                position="absolute"
                top="0"
                bottom="0"
                width="2px"
                bg={isResizing ? 'accent.teal' : 'border.muted'}
                _groupHover={{ bg: 'accent.teal' }}
                transition="all 0.15s ease"
                borderRadius="full"
              />
              {/* Center grip indicator with collapse arrows */}
              <Box
                position="absolute"
                top="50%"
                transform="translateY(-50%)"
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                width="20px"
                height="72px"
                bg={isResizing ? 'accent.teal' : 'bg.emphasized'}
                _groupHover={{ bg: 'accent.teal' }}
                borderRadius="md"
                transition="all 0.15s ease"
                boxShadow="sm"
                gap={0}
              >
                <Box
                  cursor="pointer"
                  p={1}
                  borderRadius="sm"
                  onClick={() => toggleCollapsedPanel('left')}
                  onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
                  aria-label="Collapse query panel"
                  role="button"
                  _hover={{ opacity: 0.7 }}
                >
                  <Box
                    as={LuChevronLeft}
                    fontSize="xs"
                    color={isResizing ? 'white' : 'fg.muted'}
                    _groupHover={{ color: 'white' }}
                  />
                </Box>
                <Box
                  as={LuGripVertical}
                  fontSize="sm"
                  color={isResizing ? 'white' : 'fg.muted'}
                  _groupHover={{ color: 'white' }}
                  transition="color 0.15s ease"
                />
                <Box
                  cursor="pointer"
                  p={1}
                  borderRadius="sm"
                  onClick={() => toggleCollapsedPanel('right')}
                  onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
                  aria-label="Collapse results panel"
                  role="button"
                  _hover={{ opacity: 0.7 }}
                >
                  <Box
                    as={LuChevronRight}
                    fontSize="xs"
                    color={isResizing ? 'white' : 'fg.muted'}
                    _groupHover={{ color: 'white' }}
                  />
                </Box>
              </Box>
            </Box>
          )}

          {/* Collapsed Right Panel Strip */}
          {!useCompactLayout && collapsedPanel === 'right' && (
            <Box
              bg="accent.teal/30"
              border="1px solid"
              borderColor="accent.teal"
              width="36px"
              flexShrink={0}
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              cursor="pointer"
              onClick={() => toggleCollapsedPanel('none')}
              aria-label="Expand results panel"
              role="button"
              _hover={{ bg: 'accent.teal/50' }}
              my={2}
              borderRadius="lg"
              gap={2}
            >
              <Box color="fg.default"><LuChevronLeft size={14} /></Box>
              <Text
                fontSize="xs"
                color="fg.default"
                fontWeight="600"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
              >
                Results
              </Text>
            </Box>
          )}

          {/* Right Panel: Results Section */}
          <Box
            ref={resultsContainerRef}
            flex={1}
            display={collapsedPanel === 'right' && !useCompactLayout ? 'none' : 'flex'}
            flexDirection="column"
            minHeight="0"
            overflow="hidden"
            // my={!useCompactLayout ? 2 : 0}
            mr={0}
          >
            {parameters.length > 0 && (
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
            {!content.query?.trim() && !queryData ? (
              /* Empty state when no query written yet */
              <Box flex="1" display="flex" bg="bg.canvas" borderRadius="lg" overflow="hidden">
                <QuestionEmptyState />
              </Box>
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
          </Box>
          {/* End Center Panel */}

          {/* Viz Panel Resize Handle — mirrors the left handle */}
          {showVizPanel && vizPanelOpen && (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="8px"
              cursor="col-resize"
              onMouseDown={handleVizResizeStart}
              userSelect="none"
              flexShrink={0}
              position="relative"
              role="group"
            >
              <Box
                position="absolute"
                top="0"
                bottom="0"
                width="2px"
                bg={isVizResizing ? 'accent.teal' : 'border.muted'}
                _groupHover={{ bg: 'accent.teal' }}
                transition="all 0.15s ease"
                borderRadius="full"
              />
              <Box
                position="absolute"
                top="50%"
                transform="translateY(-50%)"
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                width="20px"
                height="72px"
                bg={isVizResizing ? 'accent.teal' : 'bg.emphasized'}
                _groupHover={{ bg: 'accent.teal' }}
                borderRadius="md"
                transition="all 0.15s ease"
                boxShadow="sm"
                gap={0}
              >
                <Box
                  cursor="pointer"
                  p={1}
                  borderRadius="sm"
                  onClick={() => toggleCollapsedPanel('right')}
                  onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
                  aria-label="Collapse data panel"
                  role="button"
                  _hover={{ opacity: 0.7 }}
                >
                  <Box
                    as={LuChevronLeft}
                    fontSize="xs"
                    color={isVizResizing ? 'white' : 'fg.muted'}
                    _groupHover={{ color: 'white' }}
                  />
                </Box>
                <Box
                  as={LuGripVertical}
                  fontSize="sm"
                  color={isVizResizing ? 'white' : 'fg.muted'}
                  _groupHover={{ color: 'white' }}
                  transition="color 0.15s ease"
                />
                <Box
                  cursor="pointer"
                  p={1}
                  borderRadius="sm"
                  onClick={() => setVizPanelOpen(false)}
                  onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
                  aria-label="Collapse viz panel"
                  role="button"
                  _hover={{ opacity: 0.7 }}
                >
                  <Box
                    as={LuChevronRight}
                    fontSize="xs"
                    color={isVizResizing ? 'white' : 'fg.muted'}
                    _groupHover={{ color: 'white' }}
                  />
                </Box>
              </Box>
            </Box>
          )}

          {/* Right Column: the viz panel — chart config for ALL questions */}
          {showVizPanel && vizPanelOpen && (
            <Box
              width={`calc(${vizPanelWidth}% - 8px)`}
              flexShrink={0}
              my={2}
              mr={2}
              borderRadius="lg"
              border="1px solid"
              borderColor="border.muted"
              bg="bg.canvas"
              overflow="hidden"
            >
              <VizPanel headerExtra={autoTypeBadge}>
                {vizConfigBody}
              </VizPanel>
            </Box>
          )}

          {/* Collapsed Viz Panel Strip */}
          {showVizPanel && !vizPanelOpen && (
            <Box
              bg="accent.teal/30"
              border="1px solid"
              borderColor="accent.teal"
              width="36px"
              flexShrink={0}
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              cursor="pointer"
              onClick={() => setVizPanelOpen(true)}
              aria-label="Expand viz panel"
              role="button"
              _hover={{ bg: 'accent.teal/50' }}
              my={2}
              mr={2}
              borderRadius="lg"
              gap={2}
            >
              <Box color="fg.default"><LuChevronLeft size={14} /></Box>
              <Text
                fontSize="xs"
                color="fg.default"
                fontWeight="600"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
              >
                Viz Settings
              </Text>
            </Box>
          )}
        </Box>
        )}
      </Box>
    </Box>
  );
}
