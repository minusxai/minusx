'use client';

import { Box } from '@chakra-ui/react';

interface SqlEditorResizeHandleProps {
  fillHeight: boolean;
  isResizing: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
}

/**
 * Draggable bottom edge used to resize the SQL editor's fixed pixel height.
 * Hidden entirely in fillHeight mode, where the editor fills its parent instead.
 */
export default function SqlEditorResizeHandle({
  fillHeight,
  isResizing,
  onResizeStart,
}: SqlEditorResizeHandleProps) {
  if (fillHeight) {
    return null;
  }

  return (
    <Box
      position="absolute"
      bottom="0"
      left="0"
      right="0"
      height="8px"
      cursor="ns-resize"
      onMouseDown={onResizeStart}
      bg="transparent"
      _hover={{
        bg: isResizing ? 'accent.teal' : 'border.emphasized',
      }}
      transition="background 0.2s"
      zIndex={10}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      {/* Resize indicator dots */}
      <Box
        display="flex"
        gap="4px"
        alignItems="center"
        py="2px"
      >
        <Box
          width="3px"
          height="3px"
          borderRadius="full"
          bg={isResizing ? 'white' : 'border.emphasized'}
          transition="background 0.2s"
        />
        <Box
          width="3px"
          height="3px"
          borderRadius="full"
          bg={isResizing ? 'white' : 'border.emphasized'}
          transition="background 0.2s"
        />
        <Box
          width="3px"
          height="3px"
          borderRadius="full"
          bg={isResizing ? 'white' : 'border.emphasized'}
          transition="background 0.2s"
        />
      </Box>
    </Box>
  );
}
