'use client';

// cSpell:ignore chakra
import { Box, Text, HStack, IconButton, VStack, Heading, Input } from '@chakra-ui/react';
import { useState, useEffect, useRef } from 'react';
import SlideCanvas from '@/components/slides/SlideCanvas';
import JsonEditor from '@/components/slides/JsonEditor';
import ShapePropertiesPanel from '@/components/slides/ShapePropertiesPanel';
import type { AssetReference, Rectangle, PresentationSlide, DocumentContent } from '@/lib/types';
import TabSwitcher from '@/components/TabSwitcher';
import { LuPencil, LuCode, LuSave, LuEye, LuChevronDown, LuChevronUp, LuScanSearch, LuSettings, LuPlus, LuTriangleAlert } from 'react-icons/lu';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { QuestionBrowserPanel } from '@/components/QuestionBrowserPanel';

interface PresentationViewProps {
  // Data props (all from Redux via smart component)
  document: DocumentContent;
  fileName: string;  // File name (separate from content)
  folderPath: string;
  isDirty: boolean;
  isSaving: boolean;
  saveError?: string | null;

  // State (controlled by container)
  editMode: boolean;

  // Callback props
  onChange: (updates: Partial<DocumentContent>) => void;
  onSave: () => Promise<void>;
  onRevert: () => void;
  onEditModeChange: (mode: boolean) => void;
}

