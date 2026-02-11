'use client';

import { IconButton, HStack, Box, Button } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { LuArrowRight, LuTrash2, LuSquare, LuCircle, LuTriangle, LuDiamond, LuStar, LuScanSearch } from 'react-icons/lu';
import type { IconType } from 'react-icons';

interface ToolbarProps {
  onAddShape: (shapeType: 'rectangle' | 'oval' | 'triangle' | 'diamond' | 'arrow' | 'star') => void;
  onToggleArrowMode: () => void;
  onAddQuestion?: () => void;
  onDelete: () => void;
  arrowMode: boolean;
  questionPanelOpen?: boolean;
  hasSelection: boolean;
}

type ShapeType = 'rectangle' | 'oval' | 'triangle' | 'diamond' | 'star';

interface ShapeOption {
  type: ShapeType;
  label: string;
  icon: IconType;
}

const SHAPE_OPTIONS: ShapeOption[] = [
  { type: 'rectangle', label: 'Rectangle', icon: LuSquare },
  { type: 'oval', label: 'Oval', icon: LuCircle },
  { type: 'triangle', label: 'Triangle', icon: LuTriangle },
  { type: 'diamond', label: 'Diamond', icon: LuDiamond },
  { type: 'star', label: 'Star', icon: LuStar },
];

export default function Toolbar({
  onAddShape,
  onToggleArrowMode,
  onAddQuestion,
  onDelete,
  arrowMode,
  questionPanelOpen = false,
  hasSelection,
}: ToolbarProps) {
  return (
    <HStack
      gap={1}
      mb={6}
      p={1.5}
      bg="bg.surface"
      borderRadius="md"
      border="1px solid"
      borderColor="border.default"
      justify="space-between"
    >
      {/* Left side - Shape and Arrow tools */}
      <HStack gap={1}>
        {/* Shape buttons - icon only */}
        {SHAPE_OPTIONS.map(({ type, label, icon: Icon }) => (
          <Tooltip key={type} content={label} positioning={{ placement: 'bottom' }}>
            <IconButton
              aria-label={label}
              size="sm"
              variant="ghost"
              onClick={() => onAddShape(type)}
            >
              <Icon size={18} />
            </IconButton>
          </Tooltip>
        ))}

        {/* Separator */}
        <Box width="1px" height="24px" bg="border.default" mx={1} />

        {/* Add Arrow toggle button */}
        <Tooltip content={arrowMode ? 'Click 2 shapes to connect' : 'Add Arrow'} positioning={{ placement: 'bottom' }}>
          <IconButton
            aria-label="Add arrow"
            size="sm"
            variant="ghost"
            onClick={onToggleArrowMode}
            bg={arrowMode ? 'accent.secondary' : undefined}
            color={arrowMode ? 'white' : undefined}
          >
            <LuArrowRight size={18} />
          </IconButton>
        </Tooltip>

        {/* Add Question button */}
        {onAddQuestion && (
          <>
            {/* Separator */}
            <Box width="1px" height="24px" bg="border.default" mx={1} />

            <Button
              size="xs"
              variant="ghost"
              onClick={onAddQuestion}
              bg={questionPanelOpen ? 'accent.primary' : undefined}
              color={questionPanelOpen ? 'white' : 'accent.primary'}
              _hover={{
                bg: 'accent.primary',
                color: 'white'
              }}
              px={3}
            >
              <LuScanSearch size={16} />
              Insert Question
            </Button>
          </>
        )}
      </HStack>

      {/* Right side - Delete button */}
      {hasSelection && (
        <Tooltip content="Delete" positioning={{ placement: 'bottom' }}>
          <IconButton
            aria-label="Delete"
            size="sm"
            variant="ghost"
            onClick={onDelete}
            color="accent.danger"
            _hover={{
              bg: 'accent.danger',
              color: 'white'
            }}
            px={2}
          >
            <LuTrash2 size={18} />
            Delete
          </IconButton>
        </Tooltip>
      )}
    </HStack>
  );
}
