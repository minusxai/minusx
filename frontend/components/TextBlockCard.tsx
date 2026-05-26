'use client';

import { Box, HStack, IconButton } from '@chakra-ui/react';
import { LuX, LuGripVertical } from 'react-icons/lu';
import LexicalTextEditor, { LexicalTextViewer } from '@/components/lexical/LexicalTextEditor';

interface TextBlockCardProps {
  id: string;
  content: string;
  editMode: boolean;
  onContentChange: (id: string, content: string) => void;
  onRemove: (id: string) => void;
}

export default function TextBlockCard({
  id,
  content,
  editMode,
  onContentChange,
  onRemove,
}: TextBlockCardProps) {
  if (editMode) {
    return (
      <Box position="relative" height="100%" display="flex" flexDirection="column">
        {/* Lexical rich text editor — toolbar rendered inline with drag handle */}
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

  // View mode: render with Lexical read-only (same renderer as edit mode)
  return (
    <Box height="100%" overflow="auto">
      {content ? (
        <LexicalTextViewer markdown={content} />
      ) : (
        <Box p={4} color="fg.muted" fontSize="sm" fontStyle="italic">Empty text block</Box>
      )}
    </Box>
  );
}
