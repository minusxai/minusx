'use client';

/**
 * Read-only inspector for a question's Viz V2 envelope — shows exactly the JSON the
 * agent authors/edits (the envelope; query data is bound at render, never stored).
 * Pure view: envelope in, no Redux. Lives in the question page's Viz settings panel
 * when a V2 envelope is present (the classic drop-zone panels are bypassed then).
 */
import { useState } from 'react';
import { Box, Button, HStack, Text } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight, LuCopy, LuCheck } from 'react-icons/lu';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

export function VizSpecInspector({ envelope }: { envelope: VizEnvelope }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(envelope, null, 2);

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
          Advanced — Vega-Lite spec
        </Button>
        {open && (
          <Button aria-label="Copy Vega spec JSON" size="xs" variant="ghost" color="fg.muted" onClick={handleCopy} px={1}>
            {copied ? <LuCheck size={13} /> : <LuCopy size={13} />}
          </Button>
        )}
      </HStack>
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
