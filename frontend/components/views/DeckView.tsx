'use client';

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Box, HStack, VStack, Text, IconButton, Button } from '@chakra-ui/react';
import { LuPlus, LuTrash2, LuType, LuPresentation, LuChevronLeft, LuChevronRight, LuX, LuPlay } from 'react-icons/lu';
import Moveable from 'react-moveable';

import { AssetReference, InlineAsset, DeckSlide } from '@/lib/types';
import SmartEmbeddedQuestionContainer from '../containers/SmartEmbeddedQuestionContainer';
import LexicalTextEditor, { LexicalTextViewer } from '../lexical/LexicalTextEditor';
import ChartPicker, { PickableQuestion } from './ChartPicker';
import { useAppSelector } from '@/store/hooks';

const CANVAS_MAX_W = 960;
// Floor so the slide keeps a usable size instead of collapsing on narrow
// stages — the stage scrolls past this min rather than shrinking fully
// (same idea as the dock grid / AgentTurnContainer carousel).
const CANVAS_MIN_W = 560;

type DeckItem = DeckSlide['items'][number];

const assetKey = (a: AssetReference): string =>
  a.type === 'question' ? String((a as { id: number }).id) : (a as InlineAsset).id || '';

const blankSlide = (): DeckSlide => ({ id: crypto.randomUUID(), items: [] });

export interface DeckChange {
  deck?: DeckSlide[];
  assets?: AssetReference[];
}

interface DeckViewProps {
  deck: DeckSlide[];
  editMode: boolean;
  assets: AssetReference[];
  onChange: (changes: DeckChange) => void;
}

