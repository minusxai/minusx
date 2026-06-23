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

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || sel.isCollapsed()) { hide(); return; }
        const text = sel.getTextContent();
        if (!text.trim()) { hide(); return; }
        const domSel = window.getSelection();
        if (!domSel || domSel.rangeCount === 0) return;
        const rect = domSel.getRangeAt(0).getBoundingClientRect();
        setPosition({ x: rect.left, y: rect.bottom + 4 });
        setSelectedText(text);
      });
    });
  }, [editor, hide]);

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
