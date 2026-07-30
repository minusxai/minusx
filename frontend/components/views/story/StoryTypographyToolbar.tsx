'use client';

/**
 * StoryTypographyToolbar — floating format controls for the focused editable text host in a
 * format:'jsx' story (edit mode only): typography, spacing, width, and color/fill. Renders in
 * the PARENT document (like StorySelectionPopover) anchored above the host, offsetting the
 * host's iframe-space rect by the iframe's bounding box.
 *
 * Apply flow (see lib/data/story/typography.ts):
 *  1. compute the new class string / style value from the host's live attrs via the pure algebra,
 *  2. mutate the DOM element directly (instant feedback — the focused host is render-frozen, so
 *     a React re-render can't deliver the change; the class palette is pre-compiled into every
 *     story's stylesheet, so classes resolve with zero recompile), and
 *  3. emit the full attr values via `onApply` → StoryJsxEditApi.applyFormatEdit → AST write-back.
 *
 * The container preventDefaults mousedown so focus never leaves the contenteditable host (a blur
 * would commit the text edit and dismiss the toolbar mid-interaction).
 */

import { useEffect, useRef, useState, type MouseEvent, type ChangeEvent, type ReactNode } from 'react';
import { Box, HStack, IconButton, Text, Portal } from '@chakra-ui/react';
import {
  LuAArrowDown, LuAArrowUp, LuBold, LuItalic, LuUnderline,
  LuAlignLeft, LuAlignCenter, LuAlignRight, LuCircleSlash2,
  LuBaseline, LuPaintBucket, LuArrowUpToLine, LuArrowUpFromLine,
  LuArrowDownToLine, LuArrowDownFromLine, LuMoveHorizontal, LuEllipsis,
} from 'react-icons/lu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import type { StoryTextHostTarget, StoryFormatEdit } from '@/components/views/shared/StoryJsxBody';
import {
  applyTypographyChoice, currentChoice, stepSizeClass, stepSpacingClass, currentSpacingStep,
  hasMaxWidth, stripMaxWidth, MAX_WIDTH_DEFAULT, type TypographyGroup,
} from '@/lib/data/story/typography';

export interface StoryTypographyToolbarProps {
  /** The focused editable text host, or null (renders nothing). */
  target: StoryTextHostTarget | null;
  /** Only render while the story is in edit mode. */
  active: boolean;
  /** Commit: the target's full new attr values (already applied to the live DOM element). */
  onApply: (astPath: string, edit: StoryFormatEdit) => void;
}

