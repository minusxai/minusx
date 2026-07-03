'use client';

/**
 * TextBlockCard — a dashboard rich-text block, edited with the same
 * LexicalTextEditor used for notebook text cells and context docs (content
 * stored as markdown). Image upload (type "+") and @ / @@ mentions (tables,
 * questions) are wired like the notebook text cell editor.
 *
 * Interaction model:
 *  - Edit mode: the body is always directly editable. A solid toolbar bar sits
 *    at the top; you drag the block by grabbing that bar (the grip or any empty
 *    space — the buttons stop propagation so they don't start a drag).
 *  - View mode: renders the read-only viewer. If the text overflows the cell, a
 *    gradient fade + "Read more" pill grows the grid cell (via `onResize`);
 *    "Show less" restores it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, HStack, IconButton, Button, Text } from '@chakra-ui/react';
import { LuX, LuGripVertical, LuChevronDown, LuChevronUp } from 'react-icons/lu';
import LexicalTextEditor, { LexicalTextViewer, SHARED_TEXT_PADDING, type MentionsConfig } from '@/components/lexical/LexicalTextEditor';
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
  /** Grow/restore the grid cell for "Read more". Passes the desired pixel height, or null to restore. */
  onResize?: (id: string, height: number | null) => void;
}

export default function TextBlockCard({
  id,
  content,
  editMode,
  filePath,
  onContentChange,
  onRemove,
  onResize,
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

  // --- Read more / overflow (view mode) ---
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Leaving/entering edit mode collapses any "Read more" expansion.
  const [prevEditMode, setPrevEditMode] = useState(editMode);
  if (prevEditMode !== editMode) {
    setPrevEditMode(editMode);
    if (expanded) {
      setExpanded(false);
      onResize?.(id, null);
    }
  }

  // Detect whether content overflows its cell (view mode only).
  useEffect(() => {
    if (editMode || !contentRef.current) return;
    const el = contentRef.current;
    const check = () => setIsOverflowing(el.scrollHeight > el.clientHeight + 4);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [editMode, content, expanded]);

  const handleExpand = useCallback(() => {
    setExpanded(true);
    // Extra room for the "Show less" button + padding.
    if (onResize && contentRef.current) onResize(id, contentRef.current.scrollHeight + 80);
  }, [id, onResize]);

  const handleCollapse = useCallback(() => {
    setExpanded(false);
    onResize?.(id, null);
  }, [id, onResize]);

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
          // SAME padding as the viewer (view mode), so the text lands in the exact
          // same spot whether editing or viewing. The toolbar floats within the
          // reserved top band below — it never pushes the text.
          contentPadding={SHARED_TEXT_PADDING}
          editWithAgent={{ editorKind: 'richtext', fileName: filePath?.split('/').pop() ?? 'text block', filePath, blockId: id }}
          renderToolbar={(toolbar) => (
            // Solid toolbar bar, overlaid in the reserved top padding band
            // (absolute, not in-flow) so its presence never shifts the text.
            // The whole bar is a `.drag-handle` (cursor: move) so the block drags
            // from the grip or any empty space. Only the buttons stop propagation,
            // so clicking them formats instead of starting a drag.
            <HStack
              className="drag-handle"
              cursor="move"
              position="absolute"
              top={0}
              left={0}
              right={0}
              zIndex={2}
              gap={1}
              px={2}
              py={1}
              bg="bg.muted"
              borderTopRadius="md"
              borderBottomWidth="1px"
              borderColor="border.default"
            >
              <LuGripVertical size={14} opacity={0.5} style={{ cursor: 'move' }} />
              <HStack gap={1} minW={0} overflowX="auto" onMouseDown={(e) => e.stopPropagation()} cursor="default">
                {toolbar}
              </HStack>
              {/* draggable filler — grab anywhere between the buttons and the ✕ */}
              <Box flex={1} alignSelf="stretch" minW={2} />
              <IconButton
                onClick={() => onRemove(id)}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Remove text block"
                size="2xs"
                variant="ghost"
                color="accent.danger"
                cursor="pointer"
                _hover={{ transform: 'scale(1.15)' }}
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

  // --- View mode ---
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
          <LexicalTextViewer markdown={content} padding={SHARED_TEXT_PADDING} />
        ) : (
          <Box p={4} aria-label="Empty text block" color="fg.muted" fontSize="sm" fontStyle="italic">Empty text block</Box>
        )}
      </Box>

      {/* Gradient fade + Read more */}
      {showFade && (
        <Box
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          height="96px"
          bgGradient="to-t"
          gradientFrom="bg.subtle"
          gradientVia="bg.subtle"
          gradientTo="transparent"
          display="flex"
          alignItems="flex-end"
          justifyContent="center"
          pb={3}
          pointerEvents="none"
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
            fontWeight={500}
            borderRadius="full"
            px={4}
            pointerEvents="auto"
            _hover={{ bg: 'accent.teal', color: 'white', borderColor: 'accent.teal' }}
            transition="all 0.15s"
          >
            <LuChevronDown size={11} />
            <Text ml={1}>Read more</Text>
          </Button>
        </Box>
      )}

      {/* Show less — sits below the (now fully visible) content */}
      {expanded && (
        <Box flexShrink={0} display="flex" justifyContent="center" py={3} borderTopWidth="1px" borderColor="border.muted">
          <Button
            size="xs"
            variant="outline"
            onClick={handleCollapse}
            aria-label="Collapse text block"
            borderColor="accent.teal"
            color="accent.teal"
            fontSize="xs"
            fontWeight={500}
            borderRadius="full"
            px={4}
            _hover={{ bg: 'accent.teal', color: 'white', borderColor: 'accent.teal' }}
            transition="all 0.15s"
          >
            <LuChevronUp size={11} />
            <Text ml={1}>Show less</Text>
          </Button>
        </Box>
      )}
    </Box>
  );
}
