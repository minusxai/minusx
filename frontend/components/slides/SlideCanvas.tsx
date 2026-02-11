'use client';

// cSpell:ignore chakra
import { Box, VStack, HStack } from '@chakra-ui/react';
import GridBackground from './GridBackground';
import SlideRectangle from './SlideRectangle';
import ArrowPath from './ArrowPath';
import Toolbar from './Toolbar';
import { useState, useRef, useCallback, useEffect } from 'react';
import type { SlideData, Rectangle, AssetReference } from '@/lib/types';
import { getArrow } from 'perfect-arrows';

interface SlideCanvasProps {
  slideData: SlideData;
  selectedElementId: string | null;
  onRectangleUpdate: (id: string, updates: Partial<Rectangle>) => void;
  onRectangleDelete: (id: string) => void;
  onRectangleSelect: (id: string) => void;
  onArrowDelete: (id: string) => void;
  onArrowSelect: (id: string) => void;
  onCanvasClick: () => void;
  arrowMode: 'idle' | 'selecting';
  arrowStartId: string | null;
  onArrowModeToggle: () => void;
  onArrowCreate: (fromId: string, toId: string) => void;
  onAddRectangle: (rect: Rectangle) => void;
  onAddQuestion?: () => void;
  questionPanelOpen?: boolean;
  assets: AssetReference[];
  onAssetUpdate: (assetId: string, content: string) => void;
}

// Helper to get anchor point
function getAnchorPoint(rect: Rectangle, anchor: string) {
  const { x, y, width, height } = rect;
  switch (anchor) {
    case 'top':
      return { x: x + width / 2, y };
    case 'right':
      return { x: x + width, y: y + height / 2 };
    case 'bottom':
      return { x: x + width / 2, y: y + height };
    case 'left':
      return { x, y: y + height / 2 };
    case 'center':
    default:
      return { x: x + width / 2, y: y + height / 2 };
  }
}

