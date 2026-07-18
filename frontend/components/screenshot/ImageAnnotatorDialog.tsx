'use client';

/**
 * Image annotator: shows an image on a canvas with a red brush for markup.
 * Per-stroke undo (button + cmd/ctrl+Z). Used by the region-capture (crop) flow
 * before attaching, and by chat attachment thumbnails to re-annotate.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, CloseButton, Dialog, HStack, Portal, Text, Textarea } from '@chakra-ui/react';
import { LuUndo2 } from 'react-icons/lu';
import { AGENT_IMAGE_MAX_PX } from '@/lib/screenshot/constants';
import { cappedOutputDims } from '@/lib/screenshot/capture';

/** Brush colors offered in the annotator. Red is the default (first). */
const BRUSH_COLORS = [
  { name: 'red', value: '#ef4444' },
  { name: 'black', value: '#111827' },
  { name: 'white', value: '#ffffff' },
] as const;
const DEFAULT_BRUSH = BRUSH_COLORS[0].value;

/** A dot cursor tinted with the active brush color — doubles as a live hint of what you'll draw. */
const brushCursor = (color: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='5' fill='${color}' stroke='%23000' stroke-opacity='0.35' stroke-width='1'/></svg>`,
  )}") 8 8, crosshair`;

export interface ImageAnnotatorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Image to annotate: object URL, public URL, or data URL. */
  imageSrc: string | null;
  title?: string;
  confirmLabel?: string;
  /**
   * Called with the annotated image and the note the user typed (empty string if none). The image is
   * exported at the agent cap (AGENT_IMAGE_MAX_PX) regardless of the display resolution, so the LLM
   * payload stays small even though the annotator canvas is crisp. The dialog closes after.
   */
  onConfirm: (blob: Blob, note: string) => void | Promise<void>;
}

const MAX_UNDO = 40;

export default function ImageAnnotatorDialog({ isOpen, onClose, imageSrc, title = 'Annotate image', confirmLabel = 'Attach', onConfirm }: ImageAnnotatorDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const drawingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [note, setNote] = useState('');
  const [brushColor, setBrushColor] = useState<string>(DEFAULT_BRUSH);

  // Load the image whenever the dialog opens, then draw once BOTH the image and the
  // canvas exist. The dialog content mounts asynchronously (portal + presence), so the
  // image can finish loading before the canvas is in the DOM — poll a few frames for it.
  useEffect(() => {
    if (!isOpen || !imageSrc) return;
    setReady(false);
    setLoadError(false);
    setNote('');
    setBrushColor(DEFAULT_BRUSH);
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
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = 3 * scale();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [point, ready, scale, brushColor]);

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
      // Annotation happened on the full display-res canvas; downscale to the agent cap only now, so
      // the exported blob (what the LLM sees) is small while the on-screen crop stayed crisp.
      const { w, h } = cappedOutputDims(canvas.width, canvas.height, AGENT_IMAGE_MAX_PX);
      let exportCanvas = canvas;
      if (w !== canvas.width || h !== canvas.height) {
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const octx = out.getContext('2d');
        if (octx) { octx.drawImage(canvas, 0, 0, w, h); exportCanvas = out; }
      }
      const blob = await new Promise<Blob | null>(resolve => exportCanvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (blob) await onConfirm(blob, note.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  }, [onClose, onConfirm, ready, note]);

  // Only mount the dialog (and its focus scope) while open. Every ChatInput / RegionCaptureButton
  // instance renders one of these; if closed instances kept a live Dialog.Root, multiple modal
  // focus scopes coexist and fight over focus with the open one — that fight is what made the note
  // field un-typeable and flickered the floating composer. Rendering null when closed leaves exactly
  // one focus scope. (Hooks above always run, so this early return is Rules-of-Hooks safe.)
  if (!isOpen) return null;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => { if (!e.open) onClose(); }} size="lg">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.surface" borderRadius="lg" border="1px solid" borderColor="border.default" shadow="xl" maxW="720px">
            <Dialog.Header py={3}>
              {/* pe clears the absolutely-positioned close ✕ so Undo never sits under it. */}
              <HStack justify="space-between" w="100%" pe={10}>
                <Dialog.Title fontFamily="mono" fontSize="sm">{title}</Dialog.Title>
                <Button size="xs" variant="outline" onClick={undo} aria-label="undo-brush" disabled={!ready}>
                  <LuUndo2 /> Undo
                </Button>
              </HStack>
            </Dialog.Header>
            <Dialog.Body py={2}>
              {loadError ? (
                <Text fontSize="sm" color="fg.muted" aria-label="annotator-load-error">Could not load the image for annotation.</Text>
              ) : (
                <>
                <HStack justify="space-between" mb={2} gap={3}>
                  <Text fontSize="xs" color="fg.muted" aria-label="annotator-hint">
                    Draw on the image to circle or highlight anything — drag to draw, Undo to remove.
                  </Text>
                  <HStack gap={1.5} flexShrink={0} aria-label="annotator-palette">
                    {BRUSH_COLORS.map(({ name, value }) => {
                      const selected = brushColor === value;
                      return (
                        <Box
                          key={value}
                          as="button"
                          aria-label={`brush-color-${name}`}
                          aria-pressed={selected}
                          onClick={() => setBrushColor(value)}
                          w="18px"
                          h="18px"
                          borderRadius="full"
                          bg={value}
                          cursor="pointer"
                          border="1px solid"
                          borderColor="border.emphasized"
                          outline={selected ? '2px solid' : 'none'}
                          outlineColor="accent.teal"
                          outlineOffset="1px"
                        />
                      );
                    })}
                  </HStack>
                </HStack>
                <canvas
                  ref={canvasRef}
                  aria-label="annotator-canvas"
                  // Fit the crop within the viewport (no dialog scroll) while preserving aspect: cap
                  // both axes and let the browser scale the bitmap down. Uniform scale keeps the
                  // brush→canvas coordinate mapping (which reads one scale factor) correct.
                  style={{ display: 'block', margin: '0 auto', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '55vh', cursor: brushCursor(brushColor), borderRadius: 6 }}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                />
                </>
              )}
              <Textarea
                aria-label="annotator-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note (optional) — it goes into the chat box"
                size="sm"
                rows={2}
                mt={3}
                fontFamily="mono"
                fontSize="sm"
                resize="none"
              />
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
