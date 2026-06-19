'use client';

/**
 * ResizablePanel — a fixed-height box with a draggable "···" grip at the bottom
 * (same UX as SqlEditor's resize handle). Children fill the panel and scroll;
 * dragging the grip changes the panel height between min/max.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box } from '@chakra-ui/react';

interface ResizablePanelProps {
  defaultHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  children: ReactNode;
}

export default function ResizablePanel({
  defaultHeight = 300, minHeight = 160, maxHeight = 640, children,
}: ResizablePanelProps) {
  const [height, setHeight] = useState(defaultHeight);
  const [resizing, setResizing] = useState(false);
  const startY = useRef(0);
  const startH = useRef(defaultHeight);

  const onStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    startY.current = e.clientY;
    startH.current = height;
  };

  useEffect(() => {
    if (!resizing) return;
    const move = (e: MouseEvent) =>
      setHeight(Math.max(minHeight, Math.min(maxHeight, startH.current + (e.clientY - startY.current))));
    const up = () => setResizing(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [resizing, minHeight, maxHeight]);

  return (
    <Box position="relative" h={`${height}px`} overflow="hidden" display="flex" flexDirection="column">
      <Box flex={1} minH={0} overflow="auto">{children}</Box>
      {/* Drag grip */}
      <Box
        position="absolute"
        bottom="0"
        left="0"
        right="0"
        height="8px"
        cursor="ns-resize"
        onMouseDown={onStart}
        bg="transparent"
        _hover={{ bg: resizing ? 'accent.teal' : 'border.emphasized' }}
        transition="background 0.2s"
        zIndex={10}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Box display="flex" gap="4px" alignItems="center" py="2px">
          {[0, 1, 2].map(i => (
            <Box key={i} width="3px" height="3px" borderRadius="full" bg={resizing ? 'white' : 'border.emphasized'} transition="background 0.2s" />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
