'use client';

import { Box, IconButton, HStack, Textarea, Input, VStack, Text } from '@chakra-ui/react';
import { useRef, useEffect, useState } from 'react';
import Moveable from 'react-moveable';
import { LuTrash2, LuPencil } from 'react-icons/lu';
import RectangleContent from './RectangleContent';
import EmbeddedQuestionContainer from '@/components/containers/EmbeddedQuestionContainer';
import type { Rectangle, AssetReference, QuestionContent } from '@/lib/types';

interface SlideRectangleProps {
  rectangle: Rectangle;
  asset?: AssetReference;
  question?: QuestionContent;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<Rectangle>) => void;
  onDelete: () => void;
  onEdit?: () => void;
  onDragUpdate?: (x: number, y: number) => void;
  onDragEnd?: () => void;
  onAlignmentGuide?: (isHCentered: boolean, isVCentered: boolean) => void;
  onAssetUpdate?: (content: string) => void;
}

// Helper function to get clip-path based on shape type
function getShapeClipPath(shapeType?: string): string | undefined {
  switch (shapeType) {
    case 'triangle':
      return 'polygon(50% 0%, 0% 100%, 100% 100%)';
    case 'diamond':
      return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
    case 'star':
      return 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
    case 'arrow':
      return 'polygon(0% 40%, 60% 40%, 60% 0%, 100% 50%, 60% 100%, 60% 60%, 0% 60%)';
    default:
      return undefined;
  }
}

