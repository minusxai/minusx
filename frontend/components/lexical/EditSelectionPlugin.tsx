'use client';

/**
 * EditSelectionPlugin — renders a floating "Interact with {agentName}" pill anchored to
 * a non-collapsed text selection in the Lexical editor (see EditWithAgentPopover).
 * Modeled on InsertMenuPlugin: it watches selection via registerUpdateListener and
 * positions itself from the DOM range rect. Works in read-only editors too —
 * editing happens through chat, not the editor.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { $getSelection, $isRangeSelection } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import EditWithAgentPopover from '@/components/EditWithAgentPopover';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';

export function EditSelectionPlugin({ source }: { source: EditWithAgentSource }) {
  const [editor] = useLexicalComposerContext();
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  // Once the user opens the textbox, focus leaves the editor and the selection
  // collapses — pin the popover so it survives that until explicitly closed.
  const pinnedRef = useRef(false);

  const hide = useCallback(() => {
    if (pinnedRef.current) return;
    setPosition(null);
    setSelectedText('');
  }, []);

  // Show the pill at the CURRENT selection — only called once a selection gesture
  // finishes (mouse-up / key-up), so the pill doesn't follow the cursor mid-drag.
  const showAtSelection = useCallback(() => {
    if (pinnedRef.current) return;
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel) || sel.isCollapsed()) { hide(); return; }
      const text = sel.getTextContent();
      if (!text.trim()) { hide(); return; }
      const domSel = window.getSelection();
      if (!domSel || domSel.rangeCount === 0) return;
      // Anchor at the END of the selection (last line, right edge), like the SQL
      // editor — the popover clamps to the viewport if there isn't room.
      const range = domSel.getRangeAt(0);
      const rects = range.getClientRects?.();
      const rect = rects && rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      setPosition({ x: rect.right, y: rect.bottom + 4 });
      setSelectedText(text);
    });
  }, [editor, hide]);

  // Hide as soon as the selection collapses (caret click, typing) — but never SHOW
  // from here, so the pill stays put while the user drags out a selection.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || sel.isCollapsed()) hide();
      });
    });
  }, [editor, hide]);

  // Reveal only when a selection gesture completes.
  useEffect(() => {
    const onMouseUp = () => requestAnimationFrame(showAtSelection);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === 'Shift') requestAnimationFrame(showAtSelection);
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [showAtSelection]);

  // Hide on scroll (the anchored rect would otherwise drift).
  useEffect(() => {
    const onScroll = () => hide();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [hide]);

  const handleClose = useCallback(() => {
    pinnedRef.current = false;
    setPosition(null);
    setSelectedText('');
  }, []);

  return (
    <EditWithAgentPopover
      position={position}
      selectedText={selectedText}
      source={source}
      onClose={handleClose}
      onInteractStart={() => { pinnedRef.current = true; }}
    />
  );
}
