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
  readOnly?: boolean;
  filePath?: string;
  onCellChange: (id: string, partial: Partial<TextCell>) => void;
  onRemove: (id: string) => void;
}

export default function NotebookTextCell({
  cell, active = false, onActivate, readOnly = false, filePath, onCellChange, onRemove,
}: NotebookTextCellProps) {
  const [collapsed, setCollapsed] = useState(false);

  const handleContentChange = useCallback(
    (markdown: string) => onCellChange(cell.id, { content: markdown }),
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

  const chrome = (middle?: React.ReactNode) => (
    <NotebookCellHeader
      cellType="text"
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(c => !c)}
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
          initialMarkdown={cell.content}
          onChange={handleContentChange}
          onImageUpload={handleImageUpload}
          mentions={mentions}
          insertMenu
          renderToolbar={(toolbar) => chrome(toolbar)}
        />
      )}
    </Box>
  );
}