/** Inline-style color ('rgb(r, g, b)' or hex) → '#rrggbb' for a color input; null when unset/odd. */
function cssColorToHex(color: string): string | null {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (!m) return null;
  return `#${m.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

/** Tooltip wrapper — the tip text IS the control's aria-label, so the two can never drift. */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="z-[1600]">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Google-Docs-style color control: an icon with a color underbar, with a transparent native
 * color input stretched over it — ONE interactive element (the input carries the aria-label;
 * the icon is decorative).
 */
function ColorSwatchControl({ label, icon, value, onPick }: {
  label: string;
  icon: ReactNode;
  value: string | null;
  onPick: (hex: string) => void;
}) {
  return (
    <Tip label={label}>
      <Box position="relative" w="24px" h="24px" display="flex" alignItems="center" justifyContent="center">
        <Box display="flex" flexDirection="column" alignItems="center" gap="1px" color="fg.muted" fontSize="12px">
          {icon}
          <Box w="14px" h="3px" borderRadius="1px" bg={value ?? 'border'} />
        </Box>
        <input
          type="color"
          aria-label={label}
          value={value ?? '#888888'}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onPick(e.target.value)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
        />
      </Box>
    </Tip>
  );
}

const TOOLBAR_H = 40;

export default function StoryTypographyToolbar({ target, active, onApply }: StoryTypographyToolbarProps) {
  // The live element's className + rects ARE the display state — measured fresh each render;
  // this counter just forces a re-render after applies and on scroll/resize.
  const [, setVersion] = useState(0);
  // Basic/advanced split: the advanced row (spacing, width) reveals on demand and stays open
  // across target changes within the session.
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Full-width toggle memory: the max-w-* tokens stripped per element, restored on untoggle.
  const removedWidthsRef = useRef(new Map<string, string[]>());

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
  const toolbarH = showAdvanced ? TOOLBAR_H * 2 : TOOLBAR_H;
  const pos = {
    x: Math.max(8, (box?.left ?? 0) + rect.left),
    y: Math.max(8, (box?.top ?? 0) + rect.top - toolbarH - 8),
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
  // Inline style values (free colors — a class palette can't cover a picker): live-preview on
  // the DOM, committed as the FULL style string so the write-back mirrors the element exactly.
  const applyStyleProp = (prop: 'color' | 'background-color', value: string | null) => {
    if (value === null) hostEl.style.removeProperty(prop);
    else hostEl.style.setProperty(prop, value);
    if (!hostEl.getAttribute('style')) hostEl.removeAttribute('style');
    onApply(target.astPath, { className: hostEl.className, style: hostEl.getAttribute('style') ?? '' });
    setVersion(v => v + 1);
  };
  const toggle = (group: TypographyGroup, choice: string) =>
    apply(c => applyTypographyChoice(c, group, currentChoice(c, group) === choice ? null : choice));
  const isOn = (group: TypographyGroup, choice: string) => currentChoice(cls, group) === choice;
  const sizeLabel = (currentChoice(cls, 'size') ?? 'text-base').replace('text-', '');
  // The spacing readout answers "what does this translate to": Tailwind steps are 0.25rem each,
  // so mt-4 = 16px. No bare token reads as 0 (one step takes over from arbitrary/variant forms).
  const spacingLabel = (edge: 'above' | 'below') =>
    `${Number(currentSpacingStep(cls, edge) ?? '0') * 4}px`;
  const isFullWidth = !hasMaxWidth(cls);
  const toggleFullWidth = () => apply(c => {
    if (hasMaxWidth(c)) {
      const { className, removed } = stripMaxWidth(c);
      removedWidthsRef.current.set(target.astPath, removed);
      return className;
    }
    const restore = removedWidthsRef.current.get(target.astPath) ?? [MAX_WIDTH_DEFAULT];
    return [c, ...restore].filter(Boolean).join(' ');
  });

  const toggleButton = (group: TypographyGroup, choice: string, label: string, icon: ReactNode) => (
    <Tip label={label}>
      <IconButton
        aria-label={label}
        aria-pressed={isOn(group, choice)}
        size="2xs"
        variant={isOn(group, choice) ? 'subtle' : 'ghost'}
        onClick={() => toggle(group, choice)}
      >
        {icon}
      </IconButton>
    </Tip>
  );
  const stepButton = (label: string, icon: ReactNode, onClick: () => void) => (
    <Tip label={label}>
      <IconButton aria-label={label} size="2xs" variant="ghost" onClick={onClick}>
        {icon}
      </IconButton>
    </Tip>
  );
  const divider = <Box w="1px" h="16px" bg="border.muted" mx={0.5} />;

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
        <TooltipProvider>
        <HStack gap={0.5}>
          {stepButton('Decrease font size', <LuAArrowDown />, () => apply(c => stepSizeClass(c, -1)))}
          <Text fontSize="2xs" color="fg.muted" minW="24px" textAlign="center" fontFamily="mono">
            {sizeLabel}
          </Text>
          {stepButton('Increase font size', <LuAArrowUp />, () => apply(c => stepSizeClass(c, 1)))}
          {divider}
          {toggleButton('weight', 'font-bold', 'Toggle bold', <LuBold />)}
          {toggleButton('fontStyle', 'italic', 'Toggle italic', <LuItalic />)}
          {toggleButton('decoration', 'underline', 'Toggle underline', <LuUnderline />)}
          {divider}
          {toggleButton('align', 'text-left', 'Align left', <LuAlignLeft />)}
          {toggleButton('align', 'text-center', 'Align center', <LuAlignCenter />)}
          {toggleButton('align', 'text-right', 'Align right', <LuAlignRight />)}
          {divider}
          <ColorSwatchControl
            label="Text color"
            icon={<LuBaseline />}
            value={cssColorToHex(hostEl.style.color)}
            onPick={hex => applyStyleProp('color', hex)}
          />
          {stepButton('Default text color', <LuCircleSlash2 />, () => applyStyleProp('color', null))}
          <ColorSwatchControl
            label="Fill color"
            icon={<LuPaintBucket />}
            value={cssColorToHex(hostEl.style.backgroundColor)}
            onPick={hex => applyStyleProp('background-color', hex)}
          />
          {stepButton('Default fill color', <LuCircleSlash2 />, () => applyStyleProp('background-color', null))}
          {divider}
          <Tip label="Toggle full width">
            <IconButton
              aria-label="Toggle full width"
              aria-pressed={isFullWidth}
              size="2xs"
              variant={isFullWidth ? 'subtle' : 'ghost'}
              onClick={toggleFullWidth}
            >
              <LuMoveHorizontal />
            </IconButton>
          </Tip>
          <Tip label="More formatting">
            <IconButton
              aria-label="More formatting"
              aria-expanded={showAdvanced}
              size="2xs"
              variant={showAdvanced ? 'subtle' : 'ghost'}
              onClick={() => setShowAdvanced(v => !v)}
            >
              <LuEllipsis />
            </IconButton>
          </Tip>
        </HStack>
        {showAdvanced && (
          <HStack gap={0.5} mt={0.5} pt={0.5} borderTopWidth="1px" borderColor="border.muted">
            {stepButton('Decrease space above', <LuArrowUpToLine />, () => apply(c => stepSpacingClass(c, 'above', -1)))}
            <Text fontSize="2xs" color="fg.muted" minW="30px" textAlign="center" fontFamily="mono">
              {spacingLabel('above')}
            </Text>
            {stepButton('Increase space above', <LuArrowUpFromLine />, () => apply(c => stepSpacingClass(c, 'above', 1)))}
            {divider}
            {stepButton('Decrease space below', <LuArrowDownToLine />, () => apply(c => stepSpacingClass(c, 'below', -1)))}
            <Text fontSize="2xs" color="fg.muted" minW="30px" textAlign="center" fontFamily="mono">
              {spacingLabel('below')}
            </Text>
            {stepButton('Increase space below', <LuArrowDownFromLine />, () => apply(c => stepSpacingClass(c, 'below', 1)))}
          </HStack>
        )}
        </TooltipProvider>
      </Box>
    </Portal>
  );
}
