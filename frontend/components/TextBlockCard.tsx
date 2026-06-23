'use client';

/**
 * TextBlockCard — a dashboard rich-text block, edited with the same
 * LexicalTextEditor used for notebook text cells and context docs (content
 * stored as markdown). Image upload (type "+") and @ / @@ mentions (tables,
 * questions) are wired like the notebook text cell editor.
 */
import { useCallback, useMemo, useState } from 'react';
import { Box, HStack, IconButton } from '@chakra-ui/react';
import { LuX, LuGripVertical } from 'react-icons/lu';
import LexicalTextEditor, { LexicalTextViewer, type MentionsConfig } from '@/components/lexical/LexicalTextEditor';
import { uploadFile } from '@/lib/object-store/client';
import { toaster } from '@/components/ui/toaster';
import { useContext as useSchemaContext } from '@/lib/hooks/useContext';

interface TextBlockCardProps {
  id: string;
  content: string;
  editMode: boolean;
  /** Dashboard path, used to resolve @ / @@ mention context (tables, questions). */
  filePath?: string;
  onContentChange: (id: string, content: string) => void;
  onRemove: (id: string) => void;
}

export default function TextBlockCard({
  id,
  content,
  editMode,
  filePath,
  onContentChange,
  onRemove,
}: TextBlockCardProps) {
  // LexicalTextEditor seeds its content from `initialMarkdown` only on mount, so
  // an EXTERNAL edit (e.g. the agent's EditFile) to content wouldn't show. Track
  // what this editor last emitted; when content arrives as a value we didn't
  // emit, it's an external change — bump `syncKey` to remount the editor and
  // re-seed it. Our own edits echo back equal to `lastEmitted` → no remount, so
  // the user's typing/cursor is never disrupted. (Same pattern as NotebookTextCell.)
  const [lastEmitted, setLastEmitted] = useState(content);
  const [seenContent, setSeenContent] = useState(content);
  const [syncKey, setSyncKey] = useState(0);
  if (content !== seenContent) {
    setSeenContent(content);
    if (content !== lastEmitted) setSyncKey(k => k + 1);
  }

  const handleContentChange = useCallback(
    (markdown: string) => {
      setLastEmitted(markdown);
      onContentChange(id, markdown);
    },
    [onContentChange, id],
  );

  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    try {
      const { publicUrl } = await uploadFile(file);
      return publicUrl;
    } catch (err: unknown) {
      toaster.create({ title: err instanceof Error ? err.message : 'Failed to upload image', type: 'error' });
      return '';
    }
  }, []);

  // @ / @@ mention typeahead over the dashboard context's tables + questions.
  const { databases: schemaData } = useSchemaContext(filePath || '/org');
  const mentions = useMemo<MentionsConfig>(() => ({ whitelistedSchemas: schemaData }), [schemaData]);

  if (editMode) {
    return (
      <Box position="relative" height="100%" display="flex" flexDirection="column">
        <LexicalTextEditor
          key={syncKey}
          initialMarkdown={content}
          onChange={handleContentChange}
          onImageUpload={handleImageUpload}
          mentions={mentions}
          insertMenu
          editWithAgent={{ editorKind: 'richtext', fileName: filePath?.split('/').pop() ?? 'text block', filePath, blockId: id }}
          renderToolbar={(toolbar) => (
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
              <HStack gap={1} minW={0} flex={1} onMouseDown={(e) => e.stopPropagation()} cursor="default">
                <LuGripVertical size={14} opacity={0.5} style={{ cursor: 'move' }} />
                {toolbar}
              </HStack>
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
    );
  }

  // View mode: render the Lexical read-only viewer.
  return (
    <Box p={4} height="100%" overflow="auto">
      {content ? (
        <LexicalTextViewer markdown={content} />
      ) : (
        <Box aria-label="Empty text block" color="fg.muted" fontSize="sm" fontStyle="italic">Empty text block</Box>
      )}
    </Box>
  );
}
