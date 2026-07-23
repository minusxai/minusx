'use client';

/**
 * TextBlockCard — a dashboard rich-text block, edited with the same
 * LexicalTextEditor used for notebook text cells and context docs (content
 * stored as markdown). Image upload (type "+") and @ / @@ mentions (tables,
 * questions) are wired like the notebook text cell editor.
 *
 * Interaction model (true WYSIWYG):
 *  - The body is always directly editable and uses the SAME tight padding as the
 *    read-only view, so editing looks pixel-identical to viewing — no toolbar
 *    shifts anything. Formatting is a floating bubble that appears over the text
 *    only while you have a selection (see FloatingSelectionToolbar).
 *  - Drag + remove are small controls that fade in on hover (absolute, so they
 *    never take layout space).
 *  - View mode: if the text genuinely overflows the cell, a gradient fade +
 *    "Read more" pill grows the grid cell (via `onResize`); "Show less" restores.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LuX, LuGripVertical, LuChevronDown, LuChevronUp } from 'react-icons/lu';
import LexicalTextEditor, { LexicalTextViewer, SHARED_TEXT_PADDING, type MentionsConfig } from '@/components/lexical/LexicalTextEditor';
import { uploadFile } from '@/lib/object-store/client';
import { toaster } from '@/components/ui/toaster';
import { useContext as useSchemaContext } from '@/lib/hooks/useContext';

/** Only offer "Read more" once at least this many px of content is actually hidden. */
const OVERFLOW_THRESHOLD_PX = 24;

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

function TextBlockCard({
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

  // Detect whether content overflows its cell by a meaningful amount (view mode
  // only). The threshold stops a one-line heading from getting a false "Read more".
  useEffect(() => {
    if (editMode || !contentRef.current) return;
    const el = contentRef.current;
    const check = () => setIsOverflowing(el.scrollHeight > el.clientHeight + OVERFLOW_THRESHOLD_PX);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [editMode, content, expanded]);

  const handleExpand = useCallback(() => {
    setExpanded(true);
    // Extra room for the "Show less" button + padding.
    if (onResize && contentRef.current) onResize(id, contentRef.current.scrollHeight + 48);
  }, [id, onResize]);

  const handleCollapse = useCallback(() => {
    setExpanded(false);
    onResize?.(id, null);
  }, [id, onResize]);

  if (editMode) {
    return (
      <div className="group/tb relative flex h-full flex-col">
        <LexicalTextEditor
          key={syncKey}
          initialMarkdown={content}
          onChange={handleContentChange}
          onImageUpload={handleImageUpload}
          mentions={mentions}
          insertMenu
          floatingToolbar
          verticalCenter
          // Same tight padding as the viewer, so the text sits in the exact same
          // place whether editing or viewing.
          contentPadding={SHARED_TEXT_PADDING}
          editWithAgent={{ editorKind: 'richtext', fileName: filePath?.split('/').pop() ?? 'text block', filePath, blockId: id }}
        />

        {/* Hover controls: drag grip + remove. Absolute so they never affect the
            text layout; fade in on hover of the block. */}
        <div className="absolute top-1 right-1 z-[2] flex gap-1 opacity-0 transition-opacity duration-100 group-hover/tb:opacity-100">
          <div
            className="drag-handle flex cursor-grab items-center rounded-md border border-border bg-popover px-1 py-1 text-muted-foreground shadow-xs active:cursor-grabbing"
            aria-label="Move text block"
          >
            <LuGripVertical size={14} />
          </div>
          <button
            type="button"
            onClick={() => onRemove(id)}
            aria-label="Remove text block"
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md bg-popover text-destructive shadow-xs transition-transform duration-100 hover:scale-115"
          >
            <LuX size={14} />
          </button>
        </div>
      </div>
    );
  }

  // --- View mode ---
  const showFade = isOverflowing && !expanded;

  return (
    <div className="relative flex h-full flex-col">
      <div
        ref={contentRef}
        className={`min-h-0 flex-1 ${expanded ? 'overflow-visible' : 'overflow-hidden'}`}
      >
        {content ? (
          <LexicalTextViewer markdown={content} padding={SHARED_TEXT_PADDING} verticalCenter={!expanded} />
        ) : (
          <div className="p-4 text-sm italic text-muted-foreground" aria-label="Empty text block">Empty text block</div>
        )}
      </div>

      {/* Gradient fade + Read more */}
      {showFade && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-20 items-end justify-center bg-gradient-to-t from-muted via-muted to-transparent pb-2">
          <button
            type="button"
            onClick={handleExpand}
            aria-label="Expand text block"
            className="pointer-events-auto inline-flex items-center rounded-full border border-primary bg-muted px-4 py-1 text-xs font-medium text-primary transition-all duration-150 hover:bg-primary hover:text-primary-foreground"
          >
            <LuChevronDown size={11} />
            <span className="ml-1">Read more</span>
          </button>
        </div>
      )}

      {/* Show less — sits below the (now fully visible) content */}
      {expanded && (
        <div className="flex shrink-0 justify-center py-2">
          <button
            type="button"
            onClick={handleCollapse}
            aria-label="Collapse text block"
            className="inline-flex items-center rounded-full border border-primary px-4 py-1 text-xs font-medium text-primary transition-all duration-150 hover:bg-primary hover:text-primary-foreground"
          >
            <LuChevronUp size={11} />
            <span className="ml-1">Show less</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Memoized so editing one text block doesn't re-render the others. The parent
// (DashboardView) passes referentially-stable callbacks + per-asset content, so
// only the block whose content actually changed re-renders.
export default memo(TextBlockCard);
