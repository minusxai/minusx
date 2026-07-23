'use client';

import { DashboardLayoutItem, DocumentContent, InlineAsset, QuestionContent, QuestionParameter, isInlineAsset } from '@/lib/types';
import { getAssetLayoutKey, getLayoutableAssets, getLayoutSignature, computeDashboardLayouts } from './dashboard-assets';
import SmartEmbeddedQuestionContainer from '../containers/SmartEmbeddedQuestionContainer';
import TextBlockCard from '../TextBlockCard';
import ParameterRow from '../params/ParameterRow';
import { WindowedTile } from '@/components/views/dashboard/WindowedTile';
import { useState, useMemo, useCallback, useRef } from 'react';
import { Layout, Responsive } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { useSurfaceWidth } from '@/lib/dashboard-surface/surface-width';
import { MARKER_GUTTER_CSS_PX } from '@/lib/screenshot/draw-markers';
import { DashboardEmptyState } from '@/components/views/shared/empty-states';
import type { FileState } from '@/store/filesSlice';
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import { QuestionBrowserPanel } from '../question/QuestionBrowserPanel';
import { useDashboardPublishHighlights, type PublishHighlight } from '@/lib/context/dashboard-publish-highlights';
import { computeEffectiveSubmittedValues } from '@/lib/dashboard/effective-params';

// Must match the grid's rowHeight / margin props below. Used to translate a text
// block's expanded pixel height into grid rows for "Read more".
const GRID_ROW_HEIGHT = 80;
const GRID_MARGIN = 6;

/** Convert a react-grid-layout string key back to number (questions) or string (inline assets). */
const parseLayoutItemId = (key: string): number | string =>
  /^\d+$/.test(key) ? Number(key) : key;

// NO WidthProvider (Phase 8): its resize-observer-polyfill never fires inside the surface
// iframe (refresh triggers are bound to the top document's realm), so it measured once at mount
// and went deaf — pane toggles left the grid at a stale width, clipped at the pane edge. The
// surface tracks its width authoritatively (SurfaceWidthContext); the grid consumes it directly.
const ResponsiveGridLayout = Responsive;

/** Fallback grid width when no surface provides one (legacy mounts, jsdom) — WidthProvider's old default. */
const FALLBACK_GRID_WIDTH = 1280;

interface DashboardViewProps {
  // Data props (all from Redux via smart component)
  document: DocumentContent;
  folderPath: string;
  fileId: number;  // File ID for Redux operations (used for dispatch payloads via container callbacks)

  // Content change callback (header/save/editMode now live in FileHeader via Redux)
  onChange: (updates: Partial<DocumentContent>) => void;

  // Redux-derived value props — owned by DashboardContainerV2 (this view is pure presentation).
  // editMode already folds in the mode/readOnly override (see DashboardContainerV2).
  editMode: boolean;
  isDirty: boolean;
  paramValues: Record<string, any>;
  lastExecutedParams: Record<string, any>;
  questionContents: (QuestionContent | undefined)[];
  fileState: FileState | undefined;
  dirtyFiles: FileState[];

  // Redux-derived callbacks — dispatch lives in the container.
  onTextBlockContentChange: (textBlockId: string, content: string) => void;
  onQuestionEdit: (questionId: number, dashboardParamValues: Record<string, any>) => void;
  onParamSubmit: (newParamValues: Record<string, any>) => void;
  onAddQuestion: (questionId: number) => void;
  onAddTextBlock: () => void;

  /** Design theme (Renderer_v2 Phase 3): stamps [data-theme] so the six story token sets apply. */
  theme?: string | null;
}

