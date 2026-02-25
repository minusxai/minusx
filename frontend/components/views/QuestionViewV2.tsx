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
import {
  Box,
  Text,
  IconButton,
  HStack,
  VStack,
  Code,
} from '@chakra-ui/react';
import {
  LuChevronDown,
  LuChevronUp,
  LuChevronLeft,
  LuChevronRight,
  LuSparkles,
  LuX,
  LuGripVertical,
} from 'react-icons/lu';
import { QuestionContent, QuestionParameter } from '@/lib/types';
import SqlEditor from '../SqlEditor';
import ParameterRow from '../ParameterRow';
import DatabaseSelector from '../DatabaseSelector';
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import { syncReferencesWithSQL } from '@/lib/sql/sql-references';
import { useAvailableQuestions } from '@/lib/hooks/useAvailableQuestions';
import { useContext as useSchemaContext } from '@/lib/hooks/useContext';
import JsonEditor from '../slides/JsonEditor';
import { QuestionVisualization } from '../question/QuestionVisualization';
import { useConfigs } from '@/lib/hooks/useConfigs';
import QuestionPickerModal from '../modals/QuestionPickerModal';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { addReferenceToQuestion, removeReferenceFromQuestion, setFile } from '@/store/filesSlice';
import { setSqlEditorCollapsed, selectSqlEditorCollapsed, setQuestionCollapsedPanel, selectQuestionCollapsedPanel, selectFileEditMode, selectFileViewMode } from '@/store/uiSlice';
import { QueryBuilder, QueryModeSelector } from '../query-builder';

/**
 * Props for QuestionViewV2
 */
interface QuestionViewV2Props {
  viewMode: 'page' | 'toolcall';   // Full view or compact view (for toolcall)
  // Content (merged: content + persistableChanges + ephemeralChanges)
  content: QuestionContent;
  filePath?: string;               // File path for context lookup (schema autocomplete)
  questionId?: number;             // Question ID (also used to read editMode from Redux)

  // Query result (from useQueryResult hook in container)
  queryData: any | null;           // Query result data (columns + rows)
  queryLoading: boolean;           // Currently fetching
  queryError: string | null;       // Query execution error
  queryStale: boolean;             // Data exists but is being refetched

  // Content-only state/handlers (header state lives in FileHeader via Redux)
  proposedQuery?: string;          // Proposed query for diff view (from pending confirmation)

  // Ephemeral parameter state
  ephemeralParamValues?: Record<string, any>;
  lastSubmittedParamValues?: Record<string, any>;

  // Original (saved) query for diff display in preview mode
  originalQuery?: string;

  // Container mode: 'preview' forces read-only with SQL diff
  mode?: 'view' | 'create' | 'preview';

