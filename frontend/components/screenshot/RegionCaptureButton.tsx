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
import { addChatAttachment, addPendingUpload, removePendingUpload, selectPendingUploads } from '@/store/uiSlice';
import { getStore } from '@/store/store';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { captureRegionBlob } from '@/lib/screenshot/capture';
import { toaster } from '@/components/ui/toaster';
import RegionSelectOverlay, { type SelectionRect } from '@/components/screenshot/RegionSelectOverlay';

export default function RegionCaptureButton() {
  const dispatch = useAppDispatch();
  const colorMode = useAppSelector(s => s.ui.colorMode);
  const [selecting, setSelecting] = useState(false);

  const handleSelect = useCallback(async (rect: SelectionRect) => {
    // Snapshot the capture target AND its viewport rect NOW — synchronously, in the same layout frame
    // as the user's selection (`rect` is in viewport coords) and BEFORE addPendingUpload reflows the
    // chat input or the async render runs. Passing this frozen box to captureRegionBlob keeps the crop
    // aligned no matter how slow the render is — without it the crop reads a drifted rect post-render,
    // which is the dev-vs-prod offset (prod renders fast enough to not drift; dev doesn't).
    // Capture the file view (the relevant content) rather than the whole document.body — body capture
    // is slow/unreliable on a complex SPA (it clones the entire app + inlines every stylesheet). Fall
    // back to body on pages with no file view (explore/folder).
    const target = (document.querySelector('[data-file-id]') as HTMLElement | null) ?? undefined;
    const targetBox = (target ?? document.body).getBoundingClientRect();
    setSelecting(false);
    // Register a pending upload so the chat input shows a "processing" chip and blocks send until
    // the image is ready (cancellable). Then YIELD so that chip paints before the capture runs —
    // the capture is synchronous DOM-clone + rasterize work that briefly freezes the main thread.
    const uploadId = crypto.randomUUID();
    dispatch(addPendingUpload({ id: uploadId, name: 'Screen selection' }));
    await new Promise((r) => setTimeout(r, 32));
    try {
      const blob = await captureRegionBlob(rect, {
        colorMode,
        target,
        targetBox,
        // Exclude the selection overlay from its own screenshot.
        filter: (node) => !(node instanceof HTMLElement && node.hasAttribute('data-region-select-overlay')),
      });
      const url = await uploadBlobOrEmbed(blob, 'selection.jpg', 'image/jpeg');
      // Cancel = discard on finish: only attach if the pending upload wasn't cancelled meanwhile.
      const cancelled = !selectPendingUploads(getStore().getState()).some(u => u.id === uploadId);
      dispatch(removePendingUpload(uploadId));
      if (!cancelled) {
        dispatch(addChatAttachment({ type: 'image', name: 'Screen selection', content: url, metadata: {} }));
      }
    } catch (err) {
      dispatch(removePendingUpload(uploadId));
      toaster.create({ title: err instanceof Error ? err.message : 'Could not capture the selection', type: 'error' });
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
