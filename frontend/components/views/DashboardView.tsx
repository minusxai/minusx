'use client';

import { Box, Text, IconButton, HStack, Portal, MenuRoot, MenuTrigger, MenuPositioner, MenuContent, MenuItem } from '@chakra-ui/react';
import { LuPlus, LuX, LuGripVertical, LuPresentation, LuFileText, LuChevronDown, LuCheck, LuLayoutDashboard, LuLayers } from 'react-icons/lu';
import PresentationOverlay, { splitIntoSlides } from '../PresentationOverlay';
import ReportOverlay from '../ReportOverlay';
import DockView from './DockView';
import ReportDocView from './ReportDocView';
import DeckView from './DeckView';
import { AssetReference, DashboardLayoutItem, DocumentContent, InlineAsset, QuestionContent, QuestionParameter, isInlineAsset } from '@/lib/types';
import SmartEmbeddedQuestionContainer from '../containers/SmartEmbeddedQuestionContainer';
import TextBlockCard from '../TextBlockCard';
import ParameterRow from '../ParameterRow';
import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { Layout, WidthProvider, Responsive } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import JsonEditor from '../slides/JsonEditor';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent, selectIsDirty, selectDirtyFiles, setEphemeral, addQuestionToDashboard, addTextBlockToDashboard, addDividerToDashboard, updateTextBlockContent } from '@/store/filesSlice';
import { editFile } from '@/lib/api/file-state';
import { pushView, selectDashboardEditMode, selectFileViewMode } from '@/store/uiSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import { shallowEqual } from 'react-redux';
import { QuestionBrowserPanel } from '../QuestionBrowserPanel';
import { useDashboardPublishHighlights, type PublishHighlight } from '@/lib/context/dashboard-publish-highlights';
import { useSetDashboardHeaderActions } from '@/lib/context/dashboard-header-actions';

const livePulseAnimation = `
  @keyframes livePulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
`;

const EMPTY_PARAMS: Record<string, any> = {};
const DASHBOARD_MIN_W = 2;
const DASHBOARD_MIN_H = 2;
const DASHBOARD_DEFAULT_W = 6;
const DASHBOARD_DEFAULT_H = 6;
const TEXT_BLOCK_DEFAULT_W = 6;
const TEXT_BLOCK_DEFAULT_H = 3;
const TEXT_BLOCK_MIN_W = 2;
const TEXT_BLOCK_MIN_H = 1;
const GRID_ROW_HEIGHT = 80;
const GRID_MARGIN = 6;

/** Convert a react-grid-layout string key back to number (questions) or string (inline assets). */
const parseLayoutItemId = (key: string): number | string =>
  /^\d+$/.test(key) ? Number(key) : key;

const ResponsiveGridLayout = WidthProvider(Responsive);

interface DashboardViewProps {
  // Data props (all from Redux via smart component)
  document: DocumentContent;
  folderPath: string;
  fileId: number;  // File ID for Redux operations

  // Content change callback (header/save/editMode now live in FileHeader via Redux)
  onChange: (updates: Partial<DocumentContent>) => void;

  mode?: 'view' | 'create' | 'preview';

  // If true, all editing is disabled (role-based permission)
  readOnly?: boolean;
}

// Compact layout for mobile by stacking cards vertically
const compactMobileLayout = (layout: Layout[], toCols: number): Layout[] => {
  // Sort by Y position first, then X position (top to bottom, left to right)
  const sorted = [...layout].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  // Stack cards vertically, all full-width for mobile
  let currentY = 0;
  return sorted.map(item => {
    const result = {
      ...item,
      x: 0,           // Always start at left edge
      y: currentY,    // Stack vertically
      w: toCols,      // Full width on mobile (6 cols = 100%)
      minW: toCols,   // Lock to full width
    };
    currentY += item.h; // Stack next item below this one
    return result;
  });
};

/** Get the grid layout key for an asset (string for both question IDs and inline asset UUIDs). */
const getAssetLayoutKey = (asset: AssetReference): string => {
  if (asset.type === 'question') return (asset as { id: number }).id.toString();
  return (asset as InlineAsset).id || '';
};