export default function SlideCanvas({
  slideData,
  selectedElementId,
  onRectangleUpdate,
  onRectangleDelete,
  onRectangleSelect,
  onArrowDelete,
  onArrowSelect,
  onCanvasClick,
  arrowMode,
  arrowStartId,
  onArrowModeToggle,
  onArrowCreate,
  onAddRectangle,
  onAddQuestion,
  questionPanelOpen = false,
  assets,
  onAssetUpdate,
}: SlideCanvasProps) {
  const dragPositionRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(0.75);
  const [alignmentGuides, setAlignmentGuides] = useState<{
    showVertical: boolean;
    showHorizontal: boolean;
  }>({ showVertical: false, showHorizontal: false });

  // Calculate responsive scale based on wrapper width
  useEffect(() => {
    const updateScale = () => {
      if (canvasWrapperRef.current) {
        const wrapperWidth = canvasWrapperRef.current.offsetWidth;
        // Calculate scale to fit the wrapper width
        const scale = wrapperWidth / 1280;
        setCanvasScale(scale);
      }
    };

    // Initial scale
    updateScale();

    // Update on window resize
    window.addEventListener('resize', updateScale);

    // Use ResizeObserver for more responsive updates
    const resizeObserver = new ResizeObserver(updateScale);
    if (canvasWrapperRef.current) {
      resizeObserver.observe(canvasWrapperRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateScale);
      resizeObserver.disconnect();
    };
  }, []);

  const handleAddShape = (shapeType: 'rectangle' | 'oval' | 'triangle' | 'diamond' | 'arrow' | 'star') => {
    const newRect: Rectangle = {
      id: `rect-${Date.now()}`,
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      rotation: 0,
      assetId: '', // Will be set by PresentationView when it creates the asset
      zIndex: slideData.rectangles.length,
      shapeType,
      backgroundColor: '#ffffff',  // White background
      borderColor: '#9b59b6',      // Purple border (Amethyst)
      borderWidth: 2,
      textColor: '#000000',         // Black text
      textAlign: 'left',
    };
    onAddRectangle(newRect);
  };

  // Handle real-time arrow updates during drag using direct DOM manipulation
  const handleDragUpdate = useCallback((rectId: string, x: number, y: number) => {
    dragPositionRef.current = { id: rectId, x, y };

    // Find all arrows connected to this rectangle
    slideData.arrows.forEach((arrow) => {
      if (arrow.fromId !== rectId && arrow.toId !== rectId) return;

      const fromRect = slideData.rectangles.find((r) => r.id === arrow.fromId);
      const toRect = slideData.rectangles.find((r) => r.id === arrow.toId);
      if (!fromRect || !toRect) return;

      // Apply drag offset
      const fromRectPos = arrow.fromId === rectId ? { ...fromRect, x, y } : fromRect;
      const toRectPos = arrow.toId === rectId ? { ...toRect, x, y } : toRect;

      const fromPoint = getAnchorPoint(fromRectPos, arrow.fromAnchor);
      const toPoint = getAnchorPoint(toRectPos, arrow.toAnchor);

      // Calculate new arrow path
      const arrowData = getArrow(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, {
        padStart: 10,
        padEnd: 10,
      });
      const [sx, sy, cx, cy, ex, ey] = arrowData;

      // Directly update SVG paths without React re-render
      const pathElement = document.querySelector(`[data-arrow-id="${arrow.id}"]`);
      const arrowheadElement = document.querySelector(`[data-arrowhead-id="${arrow.id}"]`);

      if (pathElement) {
        pathElement.setAttribute('d', `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`);
      }

      if (arrowheadElement) {
        const arrowHeadLength = 10;
        const angle = Math.atan2(ey - cy, ex - cx);
        const arrowPoint1X = ex - arrowHeadLength * Math.cos(angle - Math.PI / 6);
        const arrowPoint1Y = ey - arrowHeadLength * Math.sin(angle - Math.PI / 6);
        const arrowPoint2X = ex - arrowHeadLength * Math.cos(angle + Math.PI / 6);
        const arrowPoint2Y = ey - arrowHeadLength * Math.sin(angle + Math.PI / 6);
        arrowheadElement.setAttribute('points', `${ex},${ey} ${arrowPoint1X},${arrowPoint1Y} ${arrowPoint2X},${arrowPoint2Y}`);
      }
    });
  }, [slideData.arrows, slideData.rectangles]);

  const handleDragEnd = useCallback(() => {
    dragPositionRef.current = null;
    setAlignmentGuides({ showVertical: false, showHorizontal: false });
  }, []);

  // Handle alignment guide updates
  const handleAlignmentGuide = useCallback((isHCentered: boolean, isVCentered: boolean) => {
    setAlignmentGuides({ showHorizontal: isHCentered, showVertical: isVCentered });
  }, []);

  const handleDelete = () => {
    if (!selectedElementId) return;

    const isRectangle = slideData.rectangles.some((r) => r.id === selectedElementId);
    if (isRectangle) {
      onRectangleDelete(selectedElementId);
    } else {
      onArrowDelete(selectedElementId);
    }
  };

  const handleRectangleClick = (id: string) => {
    if (arrowMode === 'selecting') {
      if (!arrowStartId) {
        // First click - set start
        onArrowCreate(id, ''); // Signal start selection
      } else if (arrowStartId !== id) {
        // Second click - create arrow
        onArrowCreate(arrowStartId, id);
      }
    } else {
      onRectangleSelect(id);
    }
  };

  return (
    <VStack align="stretch" gap={0}>
      <Toolbar
        onAddShape={handleAddShape}
        onToggleArrowMode={onArrowModeToggle}
        onAddQuestion={onAddQuestion}
        onDelete={handleDelete}
        arrowMode={arrowMode === 'selecting'}
        questionPanelOpen={questionPanelOpen}
        hasSelection={selectedElementId !== null}
      />

      <HStack align="start" gap={6} flexWrap={{ base: 'wrap', lg: 'nowrap' }}>
        {/* Wrapper to contain scaled canvas */}
        <Box
          ref={canvasWrapperRef}
          width="100%"
          flex="1"
          position="relative"
          style={{
            height: `${720 * canvasScale}px`
          }}
        >
        <Box
          position="absolute"
          top={0}
          left={0}
          width="1280px"
          height="720px"
          bg="bg.surface"
          border="2px solid"
          borderColor="border.default"
          borderRadius="lg"
          overflow="hidden"
          onClick={onCanvasClick}
          cursor={arrowMode === 'selecting' ? 'crosshair' : 'default'}
          boxShadow="0 4px 16px rgba(0, 0, 0, 0.15)"
          style={{
            transform: `scale(${canvasScale})`,
            transformOrigin: 'top left'
          }}
        >
        <GridBackground />

        {/* Arrow mode instruction overlay */}
        {arrowMode === 'selecting' && (
          <Box
            position="absolute"
            top={5}
            left="50%"
            transform="translateX(-50%)"
            bg="accent.secondary"
            color="white"
            px={6}
            py={3}
            borderRadius="lg"
            fontFamily="mono"
            fontSize="md"
            fontWeight="700"
            boxShadow="0 8px 24px rgba(155, 89, 182, 0.4)"
            zIndex={10000}
            pointerEvents="none"
          >
            {arrowStartId ? 'Click second shape to connect' : 'Click first shape to start arrow'}
          </Box>
        )}

        {/* SVG overlay for arrows and alignment guides */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          {/* Alignment guides */}
          {alignmentGuides.showVertical && (
            <line
              x1="640"
              y1="0"
              x2="640"
              y2="720"
              stroke="#e74c3c"
              strokeWidth="2"
              strokeDasharray="5,5"
              opacity="0.8"
            />
          )}
          {alignmentGuides.showHorizontal && (
            <line
              x1="0"
              y1="360"
              x2="1280"
              y2="360"
              stroke="#e74c3c"
              strokeWidth="2"
              strokeDasharray="5,5"
              opacity="0.8"
            />
          )}

          <g style={{ pointerEvents: 'auto' }}>
            {slideData.arrows.map((arrow) => (
              <ArrowPath
                key={arrow.id}
                arrow={arrow}
                rectangles={slideData.rectangles}
                isSelected={selectedElementId === arrow.id}
                onSelect={() => onArrowSelect(arrow.id)}
              />
            ))}
          </g>
        </svg>

        {/* Rectangles */}
        {slideData.rectangles.map((rect) => {
          const asset = assets.find(a =>
            ('id' in a) && a.id === rect.assetId
          );
          // If asset is a question, find the actual question object
          // Note: QuestionContent doesn't have an id field, so we can't match them currently
          const question = undefined;

          return (
            <SlideRectangle
              key={rect.id}
              rectangle={rect}
              asset={asset}
              question={question}
              isSelected={selectedElementId === rect.id}
              onSelect={() => handleRectangleClick(rect.id)}
              onUpdate={(updates) => onRectangleUpdate(rect.id, updates)}
              onDelete={() => onRectangleDelete(rect.id)}
              onDragUpdate={(x, y) => handleDragUpdate(rect.id, x, y)}
              onDragEnd={handleDragEnd}
              onAlignmentGuide={handleAlignmentGuide}
              onAssetUpdate={(content: string) => {
                if (rect.assetId) {
                  onAssetUpdate(rect.assetId, content);
                }
              }}
            />
          );
        })}
      </Box>
      </Box>
      </HStack>
    </VStack>
  );
}
