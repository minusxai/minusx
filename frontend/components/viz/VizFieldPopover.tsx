'use client';

/**
 * The unified vega-tier field settings popover: alias + d3 format for one field.
 * STORAGE-AGNOSTIC — the caller supplies the current {title, format} and commits
 * changes wherever its source keeps them: native vega-lite specs write surgical
 * spec edits (channel `title` / `axis.format`), recipe sources write
 * source.columnFormats (applied at materialization). One popover, one vocabulary
 * (d3), two storage layers.
 *
 * A format that matches no preset shows as-is in the Custom d3 input — presets
 * are shortcuts, the pattern is always visible and directly editable.
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Button, HStack, Input, Portal, Text } from '@chakra-ui/react';
import { LuSettings2 } from 'react-icons/lu';
import type { VizColumnKind } from '@/lib/viz/types';

const NUMBER_PRESETS: Array<{ label: string; format: string | null }> = [
  { label: 'Default (20k)', format: null },
  { label: '1,234', format: ',.0f' },
  { label: '1,234.56', format: ',.2f' },
  { label: '$1,234', format: '$,.0f' },
  { label: '12.3%', format: '.1%' },
];

const DATE_PRESETS: Array<{ label: string; format: string | null }> = [
  { label: 'Default (smart)', format: null },
  { label: 'Jan 2025', format: '%b %Y' },
  { label: "Jan '25", format: "%b '%y" },
  { label: '2025-01-31', format: '%Y-%m-%d' },
];

export interface VizFieldPopoverProps {
  /** Display key for aria labels (native: the channel, recipes: the column). */
  channel: string;
  kind: VizColumnKind;
  value: { title: string | null; format: string | null };
  onCommit: (next: { title: string | null; format: string | null }) => void;
}

const PANEL_WIDTH = 220;

export function VizFieldPopover({ channel, kind, value, onCommit }: VizFieldPopoverProps) {
  const [open, setOpen] = useState(false);
  // Anchor position for the portaled panel, computed from the gear's rect when opened.
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [alias, setAlias] = useState(value.title ?? '');
  const [formatDraft, setFormatDraft] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setAlias(value.title ?? ''); setFormatDraft(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync drafts only on open
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const commitAlias = () => {
    onCommit({ title: alias.trim() === '' ? null : alias.trim(), format: value.format });
  };
  const commitFormat = (raw: string) => {
    onCommit({ title: value.title, format: raw.trim() === '' ? null : raw.trim() });
    setFormatDraft(null);
  };

  const presets = kind === 'temporal' ? DATE_PRESETS : kind === 'quantitative' ? NUMBER_PRESETS : null;
  const hasCustomization = value.title != null || value.format != null;

  return (
    <Box position="relative" ref={rootRef} display="inline-flex">
      <Box
        as="button"
        aria-label={`Field settings for ${channel}`}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - PANEL_WIDTH) });
          setOpen(o => !o);
        }}
        color={hasCustomization ? 'accent.teal' : 'fg.subtle'}
        _hover={{ color: 'accent.teal' }}
        transition="color 0.2s"
        flexShrink={0}
      >
        <LuSettings2 size={12} />
      </Box>
      {open && (
        // Portaled to body: the zone chip clips its contents (overflow:hidden for name
        // ellipsis), so an in-chip absolute panel renders invisibly. Fixed-positioned
        // from the gear's rect instead.
        <Portal>
        <Box
          ref={panelRef}
          aria-label={`Field settings panel for ${channel}`}
          position="fixed"
          top={`${pos.top}px`}
          left={`${pos.left}px`}
          w={`${PANEL_WIDTH}px`}
          p={3}
          bg="bg.panel"
          border="1px solid"
          borderColor="border.muted"
          borderRadius="md"
          boxShadow="md"
          zIndex={1500}
          display="flex"
          flexDirection="column"
          gap={2}
        >
          <Box>
            <Text fontSize="10px" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
              Alias
            </Text>
            <Input
              aria-label={`Alias for ${channel}`}
              size="xs"
              fontFamily="mono"
              placeholder="display name"
              value={alias}
              onChange={e => setAlias(e.target.value)}
              onBlur={commitAlias}
              onKeyDown={e => { if (e.key === 'Enter') { commitAlias(); setOpen(false); } }}
            />
          </Box>
          {presets && (
            <Box>
              <Text fontSize="10px" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
                Format
              </Text>
              <HStack gap={1} flexWrap="wrap">
                {presets.map(({ label, format }) => (
                  <Button
                    key={label}
                    aria-label={`Format ${label}`}
                    size="2xs"
                    px={1.5}
                    fontFamily="mono"
                    variant={value.format === format ? 'solid' : 'outline'}
                    colorPalette={value.format === format ? 'teal' : undefined}
                    onClick={() => onCommit({ title: value.title, format })}
                  >
                    {label}
                  </Button>
                ))}
              </HStack>
              {/* The pattern itself, always visible & editable — a non-preset value
                  (agent-authored or hand-typed) shows here instead of hiding. */}
              <Input
                aria-label={`Custom d3 format for ${channel}`}
                size="xs"
                mt={1.5}
                fontFamily="mono"
                placeholder="custom d3, e.g. .2~s"
                value={formatDraft ?? value.format ?? ''}
                onChange={e => setFormatDraft(e.target.value)}
                onBlur={() => { if (formatDraft != null) commitFormat(formatDraft); }}
                onKeyDown={e => { if (e.key === 'Enter') { commitFormat((e.target as HTMLInputElement).value); } }}
              />
              <Text fontSize="9px" color="fg.subtle" mt={1.5} lineHeight="1.4">
                d3 format strings — presets fill the pattern; type your own for anything custom.
              </Text>
            </Box>
          )}
        </Box>
        </Portal>
      )}
    </Box>
  );
}