/** Assets that participate in the grid layout (questions, text blocks, dividers). */
const getLayoutableAssets = (assets: AssetReference[]): AssetReference[] =>
  assets?.filter(asset =>
    (asset.type === 'question' && 'id' in asset && asset.id) ||
    (asset.type === 'text' && 'id' in asset && asset.id) ||
    (asset.type === 'divider' && 'id' in asset && asset.id)
  ) || [];

// Generate default layout for all layoutable assets
const generateDefaultLayout = (assets: AssetReference[]): Layout[] => {
  const layoutable = getLayoutableAssets(assets);
  let currentY = 0;
  return layoutable.map((asset) => {
    const isDivider = asset.type === 'divider';
    const isText = asset.type === 'text';
    const w = isDivider ? 12 : isText ? TEXT_BLOCK_DEFAULT_W : DASHBOARD_DEFAULT_W;
    const h = isDivider ? 1 : isText ? TEXT_BLOCK_DEFAULT_H : DASHBOARD_DEFAULT_H;
    const layout: Layout = {
      i: getAssetLayoutKey(asset),
      x: 0,
      y: currentY,
      w,
      h,
      minW: isDivider ? 12 : isText ? TEXT_BLOCK_MIN_W : DASHBOARD_MIN_W,
      minH: isDivider ? 1 : isText ? TEXT_BLOCK_MIN_H : DASHBOARD_MIN_H,
    };
    currentY += h;
    return layout;
  });
};

