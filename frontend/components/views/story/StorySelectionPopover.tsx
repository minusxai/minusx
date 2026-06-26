'use client';

/**
 * StorySelectionPopover — renders the floating "Interact with {agentName}" pill anchored
 * to a non-collapsed text selection inside a story's iframe (see EditWithAgentPopover).
 * It is the story-edit-mode counterpart of EditSelectionPlugin (Lexical) and the SQL
 * editor's popover: selecting text → Ask / Edit that selection via chat.
 *
 * Two story-specific wrinkles vs. the Lexical plugin:
 *  - The story body lives in a same-origin IFRAME, so the selection is read via the iframe's
 *    `contentWindow.getSelection()` and its events are listened for on the iframe's `contentDocument`
 *    (iframe events do NOT bubble to the parent document). The selection rect is in the iframe's
 *    coordinate space, so we offset it by the iframe's bounding box to position the pill in the page.
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
  /** The iframe whose document holds the rendered story. */
  iframeRef: RefObject<HTMLIFrameElement | null>;
  source: EditWithAgentSource;
  /** Only watch for selections while the story is in edit mode. */
  active: boolean;
}

export default function StorySelectionPopover({ iframeRef, source, active }: StorySelectionPopoverProps) {
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

  // Show the pill at the CURRENT selection (in iframe coords → offset to page coords) — only called
  // once a selection gesture finishes, so the pill doesn't follow the cursor mid-drag.
  const showAtSelection = useCallback(() => {
    if (pinnedRef.current) return;
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow ?? null;
    const result = computeSelectionPopoverPosition(getShadowRootSelection(win));
    if (!result || !iframe) { hide(); return; }
    const box = iframe.getBoundingClientRect();
    setPosition({ x: result.x + box.left, y: result.y + box.top });
    setSelectedText(result.text);
  }, [iframeRef, hide]);

  // Reveal only when a selection gesture completes, and only in edit mode. Listen on the IFRAME's
  // document — its events don't reach the parent. Re-bind when the iframe document changes.
  useEffect(() => {
    if (!active) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const onMouseUp = () => requestAnimationFrame(showAtSelection);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === 'Shift') requestAnimationFrame(showAtSelection);
    };
    doc.addEventListener('mouseup', onMouseUp);
    doc.addEventListener('keyup', onKeyUp);
    return () => {
      doc.removeEventListener('mouseup', onMouseUp);
      doc.removeEventListener('keyup', onKeyUp);
      pinnedRef.current = false;
      setPosition(null);
      setSelectedText('');
    };
  }, [active, showAtSelection, iframeRef]);

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