export default function DashboardView({
  document,
  folderPath,
  fileId,
  onChange,
  editMode,
  isDirty,
  paramValues,
  lastExecutedParams,
  questionContents,
  fileState,
  dirtyFiles,
  onTextBlockContentChange,
  onQuestionEdit,
  onParamSubmit,
  onAddQuestion,
  onAddTextBlock,
  theme,
}: DashboardViewProps) {
  // Ref to always have the latest document for callbacks that may fire with stale closures
  const documentRef = useRef(document);
  documentRef.current = document;

  // Track current columns for responsive grid background
  const [currentCols, setCurrentCols] = useState(12);

  // The grid's layout width: the surface's measured width minus BOTH reserved gutters
  // (px-10 on the region below — the grid's containing block is the region's CONTENT box).
  const surfaceWidth = useSurfaceWidth();
  const gridWidth = Math.max(320, (surfaceWidth ?? FALLBACK_GRID_WIDTH) - MARKER_GUTTER_CSS_PX * 2);

  // Text blocks that a viewer has expanded via "Read more" → extra grid rows.
  // View-only (not persisted); restored to null on collapse or entering edit mode.
  const [textBlockRows, setTextBlockRows] = useState<Record<string, number>>({});
  const handleTextBlockResize = useCallback((textBlockId: string, height: number | null) => {
    setTextBlockRows(prev => {
      if (height === null) {
        if (!(textBlockId in prev)) return prev;
        const next = { ...prev };
        delete next[textBlockId];
        return next;
      }
      // Cell pixel height = rows * ROW_HEIGHT + (rows-1) * MARGIN → invert for rows.
      const rows = Math.ceil((height + GRID_MARGIN) / (GRID_ROW_HEIGHT + GRID_MARGIN));
      if (prev[textBlockId] === rows) return prev;
      return { ...prev, [textBlockId]: rows };
    });
  }, []);

  // Force react-grid-layout to remount when file reverts from dirty → clean (discard/save).
  // ResponsiveGridLayout maintains internal layout state that doesn't always sync
  // with the `layouts` prop, so we force a remount via key change. `isDirty` is a prop
  // (selectIsDirty lives in the container).
  const [gridVersion, setGridVersion] = useState(0);
  const [prevIsDirty, setPrevIsDirty] = useState(isDirty);
  if (prevIsDirty !== isDirty) {
    setPrevIsDirty(isDirty);
    if (prevIsDirty && !isDirty) {
      setGridVersion(v => v + 1);
    }
  }

  // paramValues (dashboard-level persisted parameterValues, merged content) is a prop
  // (selectMergedContent lives in the container — it already computes mergedContent for `document`).

  // Local state for in-progress edits (not submitted yet, does not trigger execution)
  // Syncs from paramValues when it changes externally (e.g. agent update, publish, initial load)
  const [localParamValues, setLocalParamValues] = useState<Record<string, any>>(paramValues);
  const prevParamValuesRef = useRef(paramValues);
  if (prevParamValuesRef.current !== paramValues) {
    prevParamValuesRef.current = paramValues;
    // Overwrite local edits when paramValues changes externally (agent or publish)
    setLocalParamValues(paramValues);
  }

  // lastExecutedParams (ephemeralChanges.lastExecuted.params, gates execution) is a prop.
  // NOTE: the container falls back to a stable module-level EMPTY_PARAMS (not a fresh {} each
  // render) — a new {} each render makes effectiveSubmittedValues unstable, which cascades to
  // queryParams in EmbeddedQuestionContainer and triggers infinite retry on errors.

  const questionCount = document?.assets?.filter(a => a.type === 'question').length || 0;

  // The grid layout depends only on WHICH assets exist (id + type), their saved
  // positions, and "Read more" overrides — NOT on any text block's content. Key
  // the memo on a content-invariant signature so editing text doesn't recompute
  // the layout (which would needlessly re-lay-out the grid and regenerate the
  // grid background on every debounced keystroke).
  const layoutSignature = useMemo(() => getLayoutSignature(document?.assets || []), [document?.assets]);
  const layouts = useMemo(
    () => computeDashboardLayouts(document?.assets || [], document?.layout?.items, textBlockRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on layoutSignature (content-invariant); `document.assets` is intentionally excluded so text edits don't churn the layout.
    [layoutSignature, document?.layout, textBlockRows],
  );

  // Extract question IDs from assets (SmartEmbeddedQuestionContainer will load content)
  // Simple filter/map - no useMemo needed for this cheap operation
  const questionIds = document?.assets
    ?.filter(asset => asset.type === 'question' && ('id' in asset) && asset.id)
    ?.map(asset => (asset as { type: 'question'; id: number }).id) || [];

  // questionContents (per-question merged content, one per questionIds entry) is a prop —
  // the container computes it with shallowEqual to prevent re-renders (selectMergedContent
  // lives there now).

  // Merge parameters from all questions (memoized to prevent re-renders)
  // Also collect default values from questions' own parameterValues
  const { mergedParameters, questionParamDefaults } = useMemo(() => {
    const paramMap = new Map<string, QuestionParameter>();
    const defaults = new Map<string, any>();

    questionContents.forEach(content => {
      if (content?.query) {
        const params = syncParametersWithSQL(
          content.query,
          content.parameters || []
        );
        params.forEach(param => {
          const key = `${param.name}-${param.type}`;
          if (!paramMap.has(key)) {
            paramMap.set(key, param);
          }
          // Pick up the first non-empty value from any question's saved parameterValues
          if (!defaults.has(param.name) && content.parameterValues?.[param.name] != null && content.parameterValues[param.name] !== '') {
            defaults.set(param.name, content.parameterValues[param.name]);
          }
        });
      }
    });

    return { mergedParameters: Array.from(paramMap.values()), questionParamDefaults: defaults };
  }, [questionContents]);

  // Map each param key to the question IDs that use it (for hover highlighting)
  const paramToQuestionIds = useMemo(() => {
    const map = new Map<string, number[]>();
    questionContents.forEach((content, index) => {
      if (!content?.query) return;
      const params = syncParametersWithSQL(content.query, content.parameters || []);
      params.forEach(param => {
        const key = `${param.name}-${param.type}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(questionIds[index]);
      });
    });
    return map;
  }, [questionContents, questionIds]);

  // Hover state for param filter chips
  const [hoveredParamKey, setHoveredParamKey] = useState<string | null>(null);

  // Widget highlights: added / moved / edited questions. In PublishModal preview, provided via context.
  // On the main dashboard page, computed directly from content vs persistableChanges + child dirty state.
  const { highlights: contextHighlights } = useDashboardPublishHighlights();
  // fileState (state.files.files[fileId]) and dirtyFiles (selectDirtyFiles) are props.
  const localHighlights = useMemo(() => {
    if (contextHighlights !== null) return null; // context active (PublishModal) — defer to it
    if (!editMode || !fileState) return null;

    const content = fileState.content as DocumentContent | null;
    const changes = fileState.persistableChanges as Partial<DocumentContent> | undefined;
    const allQuestionIds = (changes?.assets ?? content?.assets ?? [])
      .filter(a => a.type === 'question')
      .map(a => (a as { type: 'question'; id: number }).id);
    const dirtyFileIds = new Set(dirtyFiles.map(f => f.id));

    const map = new Map<number, PublishHighlight>();

    // Dashboard-level changes: added questions and moved questions
    if (changes?.assets || changes?.layout) {
      const oldIds = new Set(
        (content?.assets ?? []).filter(a => a.type === 'question').map(a => (a as { type: 'question'; id: number }).id)
      );
      const oldLayoutMap = new Map<string, DashboardLayoutItem>(
        ((content?.layout?.items ?? []) as DashboardLayoutItem[]).map(i => [String(i.id), i])
      );
      const newLayoutMap = new Map<string, DashboardLayoutItem>(
        ((changes?.layout?.items ?? content?.layout?.items ?? []) as DashboardLayoutItem[]).map(i => [String(i.id), i])
      );
      for (const id of allQuestionIds) {
        if (!oldIds.has(id)) {
          map.set(id, 'added');
        } else {
          const o = oldLayoutMap.get(String(id));
          const n = newLayoutMap.get(String(id));
          if (o && n && (o.x !== n.x || o.y !== n.y || o.w !== n.w || o.h !== n.h)) {
            map.set(id, 'moved');
          }
        }
      }
    }

    // Child-level changes: questions with their own edits (not already marked added/moved)
    for (const id of allQuestionIds) {
      if (!map.has(id) && dirtyFileIds.has(id)) {
        map.set(id, 'edited');
      }
    }

    return map.size > 0 ? map : null;
  }, [contextHighlights, editMode, fileState, dirtyFiles]);
  const publishHighlights = contextHighlights ?? localHighlights;

  // Parameters for display (structure from questions, values from ephemeral)
  const parameterValuesForDisplay = useMemo(() => {
    return mergedParameters;
  }, [mergedParameters]);

  // Get database from the first question that has one (for inline SQL param sources)
  const dashboardDatabase = useMemo(() => {
    return questionContents.find(c => c?.connection_name)?.connection_name;
  }, [questionContents]);

  // Effective submitted values: only these flow to query execution.
  // lastExecutedParams gates stale detection; paramValues is the persisted fallback
  // (used on initial load and after publish clears ephemeral state).
  // Falls back to the first non-empty value from the underlying questions' saved parameterValues,
  // but ONLY when the key is absent — explicit null (None) is never overridden by question defaults.
  const effectiveSubmittedValues = useMemo(
    () => computeEffectiveSubmittedValues(mergedParameters, lastExecutedParams, paramValues, questionParamDefaults),
    [mergedParameters, lastExecutedParams, paramValues, questionParamDefaults],
  );


  // Handler for removing any asset (question or text block) from the dashboard
  const handleRemoveAsset = useCallback((idStr: string) => {
    const doc = documentRef.current;
    if (!doc?.assets) return;

    const parsedId = parseLayoutItemId(idStr);
    const isNumeric = typeof parsedId === 'number';

    // Remove from assets
    const updatedAssets = doc.assets.filter(asset => {
      if (isNumeric && asset.type === 'question') {
        return (asset as { id: number }).id !== parsedId;
      }
      if (!isNumeric && isInlineAsset(asset)) {
        return (asset as InlineAsset).id !== parsedId;
      }
      return true;
    });

    // Remove from layout
    const existingLayout = doc.layout?.items || [];
    const updatedLayoutItems = existingLayout.filter(
      (item: DashboardLayoutItem) => String(item.id) !== idStr
    );

    onChange({
      assets: updatedAssets,
      layout: { columns: 12, items: updatedLayoutItems }
    });

  }, [onChange]);

  // Memoize the grid background to prevent re-rendering on every keystroke
  const gridBackground = useMemo(() => {
    if (!editMode) return null;

    const gridRowHeight = 80; // Must match rowHeight prop on ResponsiveGridLayout
    const gridMargin = 6;    // Must match margin prop on ResponsiveGridLayout
    const cellHeight = gridRowHeight + gridMargin; // 90px per row (rowHeight + vertical margin)
    const minHeight = 1500;
    const cols = currentCols; // Use responsive column count
    const maxLayoutRow = layouts.lg.reduce((max: number, item: Layout) => Math.max(max, item.y + item.h), 0);
    const minRows = Math.ceil(minHeight / cellHeight);
    const numRows = Math.max(minRows, maxLayoutRow + 10);
    const halfMargin = gridMargin / 2; // 5px — half the margin on each side of a cell

    return (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-full overflow-hidden">
        {Array.from({ length: cols * numRows }).map((_, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const colWidthPercent = 100 / cols;

          return (
            <div
              key={i}
              className="pointer-events-none absolute"
              style={{ left: `${col * colWidthPercent}%`, top: `${row * cellHeight}px`, width: `${colWidthPercent}%`, height: `${cellHeight}px`, padding: `${halfMargin}px` }}
            >
              <div className="size-full rounded-md border border-border bg-muted opacity-60" />
            </div>
          );
        })}
      </div>
    );
  }, [editMode, layouts.lg, currentCols]);

  // All assets that participate in the grid
  const layoutableAssets = useMemo(() => getLayoutableAssets(document?.assets || []), [document?.assets]);

  // Memoize the grid items (questions + text blocks) to prevent re-rendering on every keystroke
  const gridItems = useMemo(() => {
    const paramHighlightedIds = hoveredParamKey ? (paramToQuestionIds.get(hoveredParamKey) ?? []) : null;

    return layoutableAssets.map((asset, index) => {
      const key = getAssetLayoutKey(asset);

      if (asset.type === 'question') {
        const questionId = (asset as { id: number }).id;

        // Publish-mode highlights take priority over param-hover highlights
        const publishMark = publishHighlights?.get(questionId);
        let borderClass: string;
        let opacityClass = '';
        if (publishHighlights !== null) {
          // Publish context active: color by add/move/unchanged
          if (publishMark === 'added') borderClass = 'border-[#16a085]';
          else if (publishMark === 'edited') borderClass = 'border-[#f39c12]';
          else if (publishMark === 'moved') borderClass = 'border-[#2980b9]';
          else borderClass = 'border-border/50';
        } else {
          // Normal param-hover highlighting
          const isHighlighted = paramHighlightedIds ? paramHighlightedIds.includes(questionId) : null;
          borderClass = isHighlighted === true ? 'border-[#16a085]' : isHighlighted === false ? 'border-border/50' : 'border-border';
          opacityClass = isHighlighted === false ? 'opacity-50' : '';
        }

        return (
          <div
            key={key}
            // Surfaces the publish/edit highlight state (added/moved/edited) for
            // component tests — there's no other visible affordance for it besides
            // the border color below.
            aria-label={`Dashboard tile ${questionId}${publishMark ? ` (${publishMark})` : ''}`}
            // transition-COLORS only (highlight borders/opacity) — NEVER transform: react-grid-layout
            // merges these classes onto its positioned item, and transform transitions inside the
            // foreignObject surface freeze mid-animation (Chromium paint-invalidation; see the
            // grid-level transition:none rule below).
            className={`flex flex-col overflow-hidden rounded-md bg-card transition-[border-color,background-color,opacity] duration-200 ${publishMark ? 'border-2' : 'border'} ${borderClass} ${opacityClass}`}
          >
            {/* Windowed (Renderer_v2 Phase 7): off-viewport tiles are BUSY layout ghosts;
                the capture readiness gate force-mounts them (see WindowedTile). */}
            <WindowedTile>
              <SmartEmbeddedQuestionContainer
                questionId={questionId}
                externalParameters={parameterValuesForDisplay}
                externalParamValues={effectiveSubmittedValues}
                showTitle={true}
                editMode={editMode}
                index={index}
                dashboardId={fileId}
                onEdit={() => onQuestionEdit(questionId, effectiveSubmittedValues)}
                onRemove={() => handleRemoveAsset(questionId.toString())}
              />
            </WindowedTile>
          </div>
        );
      }

      // Text block
      const textAsset = asset as InlineAsset;
      return (
        <div
          key={key}
          className="flex flex-col overflow-hidden rounded-md border border-border bg-card"
        >
          {/* Stable callbacks (memoized) so React.memo(TextBlockCard) can skip
              re-rendering the OTHER text blocks when one block's content changes. */}
          <TextBlockCard
            id={textAsset.id || ''}
            content={textAsset.content || ''}
            editMode={editMode}
            filePath={folderPath}
            onContentChange={onTextBlockContentChange}
            onRemove={handleRemoveAsset}
            onResize={handleTextBlockResize}
          />
        </div>
      );
    });
  }, [layoutableAssets, editMode, handleRemoveAsset, handleTextBlockResize, onTextBlockContentChange, parameterValuesForDisplay, effectiveSubmittedValues, hoveredParamKey, paramToQuestionIds, fileId, onQuestionEdit, publishHighlights, folderPath]);

  const handleLayoutChange = (newLayout: Layout[]) => {
    if (!document) return;

    const updatedLayout = {
      columns: 12,
      items: newLayout.map(item => ({
        id: parseLayoutItemId(item.i),
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }))
    };

    onChange({ layout: updatedLayout });
  };

  return (
    // Phase 8: this view renders INSIDE the self-contained iframe surface (DashboardSurface);
    // the [data-file-id] capture anchor, dev marker overlay, and the surface itself are the
    // CONTAINER's (DashboardContainerV2) — the view is the surface's content, nothing more.
    // px-10: the LEFT gutter is the marker column's home (MARKER_GUTTER_CSS_PX) — badges, live
    // overlay AND captured image, draw INSIDE it instead of widening the canvas, so the agent
    // image keeps the reader's geometry 1:1. The RIGHT gutter mirrors it purely for visual
    // balance (a left-only gutter read as lopsided padding).
    <div role="region" aria-label="Dashboard" className="px-10" {...(theme ? { 'data-theme': theme } : {})}>
    {/* Inside the foreignObject surface, transform TRANSITIONS freeze mid-animation (Chromium
        does not incrementally repaint transformed foreignObject content — the stale-tiles bug).
        Tiles snap to their positions instead; DashboardSurface's resize nudge forces the repaint. */}
    <style>{'[aria-label="Dashboard"] .react-grid-item { transition: none; }'}</style>

      {/* Visual View (the Code view is rendered upstream by FileView) */}
      {(
        <>
          {/* Dashboard-level Parameters */}
          {parameterValuesForDisplay.length > 0 && (
            <div className="mb-4">
              <ParameterRow
                parameters={parameterValuesForDisplay}
                parameterValues={localParamValues}
                lastSubmittedValues={effectiveSubmittedValues}
                onValueChange={(paramName, value) => {
                  setLocalParamValues(prev => ({ ...prev, [paramName]: value }));
                }}
                onSubmit={onParamSubmit}
                disableTypeChange={true}
                onHoverParam={setHoveredParamKey}
                database={dashboardDatabase}
              />
            </div>
          )}

          {/* Grid Layout */}
          <div className={`relative min-h-full max-w-full ${layoutableAssets.length > 0 ? 'pb-[120px]' : 'pb-4'}`}>
            {gridBackground}

            {layoutableAssets.length > 0 ? (
              <ResponsiveGridLayout
                key={`grid-v${gridVersion}`}
                className="layout"
                width={gridWidth}
                layouts={layouts}
                breakpoints={{ lg: 1024, md: 768, sm: 0 }}
                cols={{ lg: 12, md: 12, sm: 6 }}
                rowHeight={80}
                compactType="vertical"
                onBreakpointChange={(_breakpoint, cols) => setCurrentCols(cols)}
                onDragStop={handleLayoutChange}
                onResizeStop={handleLayoutChange}
                draggableHandle=".drag-handle"
                containerPadding={[0, 0]}
                margin={[6, 6]}
                isDraggable={editMode}
                isResizable={editMode}
              >
                {gridItems}
              </ResponsiveGridLayout>
            ) : (
              /* Empty dashboard: 50/50 split with a compact action rail. */
              <div className="mx-auto flex max-w-[900px] flex-col items-center justify-center gap-3 lg:flex-row lg:gap-6">
                <div className="w-full min-w-0 lg:flex-1">
                  <DashboardEmptyState />
                </div>
                {editMode && (
                  <div className="relative z-10 w-full max-w-[420px] pb-4 lg:max-w-none lg:flex-1 lg:pb-0">
                    <QuestionBrowserPanel
                      folderPath={folderPath}
                      onAddQuestion={onAddQuestion}
                      onAddTextBlock={onAddTextBlock}
                      excludedIds={questionIds}
                      title="Add questions / text"
                      dashboardId={fileId}
                      compact
                    />
                  </div>
                )}
              </div>
            )}

            {/* Add Questions/Text Panel - after last card in edit mode */}
            {editMode && layoutableAssets.length > 0 && (
              <div className="relative z-10 mx-auto mt-4 max-w-[500px]">
                <QuestionBrowserPanel
                  folderPath={folderPath}
                  onAddQuestion={onAddQuestion}
                  onAddTextBlock={onAddTextBlock}
                  excludedIds={questionIds}
                  title="Add more questions / text"
                  dashboardId={fileId}
                />
              </div>
            )}
          </div>

        </>
      )}

    </div>
  );
}
