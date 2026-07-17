'use client';

/**
 * RegionCaptureButton — the chat-input trigger for "select a screen region → add as context".
 * Click it to enter drag-select mode (a portaled RegionSelectOverlay); on selection it captures
 * that region (captureRegionBlob, excluding the overlay itself), opens the annotator (brush +
 * undo) so the user can mark up the crop, then uploads the annotated image via the SAME path as
 * pasted images (uploadBlobOrEmbed) and adds it as an image attachment (addChatAttachment) — so
 * it flows to the agent exactly like any other image attachment.
 */
import { useState, useCallback, useEffect } from 'react';
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
import ImageAnnotatorDialog from '@/components/screenshot/ImageAnnotatorDialog';

export default function RegionCaptureButton() {
  const dispatch = useAppDispatch();
  const colorMode = useAppSelector(s => s.ui.colorMode);
  const [selecting, setSelecting] = useState(false);
  // Captured crop waiting in the annotator: object URL + the pending-upload id it holds open.
  const [pendingCrop, setPendingCrop] = useState<{ objectUrl: string; uploadId: string } | null>(null);

  useEffect(() => () => { if (pendingCrop) URL.revokeObjectURL(pendingCrop.objectUrl); }, [pendingCrop]);

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
    // the annotator resolves (cancellable). Then YIELD so that chip paints before the capture runs —
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
      // Hand the crop to the annotator; attach happens on confirm (annotateConfirm below).
      setPendingCrop({ objectUrl: URL.createObjectURL(blob), uploadId });
    } catch (err) {
      dispatch(removePendingUpload(uploadId));
      toaster.create({ title: err instanceof Error ? err.message : 'Could not capture the selection', type: 'error' });
    }
  }, [colorMode, dispatch]);

  const annotateConfirm = useCallback(async (blob: Blob) => {
    if (!pendingCrop) return;
    try {
      const url = await uploadBlobOrEmbed(blob, 'selection.jpg', 'image/jpeg');
      // Cancel = discard on finish: only attach if the pending upload wasn't cancelled meanwhile.
      const cancelled = !selectPendingUploads(getStore().getState()).some(u => u.id === pendingCrop.uploadId);
      dispatch(removePendingUpload(pendingCrop.uploadId));
      if (!cancelled) {
        dispatch(addChatAttachment({ type: 'image', name: 'Screen selection', content: url, metadata: {} }));
      }
    } catch (err) {
      dispatch(removePendingUpload(pendingCrop.uploadId));
      toaster.create({ title: err instanceof Error ? err.message : 'Could not upload the selection', type: 'error' });
    }
  }, [dispatch, pendingCrop]);

  const annotateClose = useCallback(() => {
    if (pendingCrop) {
      // Dialog dismissed without confirming → discard the crop entirely.
      dispatch(removePendingUpload(pendingCrop.uploadId));
      URL.revokeObjectURL(pendingCrop.objectUrl);
      setPendingCrop(null);
    }
  }, [dispatch, pendingCrop]);

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
      <ImageAnnotatorDialog
        isOpen={pendingCrop !== null}
        onClose={annotateClose}
        imageSrc={pendingCrop?.objectUrl ?? null}
        title="Annotate selection"
        confirmLabel="Attach"
        onConfirm={annotateConfirm}
      />
    </>
  );
}
