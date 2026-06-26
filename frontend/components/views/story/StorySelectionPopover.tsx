'use client';

/**
 * StorySelectionPopover — renders the floating "Interact with {agentName}" pill anchored
 * to a non-collapsed text selection inside a story's shadow root (see EditWithAgentPopover).
 * It is the story-edit-mode counterpart of EditSelectionPlugin (Lexical) and the SQL
 * editor's popover: selecting text → Ask / Edit that selection via chat.
 *
 * Two story-specific wrinkles vs. the Lexical plugin:
 *  - The story body lives in a SHADOW ROOT, so the selection is read via
 *    getShadowRootSelection (Chrome's shadowRoot.getSelection, else the document one).
 *    mouse/key events from an OPEN shadow root are composed → they still bubble to
 *    `document`, so the document-level listeners fire as usual.
 *  - It is gated on `active` (edit mode only) — reading is a non-editable surface.
 */

import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import EditWithAgentPopover from '@/components/EditWithAgentPopover';
import {
  computeSelectionPopoverPosition,
  getShadowRootSelection,
  type EditWithAgentSource,
} from '@/lib/chat/edit-with-agent';

interface StorySelectionPopoverProps {
  /** Host element whose `.shadowRoot` holds the rendered story. */
  hostRef: RefObject<HTMLDivElement | null>;
  source: EditWithAgentSource;
  /** Only watch for selections while the story is in edit mode. */
  active: boolean;
}

export default function StorySelectionPopover({ hostRef, source, active }: StorySelectionPopoverProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  // Once the user opens the textbox, focus leaves the story and the selection
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
    const root = hostRef.current?.shadowRoot ?? null;
    const result = computeSelectionPopoverPosition(getShadowRootSelection(root));
    if (!result) { hide(); return; }
    setPosition({ x: result.x, y: result.y });
    setSelectedText(result.text);
  }, [hostRef, hide]);

  // Reveal only when a selection gesture completes, and only in edit mode. When edit
  // mode turns off (or on unmount) the cleanup unpins + clears any stale pill.
  useEffect(() => {
    if (!active) return;
    const onMouseUp = () => requestAnimationFrame(showAtSelection);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === 'Shift') requestAnimationFrame(showAtSelection);
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onKeyUp);
      pinnedRef.current = false;
      setPosition(null);
      setSelectedText('');
    };
  }, [active, showAtSelection]);

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

  if (!active) return null;

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
