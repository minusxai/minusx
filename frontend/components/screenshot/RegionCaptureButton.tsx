'use client';

/**
 * RegionCaptureButton — the chat-input trigger for "select a screen region → add as context".
 * Click it to enter drag-select mode (a portaled RegionSelectOverlay); on selection it captures
 * that region (captureRegionBlob, excluding the overlay itself), uploads it via the SAME path as
 * pasted images (uploadBlobOrEmbed), and adds it as an image attachment (addChatAttachment) — so
 * it flows to the agent exactly like any other image attachment.
 */
import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Icon } from '@chakra-ui/react';
import { LuScan } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { addChatAttachment } from '@/store/uiSlice';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { captureRegionBlob } from '@/lib/screenshot/capture';
import { toaster } from '@/components/ui/toaster';
import RegionSelectOverlay, { type SelectionRect } from '@/components/screenshot/RegionSelectOverlay';

export default function RegionCaptureButton() {
  const dispatch = useAppDispatch();
  const colorMode = useAppSelector(s => s.ui.colorMode);
  const [selecting, setSelecting] = useState(false);

  const handleSelect = useCallback(async (rect: SelectionRect) => {
    setSelecting(false);
    // Show a loading indicator, then YIELD so it paints before html-to-image runs: the capture is
    // synchronous DOM-clone + rasterize work on the main thread, so the UI briefly freezes — this
    // at least signals that something is happening.
    const toastId = toaster.create({ title: 'Capturing selection…', type: 'loading' });
    await new Promise((r) => setTimeout(r, 32));
    try {
      // Capture the file view (the relevant content) rather than the whole document.body —
      // body capture is slow/unreliable on a complex SPA (it clones the entire app + inlines
      // every stylesheet). Fall back to body on pages with no file view (explore/folder).
      const target = (document.querySelector('[data-file-id]') as HTMLElement | null) ?? undefined;
      const blob = await captureRegionBlob(rect, {
        colorMode,
        target,
        // Exclude the selection overlay from its own screenshot.
        filter: (node) => !(node instanceof HTMLElement && node.hasAttribute('data-region-select-overlay')),
      });
      const url = await uploadBlobOrEmbed(blob, 'selection.jpg', 'image/jpeg');
      dispatch(addChatAttachment({ type: 'image', name: 'Screen selection', content: url, metadata: {} }));
      toaster.update(toastId, { title: 'Selection added as context', type: 'success' });
    } catch (err) {
      toaster.update(toastId, { title: err instanceof Error ? err.message : 'Could not capture the selection', type: 'error' });
    }
  }, [colorMode, dispatch]);

  return (
    <>
      <IconButton
        aria-label="Select a screen region to add as context"
        onClick={() => setSelecting(true)}
        variant="ghost"
        size="xs"
        color="fg.muted"
        _hover={{ color: 'accent.teal' }}
        borderRadius="md"
        flexShrink={0}
      >
        <Icon as={LuScan} boxSize={3.5} />
      </IconButton>
      {selecting && typeof document !== 'undefined' &&
        createPortal(<RegionSelectOverlay onSelect={handleSelect} onCancel={() => setSelecting(false)} />, document.body)}
    </>
  );
}
