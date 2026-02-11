'use client';

import { Box, VStack, HStack, Text, IconButton, Input, Button } from '@chakra-ui/react';
import { LuX, LuAlignLeft, LuAlignCenter, LuAlignRight } from 'react-icons/lu';
import ColorPicker from './ColorPicker';
import type { Rectangle, AssetReference } from '@/lib/types';

interface ShapePropertiesPanelProps {
  shape: Rectangle;
  asset?: AssetReference;
  onUpdate: (updates: Partial<Rectangle>) => void;
  onClose?: () => void;
  embedded?: boolean;
}

export default function ShapePropertiesPanel({
  shape,
  asset,
  onUpdate,
  onClose,
  embedded = false,
}: ShapePropertiesPanelProps) {
  const backgroundColor = shape.backgroundColor || '#ffffff';
  const borderColor = shape.borderColor || '#9b59b6';
  const textAlign = shape.textAlign || 'left';
  const contentType = asset?.type || 'text';
  const isTextContent = contentType === 'text';

  return (
    <Box
      width={embedded ? '100%' : { base: '100%', lg: '240px' }}
      minWidth={embedded ? undefined : { lg: '240px' }}
      bg={embedded ? 'transparent' : 'bg.surface'}
      border={embedded ? 'none' : '1px solid'}
      borderColor={embedded ? undefined : 'border.emphasized'}
      borderRadius={embedded ? '0' : 'lg'}
      p={embedded ? 0 : 3}
      maxHeight={embedded ? 'none' : '600px'}
      overflowY={embedded ? 'visible' : 'auto'}
      flexShrink={0}
      fontFamily={"mono"}
    >
      {!embedded && (
        <HStack mb={3} justify="space-between">
          <Text fontSize="md" fontWeight="700">
            Properties
          </Text>
          <IconButton
            aria-label="Close properties"
            size="xs"
            variant="ghost"
            onClick={onClose}
          >
            <LuX />
          </IconButton>
        </HStack>
      )}

      <VStack align="stretch" gap={3}>
        <ColorPicker
          label="Background Color"
          value={backgroundColor}
          onChange={(color) => onUpdate({ backgroundColor: color })}
        />

        <ColorPicker
          label="Border Color"
          value={borderColor}
          onChange={(color) => onUpdate({ borderColor: color })}
        />

        {/* Text Color Control - only for text content */}
        {isTextContent && (
          <ColorPicker
            label="Text Color"
            value={shape.textColor || '#000000'}
            onChange={(color) => onUpdate({ textColor: color })}
          />
        )}

        {/* Background Image Control */}
        <VStack align="stretch" gap={1.5}>
          <Text fontSize="xs" fontWeight="600">
            Background Image
          </Text>
          <Input
            placeholder="Image URL"
            value={shape.backgroundImage || ''}
            onChange={(e) => onUpdate({ backgroundImage: e.target.value })}
            size="xs"
            fontSize="xs"
          />
          {shape.backgroundImage && (
            <Button
              size="xs"
              variant="ghost"
              colorPalette="red"
              onClick={() => onUpdate({ backgroundImage: '' })}
            >
              Clear
            </Button>
          )}
        </VStack>

        {/* Layer & Text Alignment - combined row */}
        <HStack gap={2} align="start">
          {/* Layer/Z-Index Control */}
          <VStack align="stretch" gap={1.5} flex={1}>
            <Text fontSize="xs" fontWeight="600">
              z-index
            </Text>
            <HStack gap={1}>
              <Input
                p={1.5}
                type="number"
                value={shape.zIndex}
                onChange={(e) => onUpdate({ zIndex: parseInt(e.target.value) || 0 })}
                size="xs"
                fontSize="xs"
                width="100%"
              />
            </HStack>
          </VStack>

          {/* Text Alignment Control */}
          {isTextContent && (
            <VStack align="stretch" gap={1.5} flex={1}>
              <Text fontSize="xs" fontWeight="600">
                Align
              </Text>
              <HStack gap={1}>
                <Button
                  size="xs"
                  variant={textAlign === 'left' ? 'solid' : 'outline'}
                  bg={textAlign === 'left' ? 'accent.secondary' : undefined}
                  color={textAlign === 'left' ? 'white' : undefined}
                  onClick={() => onUpdate({ textAlign: 'left' })}
                  flex={1}
                >
                  <LuAlignLeft />
                </Button>
                <Button
                  size="xs"
                  variant={textAlign === 'center' ? 'solid' : 'outline'}
                  bg={textAlign === 'center' ? 'accent.secondary' : undefined}
                  color={textAlign === 'center' ? 'white' : undefined}
                  onClick={() => onUpdate({ textAlign: 'center' })}
                  flex={1}
                >
                  <LuAlignCenter />
                </Button>
                <Button
                  size="xs"
                  variant={textAlign === 'right' ? 'solid' : 'outline'}
                  bg={textAlign === 'right' ? 'accent.secondary' : undefined}
                  color={textAlign === 'right' ? 'white' : undefined}
                  onClick={() => onUpdate({ textAlign: 'right' })}
                  flex={1}
                >
                  <LuAlignRight />
                </Button>
              </HStack>
            </VStack>
          )}
        </HStack>
      </VStack>
    </Box>
  );
}
