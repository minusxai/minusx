'use client';

/**
 * Read-only inspector for a question's Viz V2 envelope — shows exactly the JSON the
 * agent authors/edits (the envelope; query data is bound at render, never stored).
 * Pure view: envelope in, no Redux. Lives in the question page's Viz settings panel
 * when a V2 envelope is present (the classic drop-zone panels are bypassed then).
 */
import { useState } from 'react';
import { Box, Button, HStack, Text } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight, LuCopy, LuCheck, LuUnlink, LuRotateCcw } from 'react-icons/lu';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

export function VizSpecInspector({ envelope, onDetach, onReattach }: { envelope: VizEnvelope; onDetach?: () => void; onReattach?: () => void }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(envelope, null, 2);
  const source = envelope.source as unknown as { kind?: string; detachedFrom?: unknown };
  const kind = source.kind;
  const isRecipe = kind === 'recipe';
  const canReattach = source.detachedFrom != null;
  const label = kind === 'recipe' ? 'recipe' : kind === 'vega' ? 'Vega spec' : 'Vega-Lite spec';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Box borderTop="1px solid" borderColor="border.muted" pt={2} mt={2}>
      <HStack justify="space-between" align="center">
        <Button
          aria-label={open ? 'Collapse Vega spec' : 'Expand Vega spec'}
          size="xs"
          variant="ghost"
          color="fg.muted"
          fontWeight="600"
          onClick={() => setOpen(o => !o)}
          px={1}
        >
          {open ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
          Advanced — {label}
        </Button>
        {open && (
          <Button aria-label="Copy Vega spec JSON" size="xs" variant="ghost" color="fg.muted" onClick={handleCopy} px={1}>
            {copied ? <LuCheck size={13} /> : <LuCopy size={13} />}
          </Button>
        )}
      </HStack>
      {isRecipe && onDetach && (
        <Box mt={1} mb={2}>
          <Button aria-label="Customize freely" size="xs" variant="outline" colorPalette="teal" onClick={onDetach}>
            <LuUnlink size={13} /> Customize freely
          </Button>
          <Text fontSize="10px" color="fg.subtle" mt={1} lineHeight="1.5">
            Detach this recipe into its full editable spec — then ask the agent to change anything
            (colors, layers, labels…), no preset knob needed. Reversible.
          </Text>
        </Box>
      )}
      {canReattach && onReattach && (
        <Box mt={1} mb={2}>
          <Button aria-label="Reset to recipe" size="xs" variant="outline" colorPalette="gray" onClick={onReattach}>
            <LuRotateCcw size={13} /> Reset to recipe
          </Button>
          <Text fontSize="10px" color="fg.subtle" mt={1} lineHeight="1.5">
            Re-attach to the original recipe — restores the preset controls and upgrades,
            discarding your custom spec edits.
          </Text>
        </Box>
      )}
      {open && (
        <Box
          aria-label="Vega spec JSON"
          as="pre"
          mt={1}
          p={2}
          bg="bg.canvas"
          border="1px solid"
          borderColor="border.muted"
          borderRadius="md"
          fontSize="10.5px"
          fontFamily="mono"
          lineHeight="1.55"
          color="fg.muted"
          overflow="auto"
          maxH="60vh"
          whiteSpace="pre"
        >
          {json}
        </Box>
      )}
      <Text fontSize="10px" color="fg.subtle" mt={1} lineHeight="1.5">
        This is the exact content the agent reads and edits (data is bound at render time,
        never stored in the spec). Edit via chat; the classic viz settings are bypassed
        while this spec is present.
      </Text>
    </Box>
  );
}
