'use client';

import { Box, HStack, IconButton } from '@chakra-ui/react';
import { LuX, LuGripVertical } from 'react-icons/lu';
import Markdown from '@/components/Markdown';
import Editor from '@monaco-editor/react';
import { useAppSelector } from '@/store/hooks';
import { useRef } from 'react';

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
  const colorMode = useAppSelector((state) => state.ui.colorMode);

  // Debounce Monaco changes to avoid dispatching on every keystroke
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleEditorChange = (value: string | undefined) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onContentChange(id, value || '');
    }, 300);
  };

  if (editMode) {
    return (
      <Box position="relative" height="100%" display="flex" flexDirection="column">
        {/* Drag handle bar at top */}
        <HStack
          className="drag-handle"
          cursor="move"
          px={2}
          py={1}
          bg="bg.muted"
          borderBottomWidth="1px"
          borderColor="border.default"
          justifyContent="space-between"
          flexShrink={0}
        >
          <LuGripVertical size={14} opacity={0.5} />
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
        {/* Monaco markdown editor */}
        <Box flex={1} minH={0}>
          <Editor
            height="100%"
            language="markdown"
            value={content}
            onChange={handleEditorChange}
            theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
            options={{
              minimap: { enabled: false },
              wordWrap: 'on',
              lineNumbers: 'off',
              fontSize: 13,
              scrollBeyondLastLine: false,
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              renderLineHighlight: 'none',
              padding: { top: 8, bottom: 8 },
            }}
          />
        </Box>
      </Box>
    );
  }

  // View mode: render markdown
  return (
    <Box p={4} height="100%" overflow="auto">
      {content ? (
        <Markdown context="mainpage">{content}</Markdown>
      ) : (
        <Box color="fg.muted" fontSize="sm" fontStyle="italic">Empty text block</Box>
      )}
    </Box>
  );
}