  // Handlers
  onChange: (updates: Partial<QuestionContent>) => void;
  onParameterValueChange?: (paramName: string, value: string | number) => void;  // Ephemeral
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
  ephemeralParamValues,
  lastSubmittedParamValues,
  proposedQuery,
  originalQuery,
  mode = 'view',
  onChange,
  onParameterValueChange,
  onExecute,
}: QuestionViewV2Props) {
  const fullMode = viewMode === 'page';
  const isPreview = mode === 'preview';
  const { config } = useConfigs();
  const agentName = config.branding.agentName;

  // Get schema data for SQL autocomplete
  const { databases: schemaData } = useSchemaContext(filePath || '/org');

  // SQL editor collapsed state — persisted in Redux per question so it survives navigation.
  // Default: open in page mode, collapsed in toolcall/embedded mode.
  const sqlEditorCollapsed = useAppSelector(
    state => selectSqlEditorCollapsed(state, questionId, !fullMode)
  );
  // editMode and viewMode sourced from Redux (managed by FileHeader)
  const reduxEditMode = useAppSelector(state => selectFileEditMode(state, questionId ?? -1));
  const editMode = isPreview ? false : reduxEditMode;
  const activeTab = useAppSelector(state => selectFileViewMode(state, questionId));
  const [containerWidth, setContainerWidth] = useState(0);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const [showQuestionPicker, setShowQuestionPicker] = useState(false);
  const [sqlPreviewId, setSqlPreviewId] = useState<number | null>(null);

  // Resizable panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(45); // percentage
  const [isResizing, setIsResizing] = useState(false);
  const collapsedPanel = useAppSelector(selectQuestionCollapsedPanel);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(45);
  const rafRef = useRef<number | null>(null);
  const dispatch = useAppDispatch();

  const handleSqlEditorToggle = useCallback(() => {
    if (questionId !== undefined) {
      dispatch(setSqlEditorCollapsed({ fileId: questionId, collapsed: !sqlEditorCollapsed }));
    }
  }, [dispatch, questionId, sqlEditorCollapsed]);

  // Query mode state (SQL or GUI)
  const [queryMode, setQueryMode] = useState<'sql' | 'gui'>('sql');
  const [guiError, setGuiError] = useState<string | null>(null);
  const [canUseGUI, setCanUseGUI] = useState(true);

  // Get files state for referenced questions
  const filesState = useAppSelector(state => state.files.files);

  // Memoize referencedQuestions to avoid unnecessary re-renders
  const referencedQuestions = useMemo(() => {
    const refs = content.references || [];
    return refs.map(ref => ({
      ...ref,
      question: filesState[ref.id]
    }));
  }, [content.references, filesState]);

  // Get available questions for inline @reference autocomplete
  const { questions: availableQuestions } = useAvailableQuestions(
    questionId,
    content.database_name,
    referencedQuestions.map(r => r.id)
  );

  // Load referenced questions into Redux
  useEffect(() => {
    const referencedIds = content.references?.map(ref => ref.id) || [];
    if (referencedIds.length === 0) return;

    // Check which questions need to be loaded
    const missingIds = referencedIds.filter(id => {
      const file = referencedQuestions.find(r => r.id === id)?.question;
      return !file || !file.content;
    });

    if (missingIds.length === 0) return;

    // Load missing questions
    import('@/lib/data/files').then(({ FilesAPI }) => {
      FilesAPI.loadFiles(missingIds).then(result => {
        result.data.forEach(file => {
          dispatch(setFile({ file, references: [] }));
        });
      }).catch(err => {
        console.error('[QuestionViewV2] Failed to load referenced questions:', err);
      });
    });
  }, [content.references, referencedQuestions, dispatch]);

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

  // Use compact layout when container is narrow (< 700px) - stacked vertical layout
  const useCompactLayout = (containerWidth > 0 && containerWidth < 700) || !fullMode;

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
      const newWidth = Math.max(25, Math.min(65, resizeStartWidth.current + deltaPercent));
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

  // Handle parameter value change — ephemeral (not persisted)
  const handleParameterValueChange = (paramName: string, value: string | number) => {
    if (onParameterValueChange) {
      onParameterValueChange(paramName, value);
    }
  };

  // Handle set default — persistable (updates parameter's defaultValue via onChange)
  const handleSetDefault = (paramName: string, value: string | number | undefined) => {
    const updatedParams = (content.parameters || []).map(p =>
      p.name === paramName ? { ...p, defaultValue: value ?? null } : p
    );
    onChange({ parameters: updatedParams });
  };

  // Handle parameter submit (when user presses Enter or clicks Run)
  const handleParametersSubmit = (paramValues: Record<string, any>) => {
    onExecute(paramValues);
  };

  // Handle database change
  const handleDatabaseChange = (database: string) => {
    onChange({ database_name: database });
  };

  // Handle viz type change
  const handleVizTypeChange = (type: 'table' | 'line' | 'bar' | 'area' | 'scatter' | 'funnel' | 'pie' | 'pivot' | 'trend') => {
    onChange({ vizSettings: { ...content.vizSettings, type } });
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

  // Handle pivot config change
  const handlePivotConfigChange = (pivotConfig: import('@/lib/types').PivotConfig) => {
    onChange({ vizSettings: { ...content.vizSettings, pivotConfig } });
  };

  // Handle column formats change
  const handleColumnFormatsChange = (columnFormats: Record<string, import('@/lib/types').ColumnFormatConfig>) => {
    onChange({ vizSettings: { ...content.vizSettings, columnFormats } });
  };

  // Handle adding a question reference
  const handleAddReference = (referencedQuestionId: number, alias: string) => {
    if (!questionId) return;
    dispatch(addReferenceToQuestion({
      questionId,
      referencedQuestionId,
      alias
    }));
  };

  // Handle removing a question reference
  const handleRemoveReference = (referencedQuestionId: number) => {
    if (!questionId) return;
    dispatch(removeReferenceFromQuestion({
      questionId,
      referencedQuestionId
    }));
  };

  // Merge parameters from current question + referenced questions
  const parameters = useMemo(() => {
    const currentParams = content.parameters || [];

    // Extract parameters from referenced questions
    const referencedParams: QuestionParameter[] = [];
    referencedQuestions.forEach(ref => {
      const refContent = ref.question?.content as QuestionContent;
      if (refContent?.parameters) {
        refContent.parameters.forEach(param => {
          // Only add if not already present (same name + type)
          const exists = currentParams.some(p => p.name === param.name && p.type === param.type);
          const alreadyAdded = referencedParams.some(p => p.name === param.name && p.type === param.type);
          if (!exists && !alreadyAdded) {
            referencedParams.push(param);
          }
        });
      }
    });

    // Return merged list: current params first, then referenced params
    return [...currentParams, ...referencedParams];
  }, [content.parameters, referencedQuestions]);

  // Handle query execution (Run button / Cmd+Enter)
  // Build effective param values dict from ephemeral overrides + defaults
  const handleExecute = useCallback(() => {
    const paramValues: Record<string, any> = {};
    for (const p of parameters) {
      paramValues[p.name] = ephemeralParamValues?.[p.name] ?? p.defaultValue ?? '';
    }
    onExecute(paramValues);
  }, [onExecute, parameters, ephemeralParamValues]);

  // Handle query change with debounced param/ref sync
  const handleQueryChange = useCallback((newQuery: string) => {
    // Update query immediately for responsive typing
    onChange({ query: newQuery });

    // Debounce the param/ref sync (300ms)
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      const updatedRefs = syncReferencesWithSQL(newQuery, content.references || []);

      // Build composed SQL (current + referenced CTEs) to extract ALL parameters
      let composedSQL = newQuery;
      referencedQuestions.forEach(ref => {
        const refContent = ref.question?.content as QuestionContent;
        if (refContent?.query) {
          // Append referenced SQL to extract its parameters too
          composedSQL += '\n' + refContent.query;
        }
      });

      // Sync parameters from the FULL composed query (current + referenced)
      // Pass merged parameters to preserve user-set values
      const updatedParams = syncParametersWithSQL(composedSQL, parameters);

      onChange({ parameters: updatedParams, references: updatedRefs });
    }, 300);
  }, [onChange, content.parameters, content.references, parameters]);

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
        {/* JSON View */}
        {activeTab === 'json' && (
          <Box p={4}>
            <JsonEditor
              value={JSON.stringify(content, null, 2)}
              onChange={(value) => {
                // TODO: Handle JSON edits
                console.log('JSON changed:', value);
              }}
            />
          </Box>
        )}

        {/* Visual View */}
        {activeTab === 'visual' && (
        <Box
          display="flex"
          flexDirection={!useCompactLayout ? 'row' : 'column'}
          alignItems={!useCompactLayout ? 'stretch' : undefined}
          gap={0}
          h="100%"
          flex={1}
          overflow="hidden"
          minHeight="0"
        >

          {/* Question Picker Modal */}
          {questionId && (
            <QuestionPickerModal
              isOpen={showQuestionPicker}
              onClose={() => setShowQuestionPicker(false)}
              onSelect={handleAddReference}
              currentQuestionId={questionId}
              currentConnectionId={content.database_name}
              excludedIds={referencedQuestions.map(r => r.id)}
            />
          )}

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
              onClick={() => dispatch(setQuestionCollapsedPanel('none'))}
              _hover={{ bg: 'accent.teal/50' }}
              my={2}
              ml={2}
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
            overflow="hidden"
            my={!useCompactLayout ? 2 : 0}
            ml={!useCompactLayout ? 2 : 0}
          >
            {/* SQL Editor Section */}
            <Box
              borderBottomWidth={sqlEditorCollapsed && useCompactLayout ? "1px" : "0"}
              borderColor="border.muted"
              flex={!useCompactLayout && !sqlEditorCollapsed ? 1 : undefined}
              flexShrink={sqlEditorCollapsed ? 0 : undefined}
              display="flex"
              flexDirection="column"
              minHeight={0}
              overflow="hidden"
            >
            {<HStack
              px={4}
              py={2}
              _hover={{ bg: 'bg.muted' }}
              flexWrap="wrap"
              gap={2}
              flexShrink={0}
            >
              {/* Left side: Collapse toggle + Query label + Mode selector */}
              <HStack gap={3} align="center">
                <HStack
                  gap={2}
                  cursor="pointer"
                  align="center"
                  onClick={handleSqlEditorToggle}
                >
                  <Box color="fg.muted" fontSize="sm">
                    {sqlEditorCollapsed ? <LuChevronDown /> : <LuChevronUp />}
                  </Box>
                  <Text fontSize="sm" fontWeight="700">
                    Query
                  </Text>
                </HStack>
                {/* Query Mode Selector: SQL vs GUI - show when expanded */}
                {!sqlEditorCollapsed && (
                  <QueryModeSelector
                    mode={queryMode}
                    onModeChange={setQueryMode}
                    canUseGUI={true}
                  />
                )}
              </HStack>

              {/* Right side: Reference chips + Database selector */}
              <HStack gap={2} ml="auto" flexWrap="wrap" onClick={(e) => e.stopPropagation()}>
                {/* Reference chips (visible in both edit and view mode) */}
                {referencedQuestions.map(ref => {
                  const isSelected = sqlPreviewId === ref.id;
                  return (
                    <HStack
                      key={ref.id}
                      px={2}
                      py={1}
                      bg="transparent"
                      borderRadius="md"
                      border={isSelected ? '2px solid' : '1px solid'}
                      borderColor={isSelected ? 'accent.teal' : 'accent.secondary'}
                      gap={1}
                      cursor="pointer"
                      _hover={{ opacity: 0.85 }}
                      onClick={() => setSqlPreviewId(isSelected ? null : ref.id)}
                    >
                      <Code fontSize="xs" color="accent.secondary" bg="transparent" fontWeight="600">
                        @{ref.alias}
                      </Code>
                      {/* Remove button only in edit mode */}
                      {editMode && (
                        <IconButton
                          aria-label="Remove reference"
                          size="2xs"
                          variant="ghost"
                          color="accent.secondary"
                          _hover={{ bg: 'bg.muted' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveReference(ref.id);
                          }}
                        >
                          <LuX />
                        </IconButton>
                      )}
                    </HStack>
                  );
                })}

                {/* Database selector */}
                <DatabaseSelector
                  value={content.database_name || ''}
                  onChange={handleDatabaseChange}
                />
              </HStack>
            </HStack>
            }

            {!sqlEditorCollapsed && (
              <Box flex={1} minHeight={0} display="flex" flexDirection="column" overflow="hidden">
                {/* SQL Mode: Monaco Editor */}
                {queryMode === 'sql' && (
                  <SqlEditor
                    readOnly={isPreview || !fullMode}
                    value={isPreview ? (originalQuery ?? content.query) : content.query}
                    onChange={handleQueryChange}
                    onRun={handleExecute}
                    showRunButton={!isPreview}
                    showFormatButton={!isPreview}
                    isRunning={queryLoading && !queryData}
                    proposedValue={isPreview
                      ? (originalQuery !== content.query ? content.query : undefined)
                      : proposedQuery}
                    availableReferences={availableQuestions}
                    validReferenceAliases={referencedQuestions.map(r => r.alias)}
                    schemaData={schemaData}
                    resolvedReferences={referencedQuestions
                      .filter(r => r.question?.content)
                      .map(r => ({
                        id: r.id,
                        alias: r.alias,
                        query: (r.question!.content as QuestionContent).query
                      }))}
                    databaseName={content.database_name}
                    fillHeight={!useCompactLayout}
                  />
                )}

                {/* GUI Mode: Visual Query Builder */}
                {queryMode === 'gui' && (
                  <Box flex={1} overflow="auto">
                    <QueryBuilder
                      databaseName={content.database_name || ''}
                      sql={content.query}
                      onSqlChange={handleQueryChange}
                      onExecute={handleExecute}
                      isExecuting={queryLoading && !queryData}
                      availableQuestions={availableQuestions}
                    />
                  </Box>
                )}
              </Box>
            )}
          </Box>
          </Box>
          {/* End Left Panel */}

          {/* Resize Handle - Only in side-by-side mode */}
          {!useCompactLayout && collapsedPanel === 'none' && (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="16px"
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
                  onClick={() => dispatch(setQuestionCollapsedPanel('left'))}
                  onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
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
                  onClick={() => dispatch(setQuestionCollapsedPanel('right'))}
                  onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
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
              onClick={() => dispatch(setQuestionCollapsedPanel('none'))}
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
            my={!useCompactLayout ? 2 : 0}
            mr={!useCompactLayout ? 2 : 0}
          >
            {/* SQL Preview - shows when reference chip is clicked */}
            {parameters.length > 0 && (
              <ParameterRow
                parameters={parameters}
                parameterValues={ephemeralParamValues}
                lastSubmittedValues={lastSubmittedParamValues}
                onValueChange={handleParameterValueChange}
                onSubmit={handleParametersSubmit}
                onParametersChange={handleParametersStructuralChange}
                onSetDefault={handleSetDefault}
              />
            )}
            {sqlPreviewId ? (
              <Box p={4} flex={1} overflow="auto">
                <HStack justify="space-between" mb={3}>
                  <HStack gap={2}>
                    <Text fontSize="sm" fontWeight="600" color="fg.muted">
                      Preview
                    </Text>
                    <Code fontSize="sm" colorPalette="teal" px={2} py={0.5} borderRadius="md">
                      #{sqlPreviewId}
                    </Code>
                    <Text fontSize="sm" fontWeight="600">
                      {referencedQuestions.find(r => r.id === sqlPreviewId)?.question?.name || 'Loading...'}
                    </Text>
                  </HStack>
                  <IconButton
                    aria-label="Close preview"
                    size="xs"
                    variant="ghost"
                    onClick={() => setSqlPreviewId(null)}
                  >
                    <LuX />
                  </IconButton>
                </HStack>
                <SqlEditor
                  readOnly
                  value={
                    referencedQuestions.find(r => r.id === sqlPreviewId)?.question?.content
                      ? (referencedQuestions.find(r => r.id === sqlPreviewId)?.question?.content as QuestionContent).query
                      : '-- Loading...'
                  }
                  showFormatButton={false}
                  showRunButton={false}
                />
              </Box>
            ) : !content.query?.trim() && !queryData ? (
              /* Empty state when no query written yet */
              <Box
                flex="1"
                display="flex"
                alignItems="center"
                justifyContent="center"
                bg="bg.canvas"
                borderRadius="lg"
              >
                <VStack gap={4}>
                  <LuSparkles size={48} color="var(--chakra-colors-accent-teal)" opacity="0.5" />
                  <Text
                    color="fg.muted"
                    fontSize="lg"
                    fontWeight="600"
                    letterSpacing="-0.01em"
                  >
                    What do you want to investigate?
                  </Text>
                  <Text
                    color="fg.subtle"
                    fontSize="sm"
                    textAlign="center"
                    maxW="300px"
                  >
                    Write a SQL query or just ask {agentName} to do it!
                  </Text>
                </VStack>
              </Box>
            ) : (
              <QuestionVisualization
                currentState={content}
                config={{
                  showHeader: fullMode,
                  showJsonToggle: false,
                  editable: editMode,
                  viz: {
                    showTypeButtons: true,
                    showChartBuilder: true,
                    // Always use horizontal (compact) to hide column sidebar - cleaner in side-by-side
                    typesButtonsOrientation: 'horizontal'
                  },
                  fixError: true
                }}
                loading={queryLoading && !queryData}
                error={queryError}
                data={queryData}
                onVizTypeChange={handleVizTypeChange}
                onAxisChange={handleAxisChange}
                onPivotConfigChange={handlePivotConfigChange}
                onColumnFormatsChange={handleColumnFormatsChange}
              />
            )}
          </Box>
        </Box>
        )}
      </Box>
    </Box>
  );
}