export default function DashboardView({
  document,
  folderPath,
  fileId,
  onChange,
  mode = 'view',
  readOnly = false,
}: DashboardViewProps) {
  const dispatch = useAppDispatch();

  // editMode and viewMode sourced from Redux (managed by FileHeader)
  const reduxEditMode = useAppSelector(state => selectDashboardEditMode(state, fileId));
  const editMode = (mode === 'preview' || readOnly) ? false : reduxEditMode;
  const activeTab = useAppSelector(state => selectFileViewMode(state, fileId));

  // Ref to always have the latest document for callbacks that may fire with stale closures
  const documentRef = useRef(document);
  documentRef.current = document;

  const addPanelRef = useRef<HTMLDivElement>(null);

  // Track current columns for responsive grid background
  const [currentCols, setCurrentCols] = useState(12);

  // Track expanded text block heights (pixel height → grid rows)
  const [expandedHeights, setExpandedHeights] = useState<Map<string, number>>(new Map());
  const handleTextBlockResize = useCallback((textBlockId: string, height: number | null) => {
    setExpandedHeights(prev => {
      const next = new Map(prev);
      if (height === null) {
        next.delete(textBlockId);
      } else {
        // Cell pixel height = h * ROW_HEIGHT + (h-1) * MARGIN → h = ceil((px + MARGIN) / (ROW_HEIGHT + MARGIN))
        const gridRows = Math.ceil((height + GRID_MARGIN) / (GRID_ROW_HEIGHT + GRID_MARGIN));
        next.set(textBlockId, gridRows);
      }
      return next;
    });
  }, []);

  // Force react-grid-layout to remount when file reverts from dirty → clean (discard/save).
  // ResponsiveGridLayout maintains internal layout state that doesn't always sync
  // with the `layouts` prop, so we force a remount via key change.
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));
  const [gridVersion, setGridVersion] = useState(0);
  const [prevIsDirty, setPrevIsDirty] = useState(isDirty);
  if (prevIsDirty !== isDirty) {
    setPrevIsDirty(isDirty);
    if (prevIsDirty && !isDirty) {
      setGridVersion(v => v + 1);
    }
  }

  // Read current parameter values from merged content (persisted in file)
  const mergedDashboardContent = useAppSelector(state => selectMergedContent(state, fileId)) as any;
  const paramValues = mergedDashboardContent?.parameterValues || EMPTY_PARAMS;

  // Local state for in-progress edits (not submitted yet, does not trigger execution)
  // Syncs from paramValues when it changes externally (e.g. agent update, publish, initial load)
  const [localParamValues, setLocalParamValues] = useState<Record<string, any>>(paramValues);
  const prevParamValuesRef = useRef(paramValues);
  if (prevParamValuesRef.current !== paramValues) {
    prevParamValuesRef.current = paramValues;
    // Overwrite local edits when paramValues changes externally (agent or publish)
    setLocalParamValues(paramValues);
  }

  // Last-submitted param values from lastExecuted (gates execution)
  // NOTE: ?? EMPTY_PARAMS (not ?? {}) — a new {} each render makes effectiveSubmittedValues unstable
  // which cascades to queryParams in EmbeddedQuestionContainer and triggers infinite retry on errors.
  const lastExecutedParams = useAppSelector(
    state => (state.files.files[fileId]?.ephemeralChanges as any)?.lastExecuted?.params as Record<string, any> | undefined
  ) ?? EMPTY_PARAMS;

  // Get agent name from config
  const { config } = useConfigs();
  const agentName = config.branding.agentName;

  const questionCount = document?.assets?.filter(a => a.type === 'question').length || 0;

  // Assets that actually appear in THIS view (the dashboard grid).
  // Per the one-pool/many-views model: a view renders only the assets named in
  // its own layout. Assets that live in the dock but were never placed in the
  // dashboard layout are intentionally NOT shown here. When the dashboard has no
  // layout yet (legacy / freshly-created), fall back to showing the whole pool.
  const dashboardAssets = useMemo(() => {
    const all = getLayoutableAssets(document?.assets || []);
    const items = document?.layout?.items;
    if (!items) return all;
    const layoutIds = new Set(items.map((item: DashboardLayoutItem) => String(item.id)));
    return all.filter(asset => layoutIds.has(getAssetLayoutKey(asset)));
  }, [document?.assets, document?.layout]);

  // Compute layouts for all breakpoints from document
  // Desktop layout (12 cols) is the source of truth, mobile layouts are scaled
  const layouts = useMemo(() => {
    if (!document) return { lg: [], md: [], sm: [], xs: [], xxs: [] };

    let baseLayout: Layout[];
    if (document.layout?.items) {
      const layoutMap = new Map<string, DashboardLayoutItem>(document.layout.items.map((item: DashboardLayoutItem) => [String(item.id), item]));

      // dashboardAssets is already filtered to assets present in the layout, so
      // every entry resolves to a layout item below.
      baseLayout = dashboardAssets.map((asset) => {
        const id = getAssetLayoutKey(asset);
        const item = layoutMap.get(id)!;
        const isDivider = asset.type === 'divider';
        const isText = asset.type === 'text';
        const minW = isDivider ? 12 : isText ? TEXT_BLOCK_MIN_W : DASHBOARD_MIN_W;
        const minH = isDivider ? 1 : isText ? TEXT_BLOCK_MIN_H : DASHBOARD_MIN_H;
        return { i: id, x: item.x, y: item.y, w: item.w, h: item.h, minW, minH };
      });
    } else {
      baseLayout = generateDefaultLayout(document.assets);
    }

    // Generate compacted layouts for mobile/tablet (6 cols) - stacks vertically
    const mobileLayout = compactMobileLayout(baseLayout, 6);

    return {
      lg: baseLayout,   // 12 cols
      md: baseLayout,   // 12 cols
      sm: mobileLayout, // 6 cols - vertically stacked
      xs: mobileLayout, // 6 cols - vertically stacked
      xxs: mobileLayout // 6 cols - vertically stacked
    };
  }, [document?.layout, document?.assets, dashboardAssets]);

  // Apply expanded text block heights to layouts (view-only, not persisted)
  const effectiveLayouts = useMemo(() => {
    if (expandedHeights.size === 0) return layouts;
    const applyExpansion = (items: Layout[]) =>
      items.map(item => {
        const expanded = expandedHeights.get(item.i);
        return expanded ? { ...item, h: expanded } : item;
      });
    return {
      lg: applyExpansion(layouts.lg),
      md: applyExpansion(layouts.md),
      sm: applyExpansion(layouts.sm),
      xs: applyExpansion(layouts.xs),
      xxs: applyExpansion(layouts.xxs),
    };
  }, [layouts, expandedHeights]);

  // Dashboard version selector (Live vs snapshots)
  const [dashboardVersion, setDashboardVersion] = useState('live');
  const dashboardVersionOptions = [
    { value: 'live', label: 'Live' },
    { value: 'snapshot-2026-05', label: 'Snapshot May 2026' },
    { value: 'snapshot-2026-04', label: 'Snapshot April 2026' },
    { value: 'snapshot-2026-03', label: 'Snapshot March 2026' },
    { value: 'snapshot-2026-02', label: 'Snapshot February 2026' },
  ];
  const activeVersionLabel = dashboardVersionOptions.find(o => o.value === dashboardVersion)?.label ?? 'Live';
  const isLive = dashboardVersion === 'live';

  // In-page view: the asset dock, the dashboard grid, the report doc, or the deck.
  const [currentView, setCurrentView] = useState<'dashboard' | 'dock' | 'report' | 'presentation'>('dashboard');

  // Presentation / Report mode
  const [isPresenting, setIsPresenting] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const slides = useMemo(() => {
    if (!document?.assets) return [];
    const layoutItems = document.layout?.items ?? [];
    return splitIntoSlides(document.assets, layoutItems);
  }, [document?.assets, document?.layout]);

  // Extract question IDs from assets (SmartEmbeddedQuestionContainer will load content)
  // Simple filter/map - no useMemo needed for this cheap operation
  const questionIds = document?.assets
    ?.filter(asset => asset.type === 'question' && ('id' in asset) && asset.id)
    ?.map(asset => (asset as { type: 'question'; id: number }).id) || [];

  // Extract and merge parameters from all questions in Redux
  // Questions are already loaded by SmartEmbeddedQuestionContainer's useFile calls
  // Get all question contents (memoized with shallowEqual to prevent re-renders)
  const questionContents = useAppSelector(
    state => questionIds.map(id => selectMergedContent(state, id) as QuestionContent | undefined),
    shallowEqual
  );

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
  const fileState = useAppSelector(state => state.files.files[fileId]);
  const dirtyFiles = useAppSelector(selectDirtyFiles, shallowEqual);
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
  const effectiveSubmittedValues = useMemo(() => {
    const values: Record<string, any> = {};
    for (const p of mergedParameters) {
      // Use 'in' check so null (skipped) is preserved — ?? treats null as nullish
      if (p.name in lastExecutedParams) {
        values[p.name] = lastExecutedParams[p.name];
      } else if (paramValues && p.name in paramValues) {
        values[p.name] = paramValues[p.name];
      } else {
        values[p.name] = questionParamDefaults.get(p.name) ?? '';
      }
    }
    return values;
  }, [mergedParameters, lastExecutedParams, paramValues, questionParamDefaults]);


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

    const cellHeight = GRID_ROW_HEIGHT + GRID_MARGIN;
    const minHeight = 1500;
    const cols = currentCols; // Use responsive column count
    const maxLayoutRow = layouts.lg.reduce((max: number, item: Layout) => Math.max(max, item.y + item.h), 0);
    const minRows = Math.ceil(minHeight / cellHeight);
    const numRows = Math.max(minRows, maxLayoutRow + 10);
    const halfMargin = GRID_MARGIN / 2; // 5px — half the margin on each side of a cell

    return (
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        height="100%"
        pointerEvents="none"
        zIndex={0}
        overflow="hidden"
      >
        {Array.from({ length: cols * numRows }).map((_, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const colWidthPercent = 100 / cols;

          return (
            <Box
              key={i}
              position="absolute"
              left={`${col * colWidthPercent}%`}
              top={`${row * cellHeight}px`}
              width={`${colWidthPercent}%`}
              height={`${cellHeight}px`}
              px={`${halfMargin}px`}
              py={`${halfMargin}px`}
              pointerEvents="none"
            >
              <Box
                width="100%"
                height="100%"
                border="1px solid"
                borderColor="border.muted"
                borderRadius="md"
                bg="bg.muted"
                opacity={0.6}
              />
            </Box>
          );
        })}
      </Box>
    );
  }, [editMode, layouts.lg, currentCols]);

  // All assets that participate in the grid (only those placed in the dashboard
  // layout — dock-only assets are not rendered in this view).
  const layoutableAssets = dashboardAssets;

  // Register header actions (Present button in view mode, Add Content in edit mode)
  const setActions = useSetDashboardHeaderActions();
  useEffect(() => {
    setActions(
      <>
        <style>{livePulseAnimation}</style>
        {/* View switcher: Dock / Dashboard / Report / Present over one asset pool */}
        <HStack
          gap={0.5}
          p={0.5}
          borderRadius="full"
          bg="bg.muted"
          borderWidth="1px"
          borderColor="border.muted"
        >
          <ViewSwitchSegment
            label="Dock"
            icon={<LuLayers size={13} />}
            active={currentView === 'dock'}
            onClick={() => setCurrentView('dock')}
          />
          <ViewSwitchSegment
            label="Dashboard"
            icon={<LuLayoutDashboard size={13} />}
            active={currentView === 'dashboard'}
            onClick={() => setCurrentView('dashboard')}
          />
          <ViewSwitchSegment
            label="Report"
            icon={<LuFileText size={13} />}
            active={currentView === 'report'}
            onClick={() => setCurrentView('report')}
          />
          <ViewSwitchSegment
            label="Presentation"
            icon={<LuPresentation size={13} />}
            active={currentView === 'presentation'}
            onClick={() => setCurrentView('presentation')}
          />
        </HStack>
        <MenuRoot positioning={{ placement: 'bottom-start' }}>
          <MenuTrigger asChild>
            <HStack
              as="button"
              gap={1.5}
              px={2}
              py={0.5}
              borderRadius="full"
              bg={isLive ? 'accent.teal/8' : 'bg.muted'}
              borderWidth="1px"
              borderColor={isLive ? 'accent.teal/15' : 'border.muted'}
              cursor="pointer"
              _hover={{ borderColor: isLive ? 'accent.teal/30' : 'border.emphasized' }}
              transition="all 0.15s"
            >
              {isLive && (
                <Box w="6px" h="6px" borderRadius="full" bg="accent.teal" css={{ animation: 'livePulse 2s ease-in-out infinite' }} />
              )}
              <Text fontSize="xs" fontWeight="700" color={isLive ? 'accent.teal' : 'fg.muted'} fontFamily="mono">
                {activeVersionLabel}
              </Text>
              <LuChevronDown size={10} color={isLive ? 'var(--chakra-colors-accent-teal)' : undefined} />
            </HStack>
          </MenuTrigger>
          <Portal>
            <MenuPositioner>
              <MenuContent minW="200px" bg="bg.surface" borderColor="border.default" shadow="lg" p={1}>
                {dashboardVersionOptions.map(opt => (
                  <MenuItem
                    key={opt.value}
                    value={opt.value}
                    onClick={() => setDashboardVersion(opt.value)}
                    px={3}
                    py={1.5}
                    borderRadius="sm"
                    _hover={{ bg: 'bg.muted' }}
                    cursor="pointer"
                  >
                    <HStack gap={2} w="full" justify="space-between">
                      <HStack gap={1.5}>
                        {opt.value === 'live' && (
                          <Box w="6px" h="6px" borderRadius="full" bg="accent.teal" css={{ animation: 'livePulse 2s ease-in-out infinite' }} />
                        )}
                        <Text fontSize="xs" fontFamily="mono" fontWeight={opt.value === dashboardVersion ? '700' : '500'}>
                          {opt.label}
                        </Text>
                      </HStack>
                      {opt.value === dashboardVersion && <LuCheck size={12} />}
                    </HStack>
                  </MenuItem>
                ))}
                <Box borderTopWidth="1px" borderColor="border.muted" my={1} />
                <MenuItem
                  value="new-snapshot"
                  onClick={() => {/* TODO: create snapshot */}}
                  px={3}
                  py={1.5}
                  borderRadius="sm"
                  _hover={{ bg: 'bg.muted' }}
                  cursor="pointer"
                >
                  <HStack gap={1.5}>
                    <LuPlus size={12} />
                    <Text fontSize="xs" fontFamily="mono" fontWeight="600">
                      New Snapshot
                    </Text>
                  </HStack>
                </MenuItem>
              </MenuContent>
            </MenuPositioner>
          </Portal>
        </MenuRoot>
        {editMode && currentView === 'dashboard' && layoutableAssets.length > 0 && (
          <IconButton
            onClick={() => addPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            aria-label="Add content"
            variant="subtle"
            size="xs"
            px={2}
          >
            <LuPlus size={14} />
            Add content
          </IconButton>
        )}
      </>
    );
    return () => setActions(null);
  }, [editMode, slides.length, layoutableAssets.length, setActions, dashboardVersion, currentView]);

  // Memoize the grid items (questions + text blocks) to prevent re-rendering on every keystroke
  const gridItems = useMemo(() => {
    const paramHighlightedIds = hoveredParamKey ? (paramToQuestionIds.get(hoveredParamKey) ?? []) : null;

    return layoutableAssets.map((asset, index) => {
      const key = getAssetLayoutKey(asset);

      if (asset.type === 'question') {
        const questionId = (asset as { id: number }).id;

        // Publish-mode highlights take priority over param-hover highlights
        const publishMark = publishHighlights?.get(questionId);
        let borderColor: string;
        let opacity: number;
        if (publishHighlights !== null) {
          // Publish context active: color by add/move/unchanged
          if (publishMark === 'added') {
            borderColor = 'accent.teal';
            opacity = 1;
          } else if (publishMark === 'edited') {
            borderColor = 'accent.warning';
            opacity = 1;
          } else if (publishMark === 'moved') {
            borderColor = 'accent.primary';
            opacity = 1;
          } else {
            borderColor = 'border.subtle';
            opacity = 1;
          }
        } else {
          // Normal param-hover highlighting
          const isHighlighted = paramHighlightedIds ? paramHighlightedIds.includes(questionId) : null;
          borderColor = isHighlighted === true ? 'accent.teal' : isHighlighted === false ? 'border.subtle' : 'border.default';
          opacity = isHighlighted === false ? 0.5 : 1;
        }

        return (
          <Box
            key={key}
            bg="bg.subtle"
            borderWidth={publishMark ? '2px' : '1px'}
            borderColor={borderColor}
            borderRadius="md"
            opacity={opacity}
            overflow="hidden"
            display="flex"
            flexDirection="column"
            transition="all 0.2s"
          >
            <SmartEmbeddedQuestionContainer
              questionId={questionId}
              externalParameters={parameterValuesForDisplay}
              externalParamValues={effectiveSubmittedValues}
              showTitle={true}
              editMode={editMode}
              index={index}
              dashboardId={fileId}
              onEdit={() => dispatch(pushView({ type: 'question', fileId: questionId, dashboardId: fileId, dashboardParamValues: effectiveSubmittedValues }))}
              onRemove={() => handleRemoveAsset(questionId.toString())}
            />
          </Box>
        );
      }

      // Divider
      if (asset.type === 'divider') {
        return (
          <Box
            key={key}
            display="flex"
            alignItems="center"
            height="100%"
            bg={editMode ? 'bg.subtle' : 'transparent'}
            borderRadius={editMode ? 'md' : undefined}
            borderWidth={editMode ? '1px' : undefined}
            borderColor={editMode ? 'border.default' : undefined}
            px={editMode ? 0 : 4}
          >
            {editMode && (
              <HStack
                className="drag-handle"
                cursor="move"
                px={2}
                flexShrink={0}
                height="100%"
                alignItems="center"
              >
                <LuGripVertical size={14} opacity={0.5} />
              </HStack>
            )}
            <Box flex={1} borderTopWidth="1px" borderColor="border.emphasized" />
            {editMode && (
              <IconButton
                onClick={() => handleRemoveAsset(key)}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Remove divider"
                size="2xs"
                variant="ghost"
                color="fg.muted"
                cursor="pointer"
                mx={2}
                _hover={{ color: 'accent.danger' }}
              >
                <LuX size={12} />
              </IconButton>
            )}
          </Box>
        );
      }

      // Text block
      const textAsset = asset as InlineAsset;
      const isExpanded = expandedHeights.has(key);
      return (
        <Box
          key={key}
          bg="bg.subtle"
          borderWidth="1px"
          borderColor="border.default"
          borderRadius="md"
          overflow={isExpanded ? 'visible' : 'hidden'}
          display="flex"
          flexDirection="column"
        >
          <TextBlockCard
            id={textAsset.id || ''}
            content={textAsset.content || ''}
            editMode={editMode}
            onContentChange={(id, content) => {
              dispatch(updateTextBlockContent({ dashboardId: fileId, textBlockId: id, content }));
            }}
            onRemove={(id) => handleRemoveAsset(id)}
            onResize={handleTextBlockResize}
          />
        </Box>
      );
    });
  }, [layoutableAssets, editMode, handleRemoveAsset, parameterValuesForDisplay, effectiveSubmittedValues, hoveredParamKey, paramToQuestionIds, fileId, dispatch, publishHighlights, expandedHeights, handleTextBlockResize]);

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
    <Box flex="1" data-file-id={fileId} role="region" aria-label="Dashboard">

      {/* JSON View */}
      {activeTab === 'json' && (
        <JsonEditor
          value={JSON.stringify(document, null, 2)}
          onChange={(value) => {
            // TODO: Handle JSON edits
          }}
        />
      )}

      {/* Dock view: the master asset repository */}
      {activeTab === 'visual' && currentView === 'dock' && (
        <Box pt={2}>
          <DockView
            assets={document?.assets || []}
            layout={document?.layout}
            report={document?.report}
            deck={document?.deck}
            onRemoveAsset={handleRemoveAsset}
            onOpenQuestion={(questionId) => dispatch(pushView({ type: 'question', fileId: questionId, dashboardId: fileId, dashboardParamValues: effectiveSubmittedValues }))}
          />
        </Box>
      )}

      {/* Report view: a Google-Docs-style document of text + charts.
          Negative margins bleed the gray canvas past the FileLayout padding. */}
      {activeTab === 'visual' && currentView === 'report' && (
        <Box mx={{ base: -4, md: -8, lg: -12 }}>
          <ReportDocView
            report={document?.report}
            editMode={editMode}
            assets={document?.assets || []}
            onChange={(serialized) => editFile({ fileId, changes: { content: { report: serialized } } })}
          />
        </Box>
      )}

      {/* Presentation view: a slide deck of text + charts. */}
      {activeTab === 'visual' && currentView === 'presentation' && (
        <Box mx={{ base: -4, md: -8, lg: -12 }}>
          <DeckView
            deck={document?.deck || []}
            editMode={editMode}
            assets={document?.assets || []}
            onChange={(changes) => editFile({ fileId, changes: { content: changes } })}
          />
        </Box>
      )}

      {/* Visual View */}
      {activeTab === 'visual' && currentView === 'dashboard' && (
        <>
          {/* Dashboard-level Parameters */}
          {parameterValuesForDisplay.length > 0 && (
            <Box mb={4}>
              <ParameterRow
                parameters={parameterValuesForDisplay}
                parameterValues={localParamValues}
                lastSubmittedValues={effectiveSubmittedValues}
                onValueChange={(paramName, value) => {
                  setLocalParamValues(prev => ({ ...prev, [paramName]: value }));
                }}
                onSubmit={(newParamValues) => {
                  // Update lastExecuted.params to trigger execution
                  dispatch(setEphemeral({
                    fileId,
                    changes: {
                      lastExecuted: { query: '', params: newParamValues, database: '', references: [] }
                    }
                  }));
                  // In edit mode: persist to dirty state (saveable with Update)
                  // Outside edit mode: ephemeral only (no dirty, no save needed)
                  if (editMode) {
                    editFile({ fileId, changes: { content: { parameterValues: newParamValues } } });
                  }
                }}
                disableTypeChange={true}
                onHoverParam={setHoveredParamKey}
                database={dashboardDatabase}
              />
            </Box>
          )}

          {/* Grid Layout */}
          <Box position="relative" maxW="100%" pb={30} minH={"100%"}>
            {gridBackground}

            {layoutableAssets.length > 0 ? (
              <ResponsiveGridLayout
                key={`grid-v${gridVersion}`}
                className="layout"
                layouts={effectiveLayouts}
                breakpoints={{ lg: 1024, md: 768, sm: 0 }}
                cols={{ lg: 12, md: 12, sm: 6 }}
                rowHeight={GRID_ROW_HEIGHT}
                compactType="vertical"
                onBreakpointChange={(_breakpoint, cols) => setCurrentCols(cols)}
                onDragStop={handleLayoutChange}
                onResizeStop={handleLayoutChange}
                draggableHandle=".drag-handle"
                containerPadding={[0, 0]}
                margin={[GRID_MARGIN, GRID_MARGIN]}
                isDraggable={editMode}
                isResizable={editMode}
              >
                {gridItems}
              </ResponsiveGridLayout>
            ) : !editMode ? (
              <Box
                bg="bg.surface"
                p={16}
                borderRadius="lg"
                border="2px dashed"
                borderColor="border.muted"
                textAlign="center"
                minHeight="400px"
              >
                <Box mb={4} display="inline-block">
                  {(() => {
                    const QuestionIcon = getFileTypeMetadata('question').icon;
                    return <QuestionIcon size={96} strokeWidth={1.5} style={{ opacity: 0.3 }} />;
                  })()}
                </Box>
                <Text fontSize="2xl" fontWeight="700" mb={3} color="fg.default">
                  This dashboard is empty
                </Text>
                <Text color="fg.muted" fontSize="md" maxW="md" mx="auto">
                  Add questions, or just ask {agentName} to do it!
                </Text>
              </Box>
            ) : (
              <Box position="relative" minHeight="1500px">
                {/* Empty state overlay for edit mode - question browser + text block */}
                <Box
                  position="absolute"
                  top="5%"
                  left="50%"
                  transform="translateX(-50%)"
                  maxW="500px"
                  width="100%"
                >
                  <QuestionBrowserPanel
                    folderPath={folderPath}
                    onAddQuestion={(questionId) => {
                      dispatch(addQuestionToDashboard({ dashboardId: fileId, questionId }));
                    }}
                    onAddTextBlock={() => dispatch(addTextBlockToDashboard({ dashboardId: fileId }))}
                    onAddDivider={() => dispatch(addDividerToDashboard({ dashboardId: fileId }))}
                    excludedIds={questionIds}
                    title="Add questions / text"
                    dashboardId={fileId}
                  />
                </Box>
              </Box>
            )}

            {/* Add Questions/Text Panel - after last card in edit mode */}
            {editMode && layoutableAssets.length > 0 && (
              <Box mt={4} position="relative" zIndex={10} ref={addPanelRef}>
                <QuestionBrowserPanel
                  folderPath={folderPath}
                  onAddQuestion={(questionId) => {
                    dispatch(addQuestionToDashboard({ dashboardId: fileId, questionId }));
                  }}
                  onAddTextBlock={() => dispatch(addTextBlockToDashboard({ dashboardId: fileId }))}
                  onAddDivider={() => dispatch(addDividerToDashboard({ dashboardId: fileId }))}
                  excludedIds={questionIds}
                  title="Add content"
                  dashboardId={fileId}
                />
              </Box>
            )}
          </Box>

        </>
      )}

      {/* Presentation overlay */}
      {isPresenting && (
        <PresentationOverlay
          slides={slides}
          fileId={fileId}
          onClose={() => setIsPresenting(false)}
          paramValues={effectiveSubmittedValues}
        />
      )}

      {/* Report overlay */}
      {isReporting && (
        <ReportOverlay
          slides={slides}
          fileId={fileId}
          onClose={() => setIsReporting(false)}
          paramValues={effectiveSubmittedValues}
        />
      )}
    </Box>
  );
}

/** A single segment in the header view switcher (Dock / Dashboard / Report / Present). */
function ViewSwitchSegment({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <HStack
      as="button"
      onClick={onClick}
      aria-label={label}
      gap={1}
      px={2}
      py={0.5}
      borderRadius="full"
      cursor="pointer"
      transition="all 0.12s"
      bg={active ? 'bg.surface' : 'transparent'}
      boxShadow={active ? 'xs' : undefined}
      color={active ? 'fg.default' : 'fg.muted'}
      _hover={{ color: 'fg.default', bg: active ? 'bg.surface' : 'bg.subtle' }}
    >
      {icon}
      <Text fontSize="xs" fontWeight={active ? 700 : 500} fontFamily="mono">
        {label}
      </Text>
    </HStack>
  );
}