export default function DeckView({ deck, editMode, assets, onChange }: DeckViewProps) {
  // Normalize: tolerate slides saved in an older shape (missing/!array `items`).
  const slides = useMemo<DeckSlide[]>(
    () => (deck || []).map(s => ({ id: s.id, items: Array.isArray(s.items) ? s.items : [] })),
    [deck],
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const safeIdx = Math.min(activeIdx, Math.max(0, slides.length - 1));

  // Host node for the text-formatting toolbar. When a text box is being edited,
  // its Lexical toolbar is portaled here (into the top bar) so it isn't clipped
  // by the free-form canvas. State (not a ref) so children re-render once it mounts.
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [isEditingText, setIsEditingText] = useState(false);

  const assetByKey = useMemo(() => {
    const m = new Map<string, AssetReference>();
    for (const a of assets) m.set(assetKey(a), a);
    return m;
  }, [assets]);

  const filesBag = useAppSelector(state => state.files.files);
  const questions: PickableQuestion[] = useMemo(
    () => assets.filter(a => a.type === 'question').map(a => {
      const id = (a as { id: number }).id;
      return { id, name: filesBag[id]?.name || 'Untitled Question' };
    }),
    [assets, filesBag],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState('100%');
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const compute = () => setContainerHeight(`${Math.max(420, window.innerHeight - el.getBoundingClientRect().top)}px`);
    compute();
    const raf = requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', compute); };
  }, [editMode, slides.length === 0]);

  const setSlideItems = useCallback((idx: number, items: DeckItem[], extra?: DeckChange) => {
    onChange({ deck: slides.map((s, i) => (i === idx ? { ...s, items } : s)), ...extra });
  }, [slides, onChange]);

  const addSlide = useCallback(() => {
    onChange({ deck: [...slides, blankSlide()] });
    setActiveIdx(slides.length);
  }, [slides, onChange]);

  const deleteSlide = useCallback((idx: number) => {
    onChange({ deck: slides.filter((_, i) => i !== idx) });
    setActiveIdx(i => Math.max(0, Math.min(i, slides.length - 2)));
  }, [slides, onChange]);

  // Stagger new items so they don't stack exactly.
  const nextSpot = (items: DeckItem[]) => {
    const n = items.length;
    return { xPct: 8 + (n % 3) * 6, yPct: 8 + (n % 4) * 8 };
  };

  const addChart = useCallback((questionId: number) => {
    const slide = slides[safeIdx];
    if (!slide) return;
    const spot = nextSpot(slide.items);
    setSlideItems(safeIdx, [...slide.items, { id: questionId, ...spot, wPct: 46, hPct: 50 }]);
  }, [slides, safeIdx, setSlideItems]);

  const addText = useCallback(() => {
    const slide = slides[safeIdx];
    if (!slide) return;
    const id = crypto.randomUUID();
    const newAsset: AssetReference = { type: 'text', id, content: 'New text…' };
    const spot = nextSpot(slide.items);
    setSlideItems(safeIdx, [...slide.items, { id, ...spot, wPct: 38, hPct: 16 }], { assets: [...assets, newAsset] });
  }, [slides, safeIdx, assets, setSlideItems]);

  const removeFromSlide = useCallback((key: string) => {
    const slide = slides[safeIdx];
    if (!slide) return;
    setSlideItems(safeIdx, slide.items.filter(it => String(it.id) !== key));
  }, [slides, safeIdx, setSlideItems]);

  const updateItem = useCallback((key: string, partial: Partial<DeckItem>) => {
    const slide = slides[safeIdx];
    if (!slide) return;
    setSlideItems(safeIdx, slide.items.map(it => (String(it.id) === key ? { ...it, ...partial } : it)));
  }, [slides, safeIdx, setSlideItems]);

  const updateText = useCallback((textId: string, content: string) => {
    onChange({ assets: assets.map(a => (assetKey(a) === textId ? { ...(a as InlineAsset), content } : a)) });
  }, [assets, onChange]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresenting(false);
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, slides.length - 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, slides.length]);

  if (slides.length === 0) {
    return (
      <Box ref={rootRef} height={containerHeight} p={10} display="flex" flexDirection="column" alignItems="center" justifyContent="center">
        <Box mb={3} opacity={0.3}><LuPresentation size={64} strokeWidth={1.5} /></Box>
        <Text fontSize="lg" fontWeight={700} color="fg.default">No slides yet</Text>
        <Text fontSize="sm" color="fg.muted" mt={1} mb={4}>Build a deck from your questions and notes.</Text>
        {editMode && (
          <Button size="sm" onClick={addSlide} aria-label="Add slide" gap={1.5} fontWeight={600} bg="fg.default" color="bg.surface" _hover={{ bg: 'fg.muted' }}>
            <LuPlus size={14} /> Add slide
          </Button>
        )}
      </Box>
    );
  }

  const activeSlide = slides[safeIdx];

  return (
    <HStack ref={rootRef} align="stretch" gap={0} height={containerHeight}>
      {/* Slide rail */}
      <VStack align="stretch" gap={2} w="200px" flexShrink={0} p={3} borderRightWidth="1px" borderColor="border.muted" overflowY="auto" bg="bg.subtle">
        {slides.map((slide, idx) => (
          <SlideThumb key={slide.id} slide={slide} assetByKey={assetByKey} index={idx} active={idx === safeIdx} editMode={editMode} onSelect={() => setActiveIdx(idx)} onDelete={() => deleteSlide(idx)} />
        ))}
        {editMode && (
          <Button
            size="xs"
            variant="outline"
            onClick={addSlide}
            aria-label="Add slide"
            gap={1.5}
            mt={1}
            borderStyle="dashed"
            borderColor="border.emphasized"
            color="fg.muted"
            bg="transparent"
            _hover={{ color: 'fg.default', bg: 'bg.muted', borderColor: 'fg.subtle' }}
          >
            <LuPlus size={13} /> Add slide
          </Button>
        )}
      </VStack>

      {/* Stage */}
      <VStack flex={1} minW={0} align="stretch" gap={0} bg="bg.canvas" overflow="auto">
        <HStack justify="space-between" px={3} py={1.5} borderBottomWidth="1px" borderColor="border.muted" bg="bg.surface" flexShrink={0} minH="44px">
          <HStack gap={3} flex={1} minW={0}>
            {/* Text-formatting toolbar portals in here while editing a text box */}
            <HStack
              ref={setToolbarHost}
              gap={1}
              align="center"
              borderRadius="md"
              bg={isEditingText ? 'bg.muted' : 'transparent'}
              borderWidth={isEditingText ? '1px' : '0'}
              borderColor="border.muted"
              px={isEditingText ? 1 : 0}
              transition="background 0.15s"
              minW={0}
              overflowX="auto"
            />
          </HStack>

          <HStack gap={1.5} flexShrink={0}>
            {editMode && (
              <HStack
                gap={0.5}
                p={0.5}
                borderRadius="md"
                bg="bg.muted"
                borderWidth="1px"
                borderColor="border.muted"
              >
                <Button size="2xs" variant="ghost" onClick={addText} aria-label="Add text" px={2} gap={1.5} h="26px" fontWeight={600} color="fg.muted" _hover={{ bg: 'bg.emphasized', color: 'fg.default' }}>
                  <Box color="accent.secondary" display="flex"><LuType size={13} /></Box> Text
                </Button>
                <ChartPicker questions={questions} onPick={addChart} />
              </HStack>
            )}
            <Button
              size="2xs"
              onClick={() => setPresenting(true)}
              aria-label="Present"
              px={3}
              gap={1.5}
              h="28px"
              fontWeight={700}
              borderRadius="md"
              bg="accent.teal"
              color="white"
              boxShadow="xs"
              _hover={{ bg: 'accent.teal/85' }}
              _active={{ bg: 'accent.teal/90' }}
            >
              <LuPlay size={12} fill="currentColor" /> Present
            </Button>
          </HStack>
        </HStack>

        <Box flex={1} display="flex" alignItems="flex-start" justifyContent="safe center" p={6}>
          <SlideCanvas slide={activeSlide} assetByKey={assetByKey} editMode={editMode} maxW={CANVAS_MAX_W} onUpdateItem={updateItem} onRemoveItem={removeFromSlide} onUpdateText={updateText} toolbarHost={toolbarHost} onEditingChange={setIsEditingText} />
        </Box>
      </VStack>

      {/* Fullscreen presenter */}
      {presenting && (
        <Box position="fixed" inset={0} zIndex={9999} bg="#0b0d10" display="flex" flexDirection="column" alignItems="center" justifyContent="center" p={8}>
          <Box w="100%" maxW="1280px"><SlideCanvas slide={activeSlide} assetByKey={assetByKey} editMode={false} present /></Box>
          <HStack position="absolute" bottom={6} left="50%" transform="translateX(-50%)" gap={3} bg="rgba(255,255,255,0.1)" px={4} py={2} borderRadius="full" backdropFilter="blur(8px)">
            <IconButton aria-label="Previous slide" size="xs" variant="ghost" color="white" disabled={safeIdx === 0} onClick={() => setActiveIdx(i => Math.max(0, i - 1))}><LuChevronLeft size={16} /></IconButton>
            <Text fontSize="xs" color="white" fontFamily="mono">{safeIdx + 1} / {slides.length}</Text>
            <IconButton aria-label="Next slide" size="xs" variant="ghost" color="white" disabled={safeIdx === slides.length - 1} onClick={() => setActiveIdx(i => Math.min(slides.length - 1, i + 1))}><LuChevronRight size={16} /></IconButton>
            <Box w="1px" h="16px" bg="whiteAlpha.400" />
            <IconButton aria-label="Exit presentation" size="xs" variant="ghost" color="white" onClick={() => setPresenting(false)}><LuX size={16} /></IconButton>
          </HStack>
        </Box>
      )}
    </HStack>
  );
}

