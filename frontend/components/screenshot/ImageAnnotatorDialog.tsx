'use client';

/**
 * Image annotator: shows an image on a canvas with a red brush for markup.
 * Per-stroke undo (button + cmd/ctrl+Z). Used by the region-capture (crop) flow
 * before attaching, and by chat attachment thumbnails to re-annotate.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, CloseButton, Dialog, HStack, Portal, Text } from '@chakra-ui/react';
import { LuUndo2 } from 'react-icons/lu';

export interface ImageAnnotatorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Image to annotate: object URL, public URL, or data URL. */
  imageSrc: string | null;
  title?: string;
  confirmLabel?: string;
  /** Called with the annotated image; the dialog closes after. */
  onConfirm: (blob: Blob) => void | Promise<void>;
}

const MAX_UNDO = 40;

export default function ImageAnnotatorDialog({ isOpen, onClose, imageSrc, title = 'Annotate image', confirmLabel = 'Attach', onConfirm }: ImageAnnotatorDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const drawingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Load the image whenever the dialog opens, then draw once BOTH the image and the
  // canvas exist. The dialog content mounts asynchronously (portal + presence), so the
  // image can finish loading before the canvas is in the DOM — poll a few frames for it.
  useEffect(() => {
    if (!isOpen || !imageSrc) return;
    setReady(false);
    setLoadError(false);
    undoStackRef.current = [];
    let cancelled = false;
    let attempts = 0;
    const img = new Image();
    const drawWhenReady = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        if (attempts++ < 120) { requestAnimationFrame(drawWhenReady); return; }
        setLoadError(true);
        return;
      }
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      setReady(true);
    };
    img.crossOrigin = 'anonymous'; // object-store URLs may be cross-origin; needed for export
    img.onload = drawWhenReady;
    img.onerror = () => { if (!cancelled) setLoadError(true); };
    img.src = imageSrc;
    return () => { cancelled = true; };
  }, [isOpen, imageSrc]);

  const scale = useCallback(() => {
    const canvas = canvasRef.current!;
    return canvas.width / canvas.getBoundingClientRect().width;
  }, []);

  const point = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const s = scale();
    return [(e.clientX - rect.left) * s, (e.clientY - rect.top) * s] as const;
  }, [scale]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !ready) return;
    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    drawingRef.current = true;
    const [x, y] = point(e);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3 * scale();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [point, ready, scale]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!drawingRef.current || !ctx) return;
    const [x, y] = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }, [point]);

  const undo = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const snapshot = undoStackRef.current.pop();
    if (canvas && ctx && snapshot) ctx.putImageData(snapshot, 0, 0);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onUp = () => { drawingRef.current = false; };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
    };
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mouseup', onUp); window.removeEventListener('keydown', onKey); };
  }, [isOpen, undo]);

  const confirm = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (blob) await onConfirm(blob);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [onClose, onConfirm, ready]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => { if (!e.open) onClose(); }} size="lg">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.surface" borderRadius="lg" border="1px solid" borderColor="border.default" shadow="xl" maxW="720px">
            <Dialog.Header py={3}>
              <HStack justify="space-between" w="100%">
                <Dialog.Title fontFamily="mono" fontSize="sm">{title}</Dialog.Title>
                <HStack>
                  <Button size="xs" variant="outline" onClick={undo} aria-label="undo-brush" disabled={!ready}>
                    <LuUndo2 /> Undo
                  </Button>
                </HStack>
              </HStack>
            </Dialog.Header>
            <Dialog.Body py={2}>
              {loadError ? (
                <Text fontSize="sm" color="fg.muted" aria-label="annotator-load-error">Could not load the image for annotation.</Text>
              ) : (
                <canvas
                  ref={canvasRef}
                  aria-label="annotator-canvas"
                  style={{ display: 'block', width: '100%', cursor: 'crosshair', borderRadius: 6 }}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                />
              )}
            </Dialog.Body>
            <Dialog.Footer py={3}>
              <Button size="sm" variant="outline" onClick={onClose} aria-label="annotator-cancel">Cancel</Button>
              <Button size="sm" colorPalette="teal" onClick={confirm} loading={saving} disabled={!ready} aria-label="annotator-confirm">
                {confirmLabel}
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" aria-label="annotator-close" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
