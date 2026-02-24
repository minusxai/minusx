'use client';

import { Box, Text, HStack } from '@chakra-ui/react';
import { AssetReference, DocumentContent, QuestionContent, QuestionParameter } from '@/lib/types';
import SmartEmbeddedQuestionContainer from '../containers/SmartEmbeddedQuestionContainer';
import ParameterRow from '../ParameterRow';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Layout, WidthProvider, Responsive } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import JsonEditor from '../slides/JsonEditor';
import DocumentHeader from '../DocumentHeader';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent } from '@/store/filesSlice';
import { openFileModal } from '@/store/uiSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import { shallowEqual } from 'react-redux';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface DashboardViewProps {
  // Data props (all from Redux via smart component)
  document: DocumentContent;
  fileName: string;  // File name (separate from content)
  folderPath: string;
  isDirty: boolean;
  isSaving: boolean;
  saveError?: string | null;
  fileId: number;  // File ID for Redux operations

  // State (controlled by container)
  editMode: boolean;

  // Callback props
  onChange: (updates: Partial<DocumentContent>) => void;
  onMetadataChange: (changes: { name?: string }) => void; // Phase 5: Metadata editing
  onSave: () => Promise<void>;
  onRevert: () => void;
  onEditModeChange: (editMode: boolean) => void;
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

// Generate default layout for assets (only question assets are positioned in grid)
const generateDefaultLayout = (assets: AssetReference[]): Layout[] => {
  const questionAssets = assets?.filter(asset => asset.type === 'question' && ('id' in asset) && asset.id) || [];
  return questionAssets?.map((asset, i) => ({
    i: ('id' in asset && asset.type === 'question') ? asset.id.toString() : '',  // Convert integer ID to string for grid layout
    x: (i % 2) * 6, // 2 columns
    y: Math.floor(i / 2) * 6,
    w: 6,
    h: 6,
    minW: 3,
    minH: 3,
  }));
};

