'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName } from '@/store/filesSlice';
import { QuestionContent, QuestionParameter } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { applyVizOverride } from '@/lib/data/story/story-question';
import EmbeddedQuestionContainer from './EmbeddedQuestionContainer';
import { Link } from '@/components/ui/Link';
import { LuEllipsis, LuSparkles, LuExternalLink, LuTrash2, LuPencil } from 'react-icons/lu';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/kit/dropdown-menu';
import { useExplainQuestion } from '@/lib/hooks/useExplainQuestion';
import { runOrDefer } from '@/lib/navigation/nav-progress';

// Tile chrome is kit/Tailwind (Renderer_v2 Phase 3 — the Chakra exit for embeds): the classes
// below resolve through the shadcn token layer (main document: app/theme-tokens.css under
// [data-mx-theme-host]; stories: the compiled story CSS). Behavior, aria-labels, and the
// drag-handle contract are pinned by smart-embedded-tile.ui.test.tsx.

interface SmartEmbeddedQuestionContainerProps {
  questionId: number;
  externalParameters?: QuestionParameter[];  // Optional: parameters from parent (e.g., dashboard)
  externalParamValues?: Record<string, any>;  // Optional: runtime parameter values from parent
  showTitle?: boolean;  // Show question title header
  editMode?: boolean;   // Enable edit mode UI (drag handle, edit button, remove button)
  onEdit?: () => void;  // Callback for edit button
  onRemove?: () => void;  // Callback for remove button
  index?: number;  // Optional index for numbering (e.g., #01, #02)
  dashboardId?: number;  // Source dashboard ID (appended as ?dashboard= to question links)
  readOnly?: boolean;  // Public read-only view (e.g. shared story): no actions menu, plain title (no auth-gated link)
  enableDrilldown?: boolean;  // Click-to-drill-down on data points (off for story embeds, on for dashboards)
  showActionsMenu?: boolean;  // Show the "..." (Explain/Edit/Remove) header menu. Default true (dashboards); stories pass their edit-mode flag so the menu only appears while editing.
  vizOverride?: VizEnvelope | null;  // Story-level FULL viz replace for this embed — the saved question file is untouched.
}

/** Minimal spinner (Tailwind only — no Chakra Spinner in the embed tree). */
function TileSpinner({ className = 'size-8' }: { className?: string }) {
  return (
    <div
      aria-label="Loading"
      className={`animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground ${className}`}
    />
  );
}

