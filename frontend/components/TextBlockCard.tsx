'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Box, HStack, IconButton, Button, Text } from '@chakra-ui/react';
import { LuX, LuGripVertical, LuChevronDown, LuChevronUp } from 'react-icons/lu';
import LexicalTextEditor, { LexicalTextViewer } from '@/components/lexical/LexicalTextEditor';

interface TextBlockCardProps {
  id: string;
  content: string;
  editMode: boolean;
  onContentChange: (id: string, content: string) => void;
  onRemove: (id: string) => void;
  /** Called when the text block wants to expand/collapse. Passes the desired height in pixels, or null to restore original. */
  onResize?: (id: string, height: number | null) => void;
}

export default function TextBlockCard({
  id,
  content,
  editMode,
  onContentChange,
  onRemove,
  onResize,
}: TextBlockCardProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Reset expanded state when entering edit mode (derive state from props pattern)
  const [prevEditMode, setPrevEditMode] = useState(editMode);
  if (prevEditMode !== editMode) {
    setPrevEditMode(editMode);
    if (editMode && expanded) {
      setExpanded(false);
      onResize?.(id, null);
    }
  }

  // Detect whether content overflows the container (view mode only)
  useEffect(() => {
    if (editMode || !contentRef.current) return;

    const el = contentRef.current;
    const check = () => setIsOverflowing(el.scrollHeight > el.clientHeight + 4);

    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [editMode, content]);

  const handleExpand = useCallback(() => {
    setExpanded(true);
    if (onResize && contentRef.current) {
      // Extra space for the "Show less" button + border + padding
      onResize(id, contentRef.current.scrollHeight + 80);
    }
  }, [id, onResize]);

  const handleCollapse = useCallback(() => {
    setExpanded(false);
    onResize?.(id, null);
  }, [id, onResize]);

  if (editMode) {
    return (
      <Box position="relative" height="100%" display="flex" flexDirection="column">
        <Box flex={1} minH={0}>
          <LexicalTextEditor
            initialMarkdown={content}
            onChange={(markdown) => onContentChange(id, markdown)}
            renderToolbar={(toolbar) => (
              <HStack
                px={2}
                py={1}
                bg="bg.muted"
                borderBottomWidth="1px"
                borderColor="border.default"
                justifyContent="space-between"
                flexShrink={0}
              >
                <Box className="drag-handle" cursor="move" display="flex" alignItems="center" px={1}>
                  <LuGripVertical size={14} opacity={0.5} />
                </Box>
                <Box flex={1}>
                  {toolbar}
                </Box>
                <IconButton
                  onClick={() => onRemove(id)}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label="Remove text block"
                  size="2xs"
                  variant="ghost"
                  color="accent.danger"
                  cursor="pointer"
                  _hover={{ transform: 'scale(1.2)' }}
                  transition="transform 0.1s ease"
                >
                  <LuX size={14} />
                </IconButton>
              </HStack>
            )}
          />
        </Box>
      </Box>
    );
  }

  // View mode
  const showFade = isOverflowing && !expanded;

  return (
    <Box height="100%" position="relative" display="flex" flexDirection="column">
      <Box
        ref={contentRef}
        flex={1}
        minH={0}
        overflow={expanded ? 'visible' : 'hidden'}
      >
        {content ? (
          <LexicalTextViewer markdown={content} />
        ) : (
          <Box p={4} color="fg.muted" fontSize="sm" fontStyle="italic">Empty text block</Box>
        )}
      </Box>

      {/* Gradient fade + Read more button */}
      {showFade && (
        <Box
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          height="100px"
          bgGradient="to-t"
          gradientFrom="bg.subtle"
          gradientVia="bg.subtle/80"
          gradientTo="transparent"
          display="flex"
          alignItems="flex-end"
          justifyContent="center"
          pb={3}
        >
          <Button
            size="xs"
            variant="outline"
            onClick={handleExpand}
            aria-label="Expand text block"
            borderColor="accent.teal"
            bg="bg.subtle"
            color="accent.teal"
            fontSize="xs"
            _hover={{ bg: 'accent.teal', color: 'white', borderColor: 'accent.teal' }}
            transition="all 0.15s"
            borderRadius="full"
            px={4}
            fontWeight={500}
          >
            <LuChevronDown size={11} />
            <Text ml={1}>Read more</Text>
          </Button>
        </Box>
      )}

      {/* Collapse button — sits at the bottom of the card, inside the flex layout */}
      {expanded && (
        <Box
          flexShrink={0}
          display="flex"
          justifyContent="center"
          py={3}
          borderTopWidth="1px"
          borderColor="border.muted"
        >
          <Button
            size="xs"
            variant="outline"
            onClick={handleCollapse}
            aria-label="Collapse text block"
            borderColor="accent.teal"
            color="accent.teal"
            fontSize="xs"
            _hover={{ bg: 'accent.teal', color: 'white', borderColor: 'accent.teal' }}
            transition="all 0.15s"
            borderRadius="full"
            px={4}
            fontWeight={500}
          >
            <LuChevronUp size={11} />
            <Text ml={1}>Show less</Text>
          </Button>
        </Box>
      )}
    </Box>
  );
}