// --- Free-form slide canvas ---

interface SlideCanvasProps {
  slide: DeckSlide;
  assetByKey: Map<string, AssetReference>;
  editMode: boolean;
  present?: boolean;
  maxW?: number;
  onUpdateItem?: (key: string, partial: Partial<DeckItem>) => void;
  onRemoveItem?: (key: string) => void;
  onUpdateText?: (textId: string, content: string) => void;
  toolbarHost?: HTMLElement | null;
  onEditingChange?: (editing: boolean) => void;
}

function SlideCanvas({ slide, assetByKey, editMode, present, maxW, onUpdateItem, onRemoveItem, onUpdateText, toolbarHost, onEditingChange }: SlideCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Which text box is being edited. Owned here (not per-item) so changing the
  // selection — including deselecting — implicitly exits editing without an
  // effect, and only one box ever owns the shared toolbar host.
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const selectItem = useCallback((key: string) => {
    setSelectedKey(prev => {
      if (prev !== key) setEditingKey(null);
      return key;
    });
  }, []);
  const clearSelection = useCallback(() => { setSelectedKey(null); setEditingKey(null); }, []);

  const liveItems = (slide.items || []).filter(it => assetByKey.has(String(it.id)));

  return (
    <Box
      ref={canvasRef}
      w="100%"
      maxW={present ? '100%' : `${maxW}px`}
      minW={present ? undefined : `${CANVAS_MIN_W}px`}
      bg="bg.surface"
      borderWidth={present ? '0' : '1px'}
      borderColor="border.default"
      borderRadius={present ? 'lg' : 'md'}
      boxShadow={present ? '0 20px 60px rgba(0,0,0,0.5)' : '0 1px 3px rgba(0,0,0,0.06)'}
      css={{ aspectRatio: '16 / 9' }}
      overflow="hidden"
      position="relative"
      onMouseDown={() => editMode && clearSelection()}
    >
      {liveItems.map(it => {
        const key = String(it.id);
        return (
          <SlideItem
            key={key}
            itemKey={key}
            item={it}
            asset={assetByKey.get(key)!}
            editMode={editMode}
            selected={selectedKey === key}
            editing={editMode && editingKey === key}
            canvasRef={canvasRef}
            onSelect={() => selectItem(key)}
            onStartEdit={() => setEditingKey(key)}
            onUpdateItem={onUpdateItem}
            onRemoveItem={onRemoveItem}
            onUpdateText={onUpdateText}
            toolbarHost={toolbarHost}
            onEditingChange={onEditingChange}
          />
        );
      })}
    </Box>
  );
}