function SmartEmbeddedQuestionContainerInner({
  questionId,
  externalParameters,
  externalParamValues,
  showTitle = false,
  editMode = false,
  onEdit,
  onRemove,
  index = 0,
  dashboardId,
  readOnly = false,
  enableDrilldown = true,
  showActionsMenu = true,
  vizOverride,
}: SmartEmbeddedQuestionContainerProps) {
  const { explainQuestion } = useExplainQuestion();

  // Stagger the heavy tile body onto browser idle time. Mounting all of a
  // dashboard's tile bodies in one go produces a series of long main-thread
  // tasks (React render + style computation + layout) that block input — a
  // click on a tile title wouldn't navigate until the whole dashboard finished
  // mounting. Gating each body on requestIdleCallback (staggered fallback
  // timeout per index) makes each mount its own short task with yields in
  // between, so clicks and navigation stay responsive during load. The title
  // link renders immediately either way.
  const [bodyReady, setBodyReady] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => runOrDefer(() => setBodyReady(true)), { timeout: 500 + index * 150 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => runOrDefer(() => setBodyReady(true)), 20 + index * 20);
    return () => window.clearTimeout(id);
  }, [index]);

  // Load question file
  const { fileState: file } = useFile(questionId) ?? {};
  const loading = !file || file.loading;

  // Get merged content (includes any edits) — a proper QuestionContent for the embedded question.
  const rawMergedContent = useAppSelector(state =>
    selectMergedContent(state, questionId)
  ) as QuestionContent | undefined;
  // A story-level viz override FULLY replaces the question's viz (saved file untouched).
  const mergedContent = useMemo(
    () => (rawMergedContent ? applyVizOverride(rawMergedContent, vizOverride) : rawMergedContent),
    [rawMergedContent, vizOverride],
  );

  // Use effective name so pending renames are reflected immediately in the dashboard card
  const effectiveName = useAppSelector(state => selectEffectiveName(state, questionId));

  // Build question URL with optional dashboard context and param values
  const questionHref = useMemo(() => {
    const base = `/f/${questionId}`;
    if (!dashboardId) return base;
    const params = new URLSearchParams();
    params.set('dashboard', String(dashboardId));
    if (externalParamValues) {
      for (const [key, value] of Object.entries(externalParamValues)) {
        if (value != null) params.set(`p.${key}`, String(value));
      }
    }
    return `${base}?${params.toString()}`;
  }, [questionId, dashboardId, externalParamValues]);

  // Show loading state while file loads
  if (loading || !file || !mergedContent) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <TileSpinner />
      </div>
    );
  }

  // Use external parameters (from dashboard) or fall back to question's own parameters
  const parametersToUse = externalParameters ?? mergedContent?.parameters ?? [];

  // Render embedded question container with loaded content
  return (
    <div className="group relative flex flex-1 flex-col overflow-hidden">
      {showTitle && (
        <div className="flex items-center justify-between bg-muted/60 px-5 pt-3">
          <div className="mr-2 flex-1">
            {readOnly ? (
              // Public viewers can't open /f/<id> (auth-gated) — show a plain title.
              <p className="line-clamp-1 font-mono text-sm font-semibold text-foreground">
                {effectiveName || file.name}
              </p>
            ) : (
              <Link
                href={questionHref}
                prefetch={true}
                onClick={(e) => {
                  if (editMode) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                style={{ pointerEvents: editMode ? 'none' : 'auto' }}
              >
                <p
                  className={`line-clamp-1 font-mono text-sm font-semibold text-foreground ${
                    editMode ? 'cursor-move' : 'cursor-pointer hover:text-primary hover:underline'
                  }`}
                >
                  {effectiveName || file.name}
                </p>
              </Link>
            )}
          </div>
          {!editMode && !readOnly && showActionsMenu && (
            <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild={false} aria-label="Card actions"
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground">
                  <LuEllipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[180px]">
                  <DropdownMenuItem aria-label="Explain chart" onClick={() => explainQuestion(questionId)}>
                    <LuSparkles className="size-4 text-primary" />
                    <span>Explain chart</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem aria-label="Edit question"
                    onClick={() => onEdit ? onEdit() : window.open(questionHref, '_blank')}>
                    <LuExternalLink className="size-4" />
                    <span>Edit question</span>
                  </DropdownMenuItem>
                  {onRemove && (
                    <DropdownMenuItem aria-label="Remove from dashboard" variant="destructive" onClick={onRemove}>
                      <LuTrash2 className="size-4" />
                      <span>Remove from dashboard</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      )}
      {bodyReady ? (
        <EmbeddedQuestionContainer
          question={mergedContent}
          questionId={questionId}
          filePath={file?.path}
          externalParameters={parametersToUse}
          externalParamValues={externalParamValues}
          enableDrilldown={enableDrilldown}
        />
      ) : (
        <div className="flex min-h-[120px] flex-1 items-center justify-center">
          <TileSpinner className="size-6" />
        </div>
      )}
      {/* Edit mode: overlay makes entire card draggable, blocks chart interaction */}
      {editMode && (
        <>
          <div
            className="drag-handle absolute inset-0 z-[1] cursor-move"
            style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%)' }}
          />
          <div className="absolute top-2 right-2 z-[2] flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit question"
                className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-primary outline-none transition-transform duration-100 hover:scale-125"
              >
                <LuPencil size={14} />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                aria-label="Remove from dashboard"
                className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-destructive outline-none transition-transform duration-100 hover:scale-125"
              >
                <LuTrash2 size={14} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Custom comparator: skip re-render when only unstable callback refs change (onEdit/onRemove
// are inline arrow functions in DashboardView's questionGridItems useMemo, so they're always
// new references when hoveredParamKey changes — ignoring them prevents 77-render cascades).
const SmartEmbeddedQuestionContainer = React.memo(SmartEmbeddedQuestionContainerInner, (prev, next) =>
  prev.questionId === next.questionId &&
  prev.externalParameters === next.externalParameters &&
  prev.externalParamValues === next.externalParamValues &&
  prev.showTitle === next.showTitle &&
  prev.editMode === next.editMode &&
  prev.index === next.index &&
  prev.dashboardId === next.dashboardId &&
  prev.readOnly === next.readOnly &&
  prev.enableDrilldown === next.enableDrilldown &&
  prev.showActionsMenu === next.showActionsMenu &&
  prev.vizOverride === next.vizOverride
);
export default SmartEmbeddedQuestionContainer;
