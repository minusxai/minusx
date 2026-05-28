'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box } from '@chakra-ui/react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import OverlayControlBar from './OverlayControlBar';
import { AssetReference, InlineAsset, DashboardLayoutItem } from '@/lib/types';
import SmartEmbeddedQuestionContainer from './containers/SmartEmbeddedQuestionContainer';
import { LexicalTextViewer } from './lexical/LexicalTextEditor';
import { WidthProvider, Responsive } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

/** A slide is a group of assets between dividers. */
export interface Slide {
  assets: AssetReference[];
  /** Layout items for just this slide's assets, Y positions rebased to start from 0. */
  layoutItems: DashboardLayoutItem[];
}

/**
 * Split dashboard assets into slides at divider boundaries.
 * Assets are sorted by their Y position in the layout.
 */
export function splitIntoSlides(
  assets: AssetReference[],
  layoutItems: DashboardLayoutItem[],
): Slide[] {
  // Build a layout map for quick lookup
  const layoutMap = new Map<string, DashboardLayoutItem>();
  for (const item of layoutItems) {
    layoutMap.set(String(item.id), item);
  }

  // Get asset key helper
  const getKey = (asset: AssetReference): string => {
    if (asset.type === 'question') return String((asset as { id: number }).id);
    return (asset as InlineAsset).id || '';
  };

  // Filter to assets that have layout entries, then sort by Y position
  const assetsWithLayout = assets
    .map(asset => ({ asset, layout: layoutMap.get(getKey(asset)) }))
    .filter((entry): entry is { asset: AssetReference; layout: DashboardLayoutItem } => !!entry.layout)
    .sort((a, b) => {
      if (a.layout.y !== b.layout.y) return a.layout.y - b.layout.y;
      return a.layout.x - b.layout.x;
    });

  // Split at dividers
  const slides: Slide[] = [];
  let currentAssets: AssetReference[] = [];
  let currentLayouts: DashboardLayoutItem[] = [];

  for (const { asset, layout } of assetsWithLayout) {
    if (asset.type === 'divider') {
      // Push current slide (even if empty — creates a blank slide)
      if (currentAssets.length > 0) {
        slides.push(rebaseSlide(currentAssets, currentLayouts));
      }
      currentAssets = [];
      currentLayouts = [];
    } else {
      currentAssets.push(asset);
      currentLayouts.push(layout);
    }
  }

  // Push final slide
  if (currentAssets.length > 0) {
    slides.push(rebaseSlide(currentAssets, currentLayouts));
  }

  // If no dividers existed, everything is one slide
  if (slides.length === 0 && assets.length > 0) {
    const nonDividers = assetsWithLayout.filter(e => e.asset.type !== 'divider');
    if (nonDividers.length > 0) {
      slides.push(rebaseSlide(
        nonDividers.map(e => e.asset),
        nonDividers.map(e => e.layout),
      ));
    }
  }

  return slides;
}

/** Rebase layout Y positions so the slide starts from Y=0. */
function rebaseSlide(assets: AssetReference[], layouts: DashboardLayoutItem[]): Slide {
  const minY = layouts.reduce((min, item) => Math.min(min, item.y), Infinity);
  return {
    assets,
    layoutItems: layouts.map(item => ({ ...item, y: item.y - minY })),
  };
}

// --- Presentation Overlay ---

interface PresentationOverlayProps {
  slides: Slide[];
  fileId: number;
  onClose: () => void;
  /** Parameter values to pass to embedded questions. */
  paramValues?: Record<string, any>;
}

export default function PresentationOverlay({
  slides,
  fileId,
  onClose,
  paramValues = {},
}: PresentationOverlayProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const goNext = useCallback(() => {
    setCurrentSlide(i => Math.min(i + 1, slides.length - 1));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setCurrentSlide(i => Math.max(i - 1, 0));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev]);

  // Enter browser fullscreen
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => { document.exitFullscreen?.().catch(() => {}); };
  }, []);

  if (slides.length === 0) return null;

  const slide = slides[currentSlide];

  return (
    <Box
      position="fixed"
      inset={0}
      zIndex={9999}
      bg="bg.surface"
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      {/* Slide content */}
      <Box flex={1} overflow="auto" p={6} display="flex" alignItems="center" justifyContent="center">
        <SlideRenderer
          slide={slide}
          fileId={fileId}
          paramValues={paramValues}
        />
      </Box>

      {/* Bottom control bar */}
      <OverlayControlBar
        currentIndex={currentSlide}
        total={slides.length}
        onPrev={goPrev}
        onNext={goNext}
        onGoTo={setCurrentSlide}
        onClose={onClose}
        prevIcon={<LuChevronLeft size={15} />}
        nextIcon={<LuChevronRight size={15} />}
        prevLabel="Previous slide"
        nextLabel="Next slide"
        exitLabel="Exit presentation"
        accentColor="accent.teal"
        onExport={(format) => { console.log('Export presentation as', format); }}
      />
    </Box>
  );
}

// --- Slide Renderer ---

function SlideRenderer({
  slide,
  fileId,
  paramValues,
}: {
  slide: Slide;
  fileId: number;
  paramValues: Record<string, any>;
}) {
  // Build grid layout from slide's rebased layout items
  const gridLayout = slide.layoutItems.map(item => ({
    i: String(item.id),
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    static: true, // No dragging/resizing in presentation
  }));

  const layouts = {
    lg: gridLayout,
    md: gridLayout,
    sm: gridLayout,
  };

  return (
    <Box maxW="1400px" mx="auto" width="100%">
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1024, md: 768, sm: 0 }}
        cols={{ lg: 12, md: 12, sm: 6 }}
        rowHeight={80}
        compactType="vertical"
        containerPadding={[0, 0]}
        margin={[6, 6]}
        isDraggable={false}
        isResizable={false}
      >
        {slide.assets.map(asset => {
          if (asset.type === 'question') {
            const questionId = (asset as { id: number }).id;
            return (
              <Box
                key={String(questionId)}
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

          // Text block
          const textAsset = asset as InlineAsset;
          return (
            <Box
              key={textAsset.id || ''}
              bg="bg.subtle"
              borderWidth="1px"
              borderColor="border.default"
              borderRadius="md"
              overflow="hidden"
              display="flex"
              flexDirection="column"
            >
              <Box height="100%" overflow="auto">
                {textAsset.content ? (
                  <LexicalTextViewer markdown={textAsset.content} />
                ) : null}
              </Box>
            </Box>
          );
        })}
      </ResponsiveGridLayout>
    </Box>
  );
}
