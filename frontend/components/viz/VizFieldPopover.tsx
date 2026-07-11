'use client';

/**
 * The zone-chip settings popover (V2): alias + format for one encoding channel.
 * Everything is a SURGICAL spec edit (lib/viz/encoding-edit — alias = channel
 * `title`, format = a d3 pattern on the axis/field), and the friendly presets
 * compile to d3 strings per the RFC. Native vega-lite sources only; recipes
 * format internally and folded multi-Y measures share one axis (agent territory).
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Button, HStack, Input, Text } from '@chakra-ui/react';
import { LuSettings2 } from 'react-icons/lu';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { getChannelPresentation, setChannelPresentation } from '@/lib/viz/encoding-edit';
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
  envelope: VizEnvelope;
  channel: string;
  kind: VizColumnKind;
  onVizChange: (envelope: VizEnvelope) => void;
}

export function VizFieldPopover({ envelope, channel, kind, onVizChange }: VizFieldPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = getChannelPresentation(envelope, channel);
  const [alias, setAlias] = useState(current.title ?? '');

  useEffect(() => {
    if (open) setAlias(getChannelPresentation(envelope, channel).title ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync draft only on open
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const commitAlias = () => {
    onVizChange(setChannelPresentation(envelope, channel, { title: alias.trim() === '' ? null : alias.trim() }));
  };

  const presets = kind === 'temporal' ? DATE_PRESETS : kind === 'quantitative' ? NUMBER_PRESETS : null;
  const hasCustomization = current.title != null || current.format != null;

  return (
    <Box position="relative" ref={rootRef} display="inline-flex">
      <Box
        as="button"
        aria-label={`Field settings for ${channel}`}
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen(o => !o); }}
        color={hasCustomization ? 'accent.teal' : 'fg.subtle'}
        _hover={{ color: 'accent.teal' }}
        transition="color 0.2s"
        flexShrink={0}
      >
        <LuSettings2 size={12} />
      </Box>
      {open && (
        <Box
          position="absolute"
          top="100%"
          right={0}
          mt={2}
          w="220px"
          p={3}
          bg="bg.panel"
          border="1px solid"
          borderColor="border.muted"
          borderRadius="md"
          boxShadow="md"
          zIndex={20}
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
                    variant={current.format === format ? 'solid' : 'outline'}
                    colorPalette={current.format === format ? 'teal' : undefined}
                    onClick={() => onVizChange(setChannelPresentation(envelope, channel, { format }))}
                  >
                    {label}
                  </Button>
                ))}
              </HStack>
              <Text fontSize="9px" color="fg.subtle" mt={1.5} lineHeight="1.4">
                d3 format strings — ask the agent for anything custom.
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