export default function PresentationView({
  document,
  fileName,
  folderPath,
  isDirty,
  isSaving,
  saveError,
  editMode,
  onChange,
  onSave,
  onRevert,
  onEditModeChange
}: PresentationViewProps) {
  const isInitializing = useRef(true);

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'visual' | 'json'>('visual');
  const [arrowMode, setArrowMode] = useState<'idle' | 'selecting'>('idle');
  const [arrowStartId, setArrowStartId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [showQuestionPanel, setShowQuestionPanel] = useState(false);
  const [showPropertiesPanel, setShowPropertiesPanel] = useState(true);

  // Extract presentation layout from document
  const presentationLayout = document?.layout && 'slides' in document.layout ? document.layout : null;
  const slides = presentationLayout?.slides || [{ rectangles: [], arrows: [] }];
  const canvasWidth = presentationLayout?.canvasWidth || 1280;
  const canvasHeight = presentationLayout?.canvasHeight || 720;
  const assets = document?.assets || [];

  // Set mounted flag after initialization
  useEffect(() => {
    if (document) {
      isInitializing.current = true;
      setMounted(false);

      setTimeout(() => {
        setMounted(true);
        setTimeout(() => {
          isInitializing.current = false;
        }, 100);
      }, 0);
    }
  }, [document]);

  // Auto-manage panel visibility when selecting shapes
  useEffect(() => {
    if (selectedElementId) {
      // Shape selected: collapse questions, expand properties
      setShowQuestionPanel(false);
      setShowPropertiesPanel(true);
    }
  }, [selectedElementId]);

  const currentSlide = slides[currentSlideIndex];

  // Get existing question IDs
  const existingQuestionIds = assets
    .filter(a => a.type === 'question' && ('id' in a) && a.id)
    .map(a => ('id' in a) ? a.id! : 0)
    .filter((id): id is number => typeof id === 'number' && id > 0);

  // Get metadata for presentation type
  const viewMetadata = getFileTypeMetadata('presentation');
  const TypeIcon = viewMetadata.icon;
  const questionCount = document?.assets?.filter(a => a.type === 'question').length || 0;

  // Auto-enter edit mode when there are changes
  useEffect(() => {
    if (mounted && !isInitializing.current && isDirty && !editMode) {
      onEditModeChange(true);
    }
  }, [isDirty, editMode, mounted]);

  const updateRectangle = (id: string, updates: Partial<Rectangle>) => {
    if (!document || !presentationLayout) return;

    const updatedSlides = slides.map((slide: PresentationSlide, idx: number) =>
      idx === currentSlideIndex
        ? {
            ...slide,
            rectangles: slide.rectangles.map((rect: Rectangle) =>
              rect.id === id ? { ...rect, ...updates } : rect
            )
          }
        : slide
    );

    onChange({
      layout: {
        ...presentationLayout,
        slides: updatedSlides
      }
    });
  };

  const deleteRectangle = (id: string) => {
    if (!document || !presentationLayout) return;

    const rectangle = currentSlide.rectangles.find((r: Rectangle) => r.id === id);

    const updatedSlides = slides.map((slide: PresentationSlide, idx: number) =>
      idx === currentSlideIndex
        ? {
            ...slide,
            rectangles: slide.rectangles.filter((rect: Rectangle) => rect.id !== id),
            arrows: slide.arrows.filter(
              (arrow) => arrow.fromId !== id && arrow.toId !== id
            )
          }
        : slide
    );

    const assetStillUsed = rectangle && updatedSlides.some((slide: PresentationSlide) =>
      slide.rectangles.some((rect: Rectangle) => rect.assetId === rectangle.assetId)
    );

    const updatedAssets = assetStillUsed || !rectangle
      ? assets
      : assets.filter(a => !('id' in a) || a.id !== rectangle.assetId);

    onChange({
      assets: updatedAssets,
      layout: {
        ...presentationLayout,
        slides: updatedSlides
      }
    });
    setSelectedElementId(null);
  };

  const deleteArrow = (id: string) => {
    if (!document || !presentationLayout) return;

    const updatedSlides = slides.map((slide: PresentationSlide, idx: number) =>
      idx === currentSlideIndex
        ? {
            ...slide,
            arrows: slide.arrows.filter((arrow) => arrow.id !== id)
          }
        : slide
    );

    onChange({
      layout: {
        ...presentationLayout,
        slides: updatedSlides
      }
    });
    setSelectedElementId(null);
  };

  const handleArrowModeToggle = () => {
    if (arrowMode === 'idle') {
      setArrowMode('selecting');
      setSelectedElementId(null);
    } else {
      setArrowMode('idle');
      setArrowStartId(null);
    }
  };

  const handleArrowCreate = (fromId: string, toId: string) => {
    if (!document || !presentationLayout) return;

    if (!toId) {
      setArrowStartId(fromId);
      return;
    }

    const newArrow = {
      id: `arrow-${Date.now()}`,
      fromId,
      toId,
      fromAnchor: 'center' as const,
      toAnchor: 'center' as const,
      color: '#9b59b6',
      strokeWidth: 2,
    };

    const updatedSlides = slides.map((slide: PresentationSlide, idx: number) =>
      idx === currentSlideIndex
        ? {
            ...slide,
            arrows: [...slide.arrows, newArrow]
          }
        : slide
    );

    onChange({
      layout: {
        ...presentationLayout,
        slides: updatedSlides
      }
    });
    setArrowMode('idle');
    setArrowStartId(null);
  };

  const handleAddRectangle = (rect: Rectangle) => {
    if (!document || !presentationLayout) return;

    const assetId = `asset-${Date.now()}`;
    const newAsset: AssetReference = {
      type: 'text',
      id: assetId,
      content: '# New Shape\n\nDouble-click to edit'
    };

    const updatedAssets = [...assets, newAsset];

    const rectWithAsset = {
      ...rect,
      assetId
    };

    const updatedSlides = slides.map((slide: PresentationSlide, idx: number) =>
      idx === currentSlideIndex
        ? {
            ...slide,
            rectangles: [...slide.rectangles, rectWithAsset]
          }
        : slide
    );

    onChange({
      assets: updatedAssets,
      layout: {
        ...presentationLayout,
        slides: updatedSlides
      }
    });
  };

  const handleAddSlide = () => {
    if (!document || !presentationLayout) return;

    const newSlide: PresentationSlide = {
      rectangles: [],
      arrows: []
    };

    onChange({
      layout: {
        ...presentationLayout,
        slides: [...slides, newSlide]
      }
    });
    setCurrentSlideIndex(slides.length); // Switch to new slide
  };

  const handleSelectSlide = (index: number) => {
    setCurrentSlideIndex(index);
    setSelectedElementId(null); // Deselect when switching slides
  };

  const handleAddQuestion = (questionId: number) => {
    if (!document || !presentationLayout) return;

    // Check if question already exists
    if (existingQuestionIds.includes(questionId)) {
      return;
    }

    // Add question as an asset (questions referenced by ID in presentations)
    const newAsset: AssetReference = {
      type: 'question',
      id: questionId
    };

    // Create a rectangle to display the question on the slide
    const newRect: Rectangle = {
      id: `rect-${Date.now()}`,
      x: 100,
      y: 100,
      width: 640,  // 50% of canvas width (1280 / 2)
      height: 360, // 50% of canvas height (720 / 2)
      rotation: 0,
      assetId: questionId.toString(),  // Reference the question asset
      zIndex: currentSlide.rectangles.length,
      backgroundColor: 'transparent',  // Transparent to inherit theme
      borderColor: '#2980b9',  // Blue for questions
      borderWidth: 3,
      textColor: '#000000',
      textAlign: 'left',
    };

    const updatedAssets = [...assets, newAsset];
    const updatedSlides = slides.map((slide: PresentationSlide, idx: number) =>
      idx === currentSlideIndex
        ? {
            ...slide,
            rectangles: [...slide.rectangles, newRect]
          }
        : slide
    );

    onChange({
      assets: updatedAssets,
      layout: {
        ...presentationLayout,
        slides: updatedSlides
      }
    });
  };

  const handleCanvasClick = () => {
    if (arrowMode === 'selecting') {
      setArrowMode('idle');
      setArrowStartId(null);
    } else {
      setSelectedElementId(null);
    }
  };

  const handleJsonChange = (jsonString: string) => {
    try {
      const parsed = JSON.parse(jsonString);
      console.log('JSON updated:', parsed);
    } catch (e) {
      console.error('Invalid JSON:', e);
    }
  };

  const handleSave = async () => {
    try {
      await onSave();
      onEditModeChange(false);
    } catch (error) {
      console.error('Failed to save presentation:', error);
    }
  };

  const handleCancel = () => {
    if (editMode) {
      // If exiting edit mode without saving, revert to original state
      onRevert();
    }
    onEditModeChange(!editMode);
  };

  // Convert current slide to SlideData format for SlideCanvas
  const slideData = {
    version: '1.0',
    canvasWidth,
    canvasHeight,
    rectangles: currentSlide.rectangles,
    arrows: currentSlide.arrows
  };

  if (!mounted) {
    return null;
  }

  return (
    <Box flex="1">
      {/* Header with Title, Description, and Badges */}
      <VStack align="start" gap={4} mb={12}>
        <HStack justify="space-between" width="100%" flexWrap="wrap" gap={4} align="start">
          <VStack align="start" gap={1} flex="1">
            {/* Name - read-only (TODO Phase 5: Implement metadata editing) */}
            {editMode ? (
              <Input
                value={fileName}
                onChange={() => {}}  // TODO Phase 5: Implement metadata editing
                disabled={true}
                fontSize={{ base: '2xl', md: '3xl', lg: '4xl' }}
                fontWeight="900"
                letterSpacing="-0.03em"
                color="fg.default"
                fontFamily="mono"
                variant="flushed"
                borderBottom="1px solid"
                borderColor="accent.secondary"
                bg="transparent"
                _focus={{ borderColor: 'accent.secondary', outline: 'none' }}
                px={0}
                py={1}
              />
            ) : (
              <Heading
                fontSize={{ base: '2xl', md: '3xl', lg: '4xl' }}
                fontWeight="900"
                letterSpacing="-0.03em"
                color="fg.default"
                fontFamily="mono"
                onDoubleClick={() => onEditModeChange(true)}
                cursor="text"
              >
                {fileName}
              </Heading>
            )}

            {/* Description - editable in edit mode */}
            {editMode ? (
              <Input
                value={document?.description || ''}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder="Add a description..."
                color="fg.muted"
                fontSize="sm"
                fontWeight="800"
                variant="flushed"
                borderBottom="1px solid"
                borderColor="accent.secondary"
                borderRadius="0"
                bg="transparent"
                _focus={{ borderColor: 'accent.secondary', outline: 'none' }}
                _placeholder={{ color: 'fg.subtle' }}
                px={0}
                py={1}
              />
            ) : (
              document?.description && (
                <Text
                  color="fg.muted"
                  fontSize="sm"
                  lineHeight="1.6"
                  fontWeight="800"
                  maxW="800px"
                  onDoubleClick={() => onEditModeChange(true)}
                  cursor="text"
                >
                  {document.description}
                </Text>
              )
            )}

            {/* Metadata chips */}
            <HStack gap={1.5}>
              <HStack
                gap={1}
                fontFamily="mono"
                fontSize="2xs"
                fontWeight="600"
                color="white"
                px={1.5}
                mt={1}
                py={0.5}
                bg={viewMetadata.color}
                borderRadius="sm"
                flexShrink={0}
              >
                <TypeIcon size={10} />
                <Text>{viewMetadata.label}</Text>
              </HStack>

              {questionCount > 0 && (
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
              )}
            </HStack>
          </VStack>

          {/* Edit/Save/Cancel buttons + View Toggle */}
          <VStack align="end" gap={2} flexShrink={0}>
            <HStack gap={2}>
              {editMode && (
                <IconButton
                  onClick={handleSave}
                  aria-label="Save presentation"
                  size="xs"
                  colorPalette="teal"
                  loading={isSaving}
                  disabled={!isDirty}
                  px={2}
                >
                  <LuSave />
                  Save
                </IconButton>
              )}
              <IconButton
                onClick={handleCancel}
                aria-label={editMode ? 'Cancel editing' : 'Edit presentation'}
                variant="subtle"
                size="xs"
                px={2}
              >
                {editMode ? null : <LuPencil />}
                {editMode ? 'Cancel' : 'Edit'}
              </IconButton>
            </HStack>

            {/* View Toggle */}
            <TabSwitcher
              tabs={[
                { value: 'visual', label: 'Visual view', icon: LuEye },
                { value: 'json', label: 'JSON view', icon: LuCode }
              ]}
              activeTab={activeTab}
              onTabChange={(tab) => setActiveTab(tab as 'visual' | 'json')}
              accentColor="accent.secondary"
            />
          </VStack>
        </HStack>
      </VStack>

      {/* Save Error Banner */}
      {saveError && (
        <Box
          bg="bg.error"
          borderLeft="4px solid"
          borderColor="accent.danger"
          px={4}
          py={3}
          mb={4}
          borderRadius="md"
        >
          <HStack gap={2} align="start">
            <LuTriangleAlert size={20} color="var(--chakra-colors-accent-danger)" />
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="sm" fontWeight="600" color="accent.danger">
                Failed to save
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {saveError}
              </Text>
            </VStack>
          </HStack>
        </Box>
      )}

      {/* JSON View */}
      {activeTab === 'json' && (
        <Box key={`${JSON.stringify(document?.assets)}-${JSON.stringify(slides)}`}>
          <JsonEditor
            value={JSON.stringify(document, null, 2)}
            onChange={handleJsonChange}
          />
        </Box>
      )}

      {/* Visual View */}
      {activeTab === 'visual' && (
        <HStack align="start" gap={6}>
          {/* Left: Canvas and Slide Navigator */}
          <VStack flex="1" align="stretch" gap={4}>
            <SlideCanvas
              slideData={slideData}
              selectedElementId={selectedElementId}
              onRectangleUpdate={updateRectangle}
              onRectangleDelete={deleteRectangle}
              onRectangleSelect={setSelectedElementId}
              onArrowDelete={deleteArrow}
              onArrowSelect={setSelectedElementId}
              onCanvasClick={handleCanvasClick}
              arrowMode={arrowMode}
              arrowStartId={arrowStartId}
              onArrowModeToggle={handleArrowModeToggle}
              onArrowCreate={handleArrowCreate}
              onAddRectangle={handleAddRectangle}
              assets={assets}
              onAssetUpdate={(assetId: string, content: string) => {
                if (!document) return;
                const updatedAssets = assets.map(asset =>
                  (('id' in asset) && asset.id === assetId) ? { ...asset, content } : asset
                );
                onChange({ assets: updatedAssets });
              }}
            />

            {/* Slide Navigator - Thumbnails */}
            <Box
              bg="bg.surface"
              border="1px solid"
              borderColor="border.default"
              borderRadius="lg"
              p={3}
            >
              <HStack gap={3} overflowX="auto">
                {/* Slide thumbnails */}
                {slides.map((slide: PresentationSlide, index: number) => (
                  <Box
                    key={index}
                    width="120px"
                    height="68px"
                    flexShrink={0}
                    bg={index === currentSlideIndex ? 'accent.secondary' : 'bg.muted'}
                    border="2px solid"
                    borderColor={index === currentSlideIndex ? 'accent.secondary' : 'border.default'}
                    borderRadius="md"
                    cursor="pointer"
                    onClick={() => handleSelectSlide(index)}
                    position="relative"
                    _hover={{
                      borderColor: 'accent.secondary',
                    //   transform: 'scale(1.05)'
                    }}
                    transition="all 0.2s"
                  >
                    {/* Slide number */}
                    <Box
                      position="absolute"
                      bottom={1}
                      right={1}
                      bg="bg.surface"
                      px={1.5}
                      py={0.5}
                      borderRadius="sm"
                      fontSize="2xs"
                      fontFamily="mono"
                      fontWeight="700"
                      color={index === currentSlideIndex ? 'accent.secondary' : 'fg.muted'}
                    >
                      {index + 1}
                    </Box>

                    {/* Mini preview of shapes count */}
                    <VStack height="100%" justify="center" align="center" opacity={0.6}>
                      <Text fontSize="xs" color={index === currentSlideIndex ? 'white' : 'fg.muted'} fontFamily="mono">
                        {slide.rectangles.length} {slide.rectangles.length === 1 ? 'asset' : 'assets'}
                      </Text>
                    </VStack>
                  </Box>
                ))}

                {/* Add slide button */}
                <Box
                  width="120px"
                  height="68px"
                  flexShrink={0}
                  bg="bg.muted"
                  border="2px dashed"
                  borderColor="border.default"
                  borderRadius="md"
                  cursor="pointer"
                  onClick={handleAddSlide}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  _hover={{
                    borderColor: 'accent.secondary',
                    bg: 'bg.elevated'
                  }}
                  transition="all 0.2s"
                >
                  <LuPlus size={24} color="var(--chakra-colors-fg-muted)" />
                </Box>
              </HStack>
            </Box>
          </VStack>

          {/* Right: Collapsible Sidebar - Always visible */}
          <VStack align="stretch" gap={4} width="280px" minWidth="280px" flexShrink={0}>
              {/* Questions Panel - Collapsible */}
              <Box
                bg="bg.surface"
                border="1px solid"
                borderColor="border.default"
                borderRadius="lg"
                overflow="hidden"
              >
                <HStack
                  px={3}
                  py={2}
                  bg="bg.muted"
                  cursor="pointer"
                  onClick={() => setShowQuestionPanel(!showQuestionPanel)}
                  _hover={{ bg: 'bg.elevated' }}
                  justify="space-between"
                >
                  <HStack gap={2}>
                    <LuScanSearch size={14} />
                    <Text fontSize="sm" fontWeight="700" fontFamily="mono">
                      Questions
                    </Text>
                  </HStack>
                  <IconButton
                    aria-label={showQuestionPanel ? 'Collapse' : 'Expand'}
                    size="xs"
                    variant="ghost"
                  >
                    {showQuestionPanel ? <LuChevronUp /> : <LuChevronDown />}
                  </IconButton>
                </HStack>
                {showQuestionPanel && (
                  <Box overflowY="auto" maxH="none">
                    <QuestionBrowserPanel
                      folderPath={folderPath}
                      onAddQuestion={handleAddQuestion}
                      excludedIds={existingQuestionIds}
                    />
                  </Box>
                )}
              </Box>

              {/* Shape Properties Panel - Collapsible, greyed out when nothing selected */}
              <Box
                bg="bg.surface"
                border="1px solid"
                borderColor="border.default"
                borderRadius="lg"
                overflow="hidden"
                opacity={selectedElementId ? 1 : 0.5}
              >
                <HStack
                  px={3}
                  py={2}
                  bg="bg.muted"
                  cursor="pointer"
                  onClick={() => setShowPropertiesPanel(!showPropertiesPanel)}
                  _hover={{ bg: 'bg.elevated' }}
                  justify="space-between"
                >
                  <HStack gap={2}>
                    <LuSettings size={14} />
                    <Text fontSize="sm" fontWeight="700" fontFamily="mono">
                      Properties
                    </Text>
                  </HStack>
                  <IconButton
                    aria-label={showPropertiesPanel ? 'Collapse' : 'Expand'}
                    size="xs"
                    variant="ghost"
                  >
                    {showPropertiesPanel ? <LuChevronUp /> : <LuChevronDown />}
                  </IconButton>
                </HStack>
                {showPropertiesPanel && (
                  selectedElementId ? (
                    <Box p={3}>
                      {(() => {
                        const selectedShape = currentSlide.rectangles.find((r: Rectangle) => r.id === selectedElementId);
                        const selectedAsset = selectedShape ? assets.find((a: AssetReference) => a.id === selectedShape.assetId) : undefined;

                        if (!selectedShape) return null;

                        return (
                          <ShapePropertiesPanel
                            shape={selectedShape}
                            asset={selectedAsset}
                            onUpdate={(updates) => updateRectangle(selectedShape.id, updates)}
                            embedded={true}
                          />
                        );
                      })()}
                    </Box>
                  ) : (
                    <Box p={4} textAlign="center">
                      <Text fontSize="xs" color="fg.muted">
                        Select a shape to edit properties
                      </Text>
                    </Box>
                  )
                )}
              </Box>
            </VStack>
        </HStack>
      )}
    </Box>
  );
}
