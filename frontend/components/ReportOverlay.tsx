'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Box } from '@chakra-ui/react';
import { LuChevronUp, LuChevronDown } from 'react-icons/lu';
import OverlayControlBar from './OverlayControlBar';
import { AssetReference, InlineAsset } from '@/lib/types';
import SmartEmbeddedQuestionContainer from './containers/SmartEmbeddedQuestionContainer';
import { LexicalTextViewer } from './lexical/LexicalTextEditor';
import { Slide } from './PresentationOverlay';

interface ReportOverlayProps {
  slides: Slide[];
  fileId: number;
  onClose: () => void;
  paramValues?: Record<string, any>;
}

export default function ReportOverlay({
  slides,
  fileId,
  onClose,
  paramValues = {},
}: ReportOverlayProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const scrollToPage = useCallback((index: number) => {
    setCurrentPage(index);
    pageRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const goNext = useCallback(() => {
    if (currentPage < slides.length - 1) scrollToPage(currentPage + 1);
  }, [currentPage, slides.length, scrollToPage]);

  const goPrev = useCallback(() => {
    if (currentPage > 0) scrollToPage(currentPage - 1);
  }, [currentPage, scrollToPage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); goPrev(); }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev]);

  // Track current page via scroll position
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const containerTop = container.scrollTop + container.offsetTop;
      let closest = 0;
      let closestDist = Infinity;

      pageRefs.current.forEach((ref, i) => {
        if (!ref) return;
        const dist = Math.abs(ref.offsetTop - containerTop);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      });

      setCurrentPage(closest);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [slides.length]);

  // Enter browser fullscreen
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => { document.exitFullscreen?.().catch(() => {}); };
  }, []);

  if (slides.length === 0) return null;

  return (
    <Box
      position="fixed"
      inset={0}
      zIndex={9999}
      bg="bg.muted"
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      {/* Scrollable pages */}
      <Box ref={scrollContainerRef} flex={1} overflow="auto" py={10} px={4}>
        <Box maxW="1000px" mx="auto" display="flex" flexDirection="column" gap={10}>
          {slides.map((slide, i) => (
            <Box
              key={i}
              ref={(el: HTMLDivElement | null) => { pageRefs.current[i] = el; }}
              bg="bg.surface"
              borderRadius="lg"
              boxShadow="0 2px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)"
              border="1px solid"
              borderColor="border.default"
              p={8}
              minH="calc(100vh - 120px)"
            >
              <ReportPageRenderer
                slide={slide}
                fileId={fileId}
                paramValues={paramValues}
              />
            </Box>
          ))}
        </Box>
      </Box>

      {/* Bottom control bar */}
      <OverlayControlBar
        currentIndex={currentPage}
        total={slides.length}
        onPrev={goPrev}
        onNext={goNext}
        onGoTo={scrollToPage}
        onClose={onClose}
        prevIcon={<LuChevronUp size={15} />}
        nextIcon={<LuChevronDown size={15} />}
        prevLabel="Previous page"
        nextLabel="Next page"
        exitLabel="Exit report"
        accentColor="accent.primary"
        onExport={(format) => { console.log('Export report as', format); }}
      />
    </Box>
  );
}

// --- Report Page Renderer ---

/** Group assets into rows by Y position, preserving horizontal layout. */
interface RowGroup {
  y: number;
  items: { asset: AssetReference; layout: { x: number; w: number; h: number } }[];
}

function groupIntoRows(slide: Slide): RowGroup[] {
  const layoutMap = new Map(
    slide.layoutItems.map(item => [String(item.id), item]),
  );

  const getAssetKey = (asset: AssetReference): string => {
    if (asset.type === 'question') return String((asset as { id: number }).id);
    return (asset as InlineAsset).id || '';
  };

  // Build entries with layout info, sorted by Y then X
  const entries = slide.assets
    .map(asset => {
      const layout = layoutMap.get(getAssetKey(asset));
      return layout ? { asset, layout: { x: layout.x, w: layout.w, h: layout.h, y: layout.y } } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.layout.y !== b.layout.y ? a.layout.y - b.layout.y : a.layout.x - b.layout.x);

  // Group by Y position
  const rows: RowGroup[] = [];
  for (const entry of entries) {
    const last = rows[rows.length - 1];
    if (last && last.y === entry.layout.y) {
      last.items.push(entry);
    } else {
      rows.push({ y: entry.layout.y, items: [entry] });
    }
  }

  return rows;
}

const GRID_COLS = 12;

function ReportPageRenderer({
  slide,
  fileId,
  paramValues,
}: {
  slide: Slide;
  fileId: number;
  paramValues: Record<string, any>;
}) {
  const rows = groupIntoRows(slide);

  return (
    <Box display="flex" flexDirection="column" gap={4}>
      {rows.map((row, rowIdx) => {
        // Row height = max grid height across items in this row
        const maxH = Math.max(...row.items.map(i => i.layout.h));
        const heightPx = maxH * 80 + (maxH - 1) * 6;

        return (
          <Box key={rowIdx} display="flex" gap="6px" height={row.items.some(i => i.asset.type !== 'question') ? 'auto' : `${heightPx}px`} minH={row.items.some(i => i.asset.type !== 'question') ? undefined : `${heightPx}px`}>
            {row.items.map(({ asset, layout }) => {
              // Width as percentage of 12-column grid
              const widthPct = `${(layout.w / GRID_COLS) * 100}%`;

              if (asset.type === 'question') {
                const questionId = (asset as { id: number }).id;
                return (
                  <Box
                    key={String(questionId)}
                    width={widthPct}
                    flexShrink={0}
                    bg="bg.subtle"
                    borderWidth="1px"
                    borderColor="border.default"
                    borderRadius="md"
                    overflow="hidden"
                    display="flex"
                    flexDirection="column"
                  >
                    <SmartEmbeddedQuestionContainer
                      questionId={questionId}
                      externalParamValues={paramValues}
                      showTitle={true}
                      editMode={false}
                      dashboardId={fileId}
                    />
                  </Box>
                );
              }

              // Text block — full natural height, no overflow clipping
              const textAsset = asset as InlineAsset;
              return (
                <Box key={textAsset.id || ''} width={widthPct} flexShrink={0}>
                  {textAsset.content ? (
                    <LexicalTextViewer markdown={textAsset.content} />
                  ) : null}
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