export default function SlideRectangle({
  rectangle,
  asset,
  question,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onEdit,
  onDragUpdate,
  onDragEnd,
  onAlignmentGuide,
  onAssetUpdate,
}: SlideRectangleProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const moveableRef = useRef<Moveable>(null);
  const [isEditing, setIsEditing] = useState(false);
  const content = (asset && 'content' in asset) ? asset.content || '' : '';
  const [editContent, setEditContent] = useState(content);

  // Get content type first
  const contentType = asset?.type || 'text';
  const isQuestion = contentType === 'question';

  // Get shape styling
  const shapeType = rectangle.shapeType || 'rectangle';
  const backgroundColor = isQuestion ? 'transparent' : (rectangle.backgroundColor || '#ffffff');
  const borderColor = rectangle.borderColor || '#9b59b6';
  const borderWidth = rectangle.borderWidth || (isSelected ? 3 : 1);
  const clipPath = getShapeClipPath(shapeType);
  const borderRadius = shapeType === 'oval' ? '50%' : 'md';

  // Update moveable when selection changes
  useEffect(() => {
    if (moveableRef.current) {
      moveableRef.current.updateRect();
    }
  }, [isSelected, rectangle.x, rectangle.y, rectangle.width, rectangle.height, rectangle.rotation]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (contentType === 'text') {
      e.stopPropagation();
      setIsEditing(true);
      setEditContent(content);
    }
  };

  const handleEditImage = () => {
    setIsEditing(true);
    setEditContent(content);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (editContent !== content && onAssetUpdate) {
      onAssetUpdate(editContent);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditContent(content);
    } else if (e.key === 'Enter' && contentType === 'image') {
      // For image URLs, Enter key saves
      handleBlur();
    }
  };

  // Reset transform after state updates to prevent layout issues
  useEffect(() => {
    if (targetRef.current && !isEditing) {
      targetRef.current.style.transform = `rotate(${rectangle.rotation}deg)`;
    }
  }, [rectangle.x, rectangle.y, rectangle.width, rectangle.height, rectangle.rotation, isEditing]);

  return (
    <>
      {/* The actual shape */}
      <Box
        ref={targetRef}
        position="absolute"
        left={`${rectangle.x}px`}
        top={`${rectangle.y}px`}
        width={`${rectangle.width}px`}
        height={`${rectangle.height}px`}
        transform={`rotate(${rectangle.rotation}deg)`}
        bg={backgroundColor}
        border={`${borderWidth}px solid`}
        borderColor={borderColor}
        borderRadius={borderRadius}
        clipPath={clipPath}
        cursor={isEditing ? 'text' : 'move'}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onDoubleClick={handleDoubleClick}
        _hover={{
          borderColor: borderColor,
          borderWidth: `${borderWidth + 1}px`,
        }}
        transition="border-color 0.2s, border-width 0.2s"
        overflow="hidden"
        zIndex={rectangle.zIndex}
        style={
          rectangle.backgroundImage
            ? {
                backgroundImage: `url(${rectangle.backgroundImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
              }
            : undefined
        }
      >
        {isQuestion && question && asset && 'id' in asset ? (
          // Render question inside rectangle
          <Box height="100%" overflow="hidden" p={2}>
            <EmbeddedQuestionContainer
              question={question}
              questionId={asset.id as number}
            />
          </Box>
        ) : isEditing ? (
          contentType === 'text' ? (
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              autoFocus
              height="100%"
              border="none"
              resize="none"
              p={4}
              fontSize="xl"
              fontFamily="mono"
              onClick={(e) => e.stopPropagation()}
              color={'#ffffff'}
              bg='#000000'
            />
          ) : (
            <VStack
              height="100%"
              justify="center"
              align="stretch"
              p={4}
              gap={2}
              onClick={(e) => e.stopPropagation()}
            >
              <Text fontSize="sm" fontWeight="600">
                Image URL:
              </Text>
              <Input
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                autoFocus
                placeholder="https://example.com/image.png"
                fontSize="sm"
              />
              <Text fontSize="xs" color="fg.muted">
                Press Enter to save, Escape to cancel
              </Text>
            </VStack>
          )
        ) : (
          <RectangleContent
            contentType={contentType}
            content={content}
            textAlign={rectangle.textAlign}
            textColor={rectangle.textColor}
          />
        )}

        {/* Controls - only show when selected and not editing */}
        {isSelected && !isEditing && (
          <HStack
            position="absolute"
            top={2}
            right={2}
            gap={1}
            bg="bg.muted"
            borderRadius="md"
            p={1}
            border="1px solid"
            borderColor="border.default"
          >
            {contentType === 'image' && (
              <IconButton
                aria-label="Edit image URL"
                size="xs"
                variant="ghost"
                color="accent.secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditImage();
                }}
              >
                <LuPencil />
              </IconButton>
            )}
            <IconButton
              aria-label="Delete rectangle"
              size="xs"
              variant="ghost"
              color="accent.danger"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <LuTrash2 />
            </IconButton>
          </HStack>
        )}
      </Box>

      {/* Moveable controller - only when selected and not editing */}
      {isSelected && !isEditing && targetRef.current && (
        <Moveable
          ref={moveableRef}
          target={targetRef.current}
          draggable={true}
          resizable={true}
          rotatable={true}
          origin={false}
          // Dragging
          onDrag={(e) => {
            e.target.style.transform = e.transform;
            // Update arrows in real-time using direct DOM manipulation
            const newX = rectangle.x + e.translate[0];
            const newY = rectangle.y + e.translate[1];

            if (onDragUpdate) {
              onDragUpdate(newX, newY);
            }

            // Check for center alignment (canvas center is 640, 360)
            if (onAlignmentGuide) {
              const centerX = newX + rectangle.width / 2;
              const centerY = newY + rectangle.height / 2;
              const tolerance = 5;

              const isHCentered = Math.abs(centerY - 360) < tolerance;
              const isVCentered = Math.abs(centerX - 640) < tolerance;

              onAlignmentGuide(isHCentered, isVCentered);
            }
          }}
          onDragEnd={(e) => {
            // Extract translate values from the transform
            const newX = rectangle.x + e.lastEvent.translate[0];
            const newY = rectangle.y + e.lastEvent.translate[1];

            // Reset transform immediately
            e.target.style.transform = `rotate(${rectangle.rotation}deg)`;
            e.target.style.left = `${newX}px`;
            e.target.style.top = `${newY}px`;

            onUpdate({ x: newX, y: newY });
            if (onDragEnd) {
              onDragEnd();
            }
          }}
          // Resizing
          onResize={(e) => {
            e.target.style.width = `${e.width}px`;
            e.target.style.height = `${e.height}px`;
            e.target.style.transform = e.drag.transform;
          }}
          onResizeEnd={(e) => {
            // Get actual dimensions from the element
            const width = parseFloat(e.target.style.width);
            const height = parseFloat(e.target.style.height);

            // Use moveable's calculated offsets
            // @ts-ignore - moveable types are incomplete
            const newX = rectangle.x + (e.drag?.translate?.[0] || 0);
            // @ts-ignore - moveable types are incomplete
            const newY = rectangle.y + (e.drag?.translate?.[1] || 0);

            console.log('Resize End:', {
              id: rectangle.id,
              oldWidth: rectangle.width,
              oldHeight: rectangle.height,
              newWidth: width,
              newHeight: height,
              oldX: rectangle.x,
              oldY: rectangle.y,
              newX,
              newY,
            });

            // Reset transform immediately
            e.target.style.transform = `rotate(${rectangle.rotation}deg)`;
            e.target.style.left = `${newX}px`;
            e.target.style.top = `${newY}px`;

            onUpdate({
              width,
              height,
              x: newX,
              y: newY,
            });
          }}
          // Rotation
          onRotate={(e) => {
            e.target.style.transform = e.drag.transform;
          }}
          onRotateEnd={(e) => {
            // Extract rotation from transform
            const transform = e.target.style.transform;
            const match = transform.match(/rotate\(([-\d.]+)deg\)/);
            const rotation = match ? parseFloat(match[1]) : rectangle.rotation;

            // Reset transform immediately
            e.target.style.transform = `rotate(${rotation}deg)`;

            onUpdate({ rotation });
          }}
          // Bounds
          bounds={{
            left: 0,
            top: 0,
            right: 1280,
            bottom: 720,
            position: 'css',
          }}
          // Styling
          renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
        />
      )}
    </>
  );
}
