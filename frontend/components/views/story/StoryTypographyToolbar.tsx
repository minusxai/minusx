'use client';

/**
 * StoryTypographyToolbar — floating typography controls for the focused editable text host in a
 * format:'jsx' story (edit mode only). Renders in the PARENT document (like StorySelectionPopover)
 * anchored above the host, offsetting the host's iframe-space rect by the iframe's bounding box.
 *
 * Apply flow (see lib/data/story/typography.ts):
 *  1. compute the new class string from the host's live className via the pure algebra,
 *  2. mutate the DOM element directly (instant feedback — the focused host is render-frozen, so
 *     a React re-render can't deliver the change; the palette is pre-compiled into every story's
 *     stylesheet, so the class resolves with zero recompile), and
 *  3. emit the full class string via `onApply` → StoryJsxEditApi.applyClassEdit → AST write-back.
 *
 * The container preventDefaults mousedown so focus never leaves the contenteditable host (a blur
 * would commit the text edit and dismiss the toolbar mid-interaction).
 */

import { useEffect, useState, type MouseEvent, type ChangeEvent } from 'react';
import { Box, HStack, IconButton, Text, Portal } from '@chakra-ui/react';
import {
  LuAArrowDown, LuAArrowUp, LuBold, LuItalic, LuUnderline,
  LuAlignLeft, LuAlignCenter, LuAlignRight, LuCircleSlash2,
} from 'react-icons/lu';
import type { StoryTextHostTarget, StoryFormatEdit } from '@/components/views/shared/StoryJsxBody';
import {
  applyTypographyChoice, currentChoice, stepSizeClass, type TypographyGroup,
} from '@/lib/data/story/typography';

export interface StoryTypographyToolbarProps {
  /** The focused editable text host, or null (renders nothing). */
  target: StoryTextHostTarget | null;
  /** Only render while the story is in edit mode. */
  active: boolean;
  /** Commit: the target's full new attr values (already applied to the live DOM element). */
  onApply: (astPath: string, edit: StoryFormatEdit) => void;
}

/** el.style.color ('rgb(r, g, b)' or hex) → '#rrggbb' for the color input; null when unset/odd. */
function cssColorToHex(color: string): string | null {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (!m) return null;
  return `#${m.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

const TOOLBAR_H = 40;

export default function StoryTypographyToolbar({ target, active, onApply }: StoryTypographyToolbarProps) {
  // The live element's className + rects ARE the display state — measured fresh each render;
  // this counter just forces a re-render after applies and on scroll/resize.
  const [, setVersion] = useState(0);

  // Re-render (rAF-throttled) on scroll/resize in BOTH documents so the anchored position
  // tracks the host instead of drifting.
  useEffect(() => {
    if (!target || !active) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVersion(v => v + 1));
    };
    const iframeWin = target.el.ownerDocument.defaultView;
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    if (iframeWin && iframeWin !== window) iframeWin.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (iframeWin && iframeWin !== window) iframeWin.removeEventListener('scroll', schedule, true);
    };
  }, [target, active]);

  if (!target || !active) return null;

  // Anchor above the host: iframe-space rect + iframe box offset (the iframe never scrolls
  // internally — the parent document does — so client rects compose directly). The owning
  // iframe is derived from the host element itself — no ref reads during render.
  const rect = target.el.getBoundingClientRect();
  const box = target.el.ownerDocument.defaultView?.frameElement?.getBoundingClientRect();
  const pos = {
    x: Math.max(8, (box?.left ?? 0) + rect.left),
    y: Math.max(8, (box?.top ?? 0) + rect.top - TOOLBAR_H - 8),
  };

  // The focused host is render-frozen (StoryJsxBody's memo guard), so class/style must land on
  // the live DOM element directly — React can't deliver them. The same values go to the AST
  // write-back verbatim.
  const hostEl = target.el;
  const cls = hostEl.className;
  const apply = (transform: (className: string) => string) => {
    const next = transform(hostEl.className);
    hostEl.setAttribute('class', next);
    onApply(target.astPath, { className: next });
    setVersion(v => v + 1);
  };
  // Inline color (free value — a class palette can't cover a picker): live-preview on the DOM,
  // committed as the FULL style string so the write-back mirrors the element exactly.
  const applyColor = (color: string | null) => {
    if (color === null) hostEl.style.removeProperty('color');
    else hostEl.style.setProperty('color', color);
    if (!hostEl.getAttribute('style')) hostEl.removeAttribute('style');
    onApply(target.astPath, { className: hostEl.className, style: hostEl.getAttribute('style') ?? '' });
    setVersion(v => v + 1);
  };
  const toggle = (group: TypographyGroup, choice: string) =>
    apply(c => applyTypographyChoice(c, group, currentChoice(c, group) === choice ? null : choice));
  const isOn = (group: TypographyGroup, choice: string) => currentChoice(cls, group) === choice;
  const sizeLabel = (currentChoice(cls, 'size') ?? 'text-base').replace('text-', '');

  const toggleButton = (group: TypographyGroup, choice: string, label: string, icon: React.ReactNode) => (
    <IconButton
      aria-label={label}
      aria-pressed={isOn(group, choice)}
      size="2xs"
      variant={isOn(group, choice) ? 'subtle' : 'ghost'}
      onClick={() => toggle(group, choice)}
    >
      {icon}
    </IconButton>
  );

  return (
    <Portal>
      <Box
        aria-label="Typography toolbar"
        position="fixed"
        left={`${pos.x}px`}
        top={`${pos.y}px`}
        zIndex={1500}
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        boxShadow="md"
        px={1}
        py={0.5}
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
      >
        <HStack gap={0.5}>
          <IconButton aria-label="Decrease font size" size="2xs" variant="ghost" onClick={() => apply(c => stepSizeClass(c, -1))}>
            <LuAArrowDown />
          </IconButton>
          <Text fontSize="2xs" color="fg.muted" minW="24px" textAlign="center" fontFamily="mono">
            {sizeLabel}
          </Text>
          <IconButton aria-label="Increase font size" size="2xs" variant="ghost" onClick={() => apply(c => stepSizeClass(c, 1))}>
            <LuAArrowUp />
          </IconButton>
          <Box w="1px" h="16px" bg="border.muted" mx={0.5} />
          {toggleButton('weight', 'font-bold', 'Toggle bold', <LuBold />)}
          {toggleButton('fontStyle', 'italic', 'Toggle italic', <LuItalic />)}
          {toggleButton('decoration', 'underline', 'Toggle underline', <LuUnderline />)}
          <Box w="1px" h="16px" bg="border.muted" mx={0.5} />
          {toggleButton('align', 'text-left', 'Align left', <LuAlignLeft />)}
          {toggleButton('align', 'text-center', 'Align center', <LuAlignCenter />)}
          {toggleButton('align', 'text-right', 'Align right', <LuAlignRight />)}
          <Box w="1px" h="16px" bg="border.muted" mx={0.5} />
          <input
            type="color"
            aria-label="Text color"
            value={cssColorToHex(hostEl.style.color) ?? '#888888'}
            onChange={(e: ChangeEvent<HTMLInputElement>) => applyColor(e.target.value)}
            style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
          />
          <IconButton aria-label="Default text color" size="2xs" variant="ghost" onClick={() => applyColor(null)}>
            <LuCircleSlash2 />
          </IconButton>
        </HStack>
      </Box>
    </Portal>
  );
}