function SlideItem({ itemKey, item, asset, editMode, selected, editing, canvasRef, onSelect, onStartEdit, onUpdateItem, onRemoveItem, onUpdateText, toolbarHost, onEditingChange }: {
  itemKey: string;
  item: DeckItem;
  asset: AssetReference;
  editMode: boolean;
  selected: boolean;
  editing: boolean;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  onStartEdit: () => void;
  onUpdateItem?: (key: string, partial: Partial<DeckItem>) => void;
  onRemoveItem?: (key: string) => void;
  onUpdateText?: (textId: string, content: string) => void;
  toolbarHost?: HTMLElement | null;
  onEditingChange?: (editing: boolean) => void;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  // Mirror the node into state so <Moveable> can read it without touching a ref
  // during render. Stable callback ref → fires only on mount/unmount.
  const [targetEl, setTargetEl] = useState<HTMLDivElement | null>(null);
  const setRefs = useCallback((el: HTMLDivElement | null) => {
    targetRef.current = el;
    setTargetEl(el);
  }, []);
  const isText = asset.type === 'text';

  // Report editing state up so the top bar can frame the formatting toolbar.
  useEffect(() => {
    if (!editing) return;
    onEditingChange?.(true);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);

  // Convert the element's on-screen rect → % of the canvas, and commit.
  const commit = useCallback(() => {
    const el = targetRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const c = canvas.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    onUpdateItem?.(itemKey, {
      xPct: ((r.left - c.left) / c.width) * 100,
      yPct: ((r.top - c.top) / c.height) * 100,
      wPct: (r.width / c.width) * 100,
      hPct: (r.height / c.height) * 100,
    });
    el.style.transform = '';
    el.style.width = '';
    el.style.height = '';
  }, [itemKey, canvasRef, onUpdateItem]);

  const showMoveable = editMode && selected && !editing;

  return (
    <>
      <Box
        ref={setRefs}
        position="absolute"
        left={`${item.xPct}%`}
        top={`${item.yPct}%`}
        width={`${item.wPct}%`}
        height={`${item.hPct}%`}
        bg="bg.subtle"
        borderWidth="1px"
        borderColor={selected && editMode ? 'accent.teal' : 'border.default'}
        borderRadius="md"
        overflow="hidden"
        display="flex"
        flexDirection="column"
        boxShadow={selected && editMode ? '0 0 0 1px var(--chakra-colors-accent-teal)' : undefined}
        onMouseDown={editMode ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
        onDoubleClick={isText && editMode ? onStartEdit : undefined}
      >
        {/* Per-item controls (edit mode) */}
        {editMode && selected && (
          <HStack position="absolute" top={1} right={1} zIndex={2} gap={0.5}>
            <IconButton aria-label="Remove from slide" size="2xs" variant="solid" bg="bg.surface" color="fg.muted" _hover={{ color: 'accent.danger' }} onMouseDown={(e) => e.stopPropagation()} onClick={() => onRemoveItem?.(itemKey)}>
              <LuTrash2 size={11} />
            </IconButton>
          </HStack>
        )}

        <Box flex={1} minH={0} overflow="hidden">
          {asset.type === 'question' ? (
            <Box height="100%" css={{ '& > div': { height: '100%' } }} pointerEvents="none">
              <SmartEmbeddedQuestionContainer questionId={(asset as { id: number }).id} showTitle={false} />
            </Box>
          ) : (
            <Box height="100%" overflow="auto" pointerEvents={editing ? 'auto' : 'none'}>
              {editing ? (
                <LexicalTextEditor
                  initialMarkdown={(asset as InlineAsset).content || ''}
                  onChange={(md) => onUpdateText?.(itemKey, md)}
                  // Portal the formatting toolbar up into the top bar (the canvas
                  // clips overflow, so it can't live above the small text box).
                  // Portals preserve the Lexical context, so the buttons stay wired.
                  renderToolbar={(toolbar) => (toolbarHost ? createPortal(toolbar, toolbarHost) : null)}
                />
              ) : (
                <LexicalTextViewer markdown={(asset as InlineAsset).content || ''} padding="10px 14px" fontSize="15px" />
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* Moveable controller — reads the node from state, not a render-time ref. */}
      {showMoveable && targetEl && (
        <Moveable
          target={targetEl}
          draggable
          resizable
          origin={false}
          throttleDrag={0}
          onDrag={(e) => { e.target.style.transform = e.transform; }}
          onDragEnd={commit}
          onResize={(e) => { e.target.style.width = `${e.width}px`; e.target.style.height = `${e.height}px`; e.target.style.transform = e.drag.transform; }}
          onResizeEnd={commit}
        />
      )}
    </>
  );
}

// --- Slide thumbnail (rail) ---

// Render the whole slide at this reference size, then scale it into the rail
// thumbnail — so charts/text keep slide proportions instead of cramming their
// axes into a tiny box (same trick as the dock card mini chart).
const THUMB_REF_W = 480;
const THUMB_REF_H = THUMB_REF_W * 9 / 16;

function SlideThumb({ slide, assetByKey, index, active, editMode, onSelect, onDelete }: {
  slide: DeckSlide; assetByKey: Map<string, AssetReference>; index: number; active: boolean; editMode: boolean; onSelect: () => void; onDelete: () => void;
}) {
  const boxRef = useRef<HTMLButtonElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / THUMB_REF_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <HStack gap={1.5} align="center" role="group">
      <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" w="14px" textAlign="right" flexShrink={0}>{index + 1}</Text>
      <Box as="button" ref={boxRef} aria-label={`Slide ${index + 1}`} onClick={onSelect} flex={1} position="relative" bg="bg.surface" borderWidth="2px" borderColor={active ? 'accent.teal' : 'border.default'} borderRadius="md" overflow="hidden" css={{ aspectRatio: '16 / 9' }} _hover={{ borderColor: active ? 'accent.teal' : 'accent.teal/40' }} transition="border-color 0.12s">
        {/* Reference-sized slide, scaled to fit. Both this box and the outer box
            are 16/9, so scale = width/REF makes the scaled content fill exactly. */}
        <Box position="absolute" top={0} left={0} width={`${THUMB_REF_W}px`} height={`${THUMB_REF_H}px`} transformOrigin="top left" transform={`scale(${scale})`} pointerEvents="none" opacity={scale ? 1 : 0}>
          {(slide.items || []).map(it => {
            const asset = assetByKey.get(String(it.id));
            if (!asset) return null;
            return (
              <Box key={String(it.id)} position="absolute" left={`${it.xPct}%`} top={`${it.yPct}%`} width={`${it.wPct}%`} height={`${it.hPct}%`}>
                <Box w="100%" h="100%" borderRadius="md" overflow="hidden" bg="bg.subtle" borderWidth="1px" borderColor="border.default" display="flex" flexDirection="column">
                  {asset.type === 'question' ? (
                    <Box flex={1} minH={0} css={{ '& > div': { height: '100%' } }}>
                      <SmartEmbeddedQuestionContainer questionId={(asset as { id: number }).id} showTitle={false} />
                    </Box>
                  ) : (
                    <Box flex={1} minH={0} overflow="hidden">
                      <LexicalTextViewer markdown={(asset as InlineAsset).content || ''} padding="10px 14px" fontSize="15px" />
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
      {editMode && (
        <IconButton aria-label={`Delete slide ${index + 1}`} size="2xs" variant="ghost" color="fg.subtle" opacity={0} _groupHover={{ opacity: 1 }} _hover={{ color: 'accent.danger' }} onClick={onDelete} flexShrink={0}>
          <LuTrash2 size={12} />
        </IconButton>
      )}
    </HStack>
  );
}
