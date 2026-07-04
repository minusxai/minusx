'use client';

/**
 * NotebookTextCell — a rich-text cell, edited with the same LexicalTextEditor
 * used for context docs (content stored as markdown). Collapsible. When
 * expanded, the cell chrome (collapse / name / delete) shares ONE row with the
 * Lexical toolbar via the editor's `renderToolbar` slot, so there's a single
 * toolbar level. Image upload (type "+") and @ / @@ mentions (tables, questions)
 * are wired like the context docs editor.
 */
import { useCallback, useMemo, useState } from 'react';
import { Box } from '@chakra-ui/react';
import NotebookCellHeader from './NotebookCellHeader';
import LexicalTextEditor, { LexicalTextViewer, type MentionsConfig } from '@/components/lexical/LexicalTextEditor';
import { uploadFile } from '@/lib/object-store/client';
import { toaster } from '@/components/ui/toaster';
import { useContext as useSchemaContext } from '@/lib/hooks/useContext';
import type { NotebookTextCell as TextCell } from '@/lib/types';

interface NotebookTextCellProps {
  cell: TextCell;
  active?: boolean;
  onActivate?: (cellId: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  readOnly?: boolean;
  /** Present mode: show just the rendered markdown, no chrome. */
  presentMode?: boolean;
  filePath?: string;
  onCellChange: (id: string, partial: Partial<TextCell>) => void;
  onRemove: (id: string) => void;
}

export default function NotebookTextCell({
  cell, active = false, onActivate, collapsed = false, onToggleCollapse,
  readOnly = false, presentMode = false, filePath, onCellChange, onRemove,
}: NotebookTextCellProps) {
  // LexicalTextEditor seeds its content from `initialMarkdown` only on mount, so
  // an EXTERNAL edit (e.g. the agent's EditFile) to cell.content wouldn't show.
  // Track what this editor last emitted; when cell.content arrives as a value we
  // didn't emit, it's an external change — bump `syncKey` to remount the editor and
  // re-seed it. Our own edits echo back equal to `lastEmitted` → no remount, so the
  // user's typing/cursor is never disrupted (the emit + the Redux round-trip batch
  // into one render, so `lastEmitted` is current by the time the echo arrives).
  // Adjusting state during render is React's "reset on prop change" pattern.
  const [lastEmitted, setLastEmitted] = useState(cell.content);
  const [seenContent, setSeenContent] = useState(cell.content);
  const [syncKey, setSyncKey] = useState(0);
  if (cell.content !== seenContent) {
    setSeenContent(cell.content);
    if (cell.content !== lastEmitted) setSyncKey(k => k + 1);
  }

  const handleContentChange = useCallback(
    (markdown: string) => {
      setLastEmitted(markdown);
      onCellChange(cell.id, { content: markdown });
    },
    [onCellChange, cell.id],
  );

  const activate = useCallback(() => {
    if (!active) onActivate?.(cell.id);
  }, [active, onActivate, cell.id]);

  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    try {
      const { publicUrl } = await uploadFile(file);
      return publicUrl;
    } catch (err: unknown) {
      toaster.create({ title: err instanceof Error ? err.message : 'Failed to upload image', type: 'error' });
      return '';
    }
  }, []);

  // @ / @@ mention typeahead over the notebook context's tables + questions.
  const { databases: schemaData } = useSchemaContext(filePath || '/org');
  const mentions = useMemo<MentionsConfig>(() => ({ whitelistedSchemas: schemaData }), [schemaData]);

  // Present mode: render just the rendered markdown (skip empty cells).
  if (presentMode) {
    if (!cell.content?.trim()) return null;
    return <Box py={1}><LexicalTextViewer markdown={cell.content} /></Box>;
  }

  const chrome = (middle?: React.ReactNode) => (
    <NotebookCellHeader
      cellType="text"
      collapsed={collapsed}
      onToggleCollapse={() => onToggleCollapse?.()}
      name={cell.name ?? ''}
      onNameChange={(name) => onCellChange(cell.id, { name })}
      onRemove={() => onRemove(cell.id)}
      readOnly={readOnly}
      middle={middle}
    />
  );

  return (
    <Box
      borderWidth="1px"
      borderColor={active ? 'accent.teal' : 'border.muted'}
      borderRadius="md"
      bg="bg.canvas"
      overflow="hidden"
      transition="border-color 0.15s, box-shadow 0.15s"
      boxShadow={active ? '0 0 0 2px var(--chakra-colors-accent-teal)' : undefined}
      _hover={{ borderColor: active ? 'accent.teal' : 'border.default' }}
      onMouseDownCapture={activate}
      onFocusCapture={activate}
    >
      {collapsed || readOnly ? (
        <>
          {chrome()}
          {!collapsed && readOnly && <LexicalTextViewer markdown={cell.content} />}
        </>
      ) : (
        <LexicalTextEditor
          key={syncKey}
          initialMarkdown={cell.content}
          onChange={handleContentChange}
          onImageUpload={handleImageUpload}
          mentions={mentions}
          insertMenu
          editWithAgent={{ editorKind: 'richtext', fileName: cell.name?.trim() || filePath?.split('/').pop() || 'notebook cell', filePath, blockId: cell.id }}
          renderToolbar={(toolbar) => chrome(toolbar)}
        />
      )}
    </Box>
  );
}