export default function DashboardView({
  document,
  fileName,
  folderPath,
  isDirty,
  isSaving,
  saveError,
  fileId,
  editMode,
  onChange,
  onMetadataChange,
  onSave,
  onRevert,
  onEditModeChange
}: DashboardViewProps) {
  const dispatch = useAppDispatch();

  // Tab switcher for visual/json view
  const [activeTab, setActiveTab] = useState<'visual' | 'json'>('visual');

  // Track current columns for responsive grid background
  const [currentCols, setCurrentCols] = useState(12);

  // Read parameter values from Redux ephemeral state
  const savedParamValues = useAppSelector(state => {
    const mergedContent = selectMergedContent(state, fileId) as DocumentContent;
    return mergedContent?.parameterValues || {};
  });

  // Get agent name from config
  const { config } = useConfigs();
  const agentName = config.branding.agentName;

  const questionCount = document?.assets?.filter(a => a.type === 'question').length || 0;

  // Compute layouts for all breakpoints from document
  // Desktop layout (12 cols) is the source of truth, mobile layouts are scaled
  const layouts = useMemo(() => {
    if (!document) return { lg: [], md: [], sm: [], xs: [], xxs: [] };

    let baseLayout: Layout[];
    if (document.layout?.items) {
      baseLayout = document.layout.items.map((item: any) => ({
        i: String(item.id),
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: 3,
        minH: 3,
      }));
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
  }, [document?.layout, document?.assets]);

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
  const mergedParameters = useMemo(() => {
    const paramMap = new Map<string, QuestionParameter>();

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
        });
      }
    });

    return Array.from(paramMap.values());
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

  // Merge parameter structure (from questions) with saved values (from Redux)
  const parameterValuesForDisplay = useMemo(() => {
    return mergedParameters.map(param => ({
      ...param,
      value: savedParamValues[param.name] ?? param.value  // Saved value or question default
    }));
  }, [mergedParameters, savedParamValues]);

  // Handler for removing questions (needs to be defined before questionGridItems)
  const handleRemoveQuestion = useCallback((questionIdStr: string) => {
    if (!document?.assets) return;

    const questionId = parseInt(questionIdStr, 10);

    // Remove from assets
    const updatedAssets = document.assets.filter(
      asset => {
        if (asset.type !== 'question') return true;
        const fileRef = asset as { type: 'question'; id: number; slug?: string };
        return fileRef.id !== questionId;
      }
    );

    // Remove from layout
    const existingLayout = document.layout?.items || [];
    const updatedLayoutItems = existingLayout.filter((item: any) => item.id !== questionIdStr);

    const updatedLayout = {
      columns: 12,
      items: updatedLayoutItems
    };

    onChange({
      assets: updatedAssets,
      layout: updatedLayout
    });
  }, [document?.assets, document?.layout?.items, onChange]);

  // Memoize the grid background to prevent re-rendering on every keystroke
  const gridBackground = useMemo(() => {
    if (!editMode) return null;

    const minHeight = 1500;
    const rowHeight = 92;
    const cols = currentCols; // Use responsive column count
    const maxLayoutRow = layouts.lg.reduce((max: number, item: Layout) => Math.max(max, item.y + item.h), 0);
    const minRows = Math.ceil(minHeight / rowHeight);
    const numRows = Math.max(minRows, maxLayoutRow + 10);

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
              top={`${row * 92}px`}
              width={`${colWidthPercent}%`}
              height="92px"
              p="6px"
              pointerEvents="none"
            >
              <Box
                width="100%"
                height="100%"
                border="1px solid"
                borderColor="border.muted"
                borderRadius="md"
                bg="bg.muted"
              />
            </Box>
          );
        })}
      </Box>
    );
  }, [editMode, layouts.lg, currentCols]);

  // Memoize the question grid items to prevent re-rendering on every keystroke
  const questionGridItems = useMemo(() => {
    const highlightedIds = hoveredParamKey ? (paramToQuestionIds.get(hoveredParamKey) ?? []) : null;

    return questionIds?.map((questionId, index) => {
      const isHighlighted = highlightedIds ? highlightedIds.includes(questionId) : null;

      return (
        <Box
          key={questionId || index}
          bg="bg.surface"
          borderWidth={editMode ? '2px' : '1px'}
          borderColor={
            editMode ? 'accent.teal' :
            isHighlighted === true ? 'accent.teal' :
            isHighlighted === false ? 'border.subtle' :
            'border.default'
          }
          borderRadius="md"
          shadow={editMode ? 'lg' : 'sm'}
          boxShadow={
            editMode ? '0 0 20px rgba(22, 160, 133, 0.3)' :
            isHighlighted === true ? '0 0 12px rgba(22, 160, 133, 0.35)' :
            undefined
          }
          opacity={isHighlighted === false ? 0.5 : 1}
          overflow="hidden"
          display="flex"
          flexDirection="column"
          transition="all 0.2s"
        >
          <SmartEmbeddedQuestionContainer
            questionId={questionId}
            externalParameters={parameterValuesForDisplay}
            showTitle={true}
            editMode={editMode}
            index={index}
            onEdit={editMode ? () => dispatch(openFileModal(questionId)) : undefined}
            onRemove={() => handleRemoveQuestion(questionId.toString())}
          />
        </Box>
      );
    });
  }, [questionIds, editMode, handleRemoveQuestion, parameterValuesForDisplay, hoveredParamKey, paramToQuestionIds]);

  const handleLayoutChange = (newLayout: Layout[]) => {
    if (!document) return;

    // Update the layout in current state
    const updatedLayout = {
      columns: 12,
      items: newLayout.map(item => ({
        id: Number(item.i),
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }))
    };

    onChange({ layout: updatedLayout });
  };

  const handleSave = async () => {
    try {
      await onSave();
      onEditModeChange(false);
    } catch (error) {
      console.error('Failed to save dashboard:', error);
    }
  };

  const handleCancel = () => {
    onRevert();
    onEditModeChange(false);
  };

  return (
    <Box flex="1" data-file-id={fileId}>
      {/* Header with Title, Description, and Badges */}
      <Box>
        <DocumentHeader
          name={fileName}
          description={document?.description}
          fileType="dashboard"
          editMode={editMode}
          isDirty={isDirty}
          isSaving={isSaving}
          saveError={saveError}
          onNameChange={(name) => onMetadataChange({ name })}
          onDescriptionChange={(description) => onChange({ description })}
          onEditModeToggle={() => {
            if (editMode) {
              handleCancel();
            } else {
              onEditModeChange(true);
            }
          }}
          onSave={handleSave}
          viewMode={activeTab}
          onViewModeChange={(mode) => setActiveTab(mode)}
          additionalBadges={
            <HStack
              gap={1}
              fontFamily="mono"
              fontSize="2xs"
              fontWeight="600"
              color="fg.default"
              px={1.5}
              py={0.5}
              bg="bg.elevated"
              borderRadius="sm"
              border="1px solid"
              borderColor="border.default"
              flexShrink={0}
            >
              <Text>{questionCount.toString().padStart(2, '0')}</Text>
              <Text color="fg.muted">{questionCount !== 1 ? 'questions' : 'question'}</Text>
            </HStack>
          }
        />
      </Box>

      {/* JSON View */}
      {activeTab === 'json' && (
        <JsonEditor
          value={JSON.stringify(document, null, 2)}
          onChange={(value) => {
            // TODO: Handle JSON edits
          }}
        />
      )}

      {/* Visual View */}
      {activeTab === 'visual' && (
        <>
          {/* Dashboard-level Parameters */}
          {parameterValuesForDisplay.length > 0 && (
            <Box mb={4}>
              <ParameterRow
                parameters={parameterValuesForDisplay}
                onSubmit={(updatedParams) => {
                  // Convert array to dict: [{name, value}] → {name: value}
                  const valuesDict = updatedParams.reduce((acc, p) => ({
                    ...acc,
                    [p.name]: p.value
                  }), {} as Record<string, any>);

                  // Update via onChange callback
                  onChange({ parameterValues: valuesDict });
                }}
                disableTypeChange={true}
                onHoverParam={setHoveredParamKey}
              />
            </Box>
          )}

          {/* Grid Layout */}
          <Box position="relative" maxW="100%" pb={30}>
            {gridBackground}

            {questionIds.length > 0 ? (
              <ResponsiveGridLayout
                className="layout"
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
                margin={[10, 10]}
                isDraggable={editMode}
                isResizable={editMode}
                style={{ minHeight: editMode ? '1500px' : 'auto' }}
              >
                {questionGridItems}
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
                {/* Empty state overlay for edit mode */}
                <Box
                  position="absolute"
                  top="20%"
                  left="50%"
                  transform="translate(-50%, -50%)"
                  bg="bg.elevated/75"
                  p={8}
                  borderRadius="lg"
                  border="2px dashed"
                  borderColor="border.muted"
                  textAlign="center"
                >
                  <Box mb={4} display="inline-block">
                    {(() => {
                      const QuestionIcon = getFileTypeMetadata('question').icon;
                      return <QuestionIcon size={64} strokeWidth={1.5} style={{ opacity: 0.3 }} />;
                    })()}
                  </Box>
                  <Text fontSize="lg" fontWeight="600" mb={2} color="fg.default">
                    Add questions to the dashboard
                  </Text>
                  <Text color="fg.muted" fontSize="sm" maxW="sm">
                    Use sidebar to add questions, or just ask {agentName} to do it!
                  </Text>
                </Box>
              </Box>
            )}
          </Box>
        </>
      )}

    </Box>
  );
}
