'use client';

/**
 * Jupyter/Colab-style insert affordance between cells (and above the first /
 * below the last). It shows a faint divider with a "+" at rest; on hover the
 * divider highlights and "+ SQL" / "+ Text" buttons appear to insert a new cell
 * at this position. Hover is tracked in local state (robust across Chakra's
 * group-hover selector quirks).
 */
import { useState } from 'react';
import { Box, HStack, Button, Icon } from '@chakra-ui/react';
import { LuPlus } from 'react-icons/lu';

interface CellInsertZoneProps {
  onInsert: (type: 'sql' | 'text') => void;
  readOnly?: boolean;
}

export default function CellInsertZone({ onInsert, readOnly = false }: CellInsertZoneProps) {
  const [hovered, setHovered] = useState(false);
  if (readOnly) return null;

  return (
    <Box
      role="group"
      aria-label="Insert cell"
      position="relative"
      h="26px"
      display="flex"
      alignItems="center"
      justifyContent="center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      zIndex={1}
    >
      {/* Divider line */}
      <Box
        position="absolute"
        left={2}
        right={2}
        top="50%"
        h="1px"
        bg={hovered ? 'accent.teal' : 'border.muted'}
        opacity={hovered ? 0.6 : 0.5}
        transition="all 0.12s"
      />
      {/* Affordance: a small "+" at rest, expanding to insert buttons on hover */}
      <HStack gap={1} bg="bg.canvas" px={1} position="relative" transition="all 0.12s">
        {hovered ? (
          <>
            <Button aria-label="Insert SQL cell" size="2xs" variant="outline" colorPalette="teal" h="20px" px={2} fontSize="10px" gap={1} onClick={() => onInsert('sql')}>
              <LuPlus size={10} /> SQL
            </Button>
            <Button aria-label="Insert text cell" size="2xs" variant="outline" h="20px" px={2} fontSize="10px" gap={1} onClick={() => onInsert('text')}>
              <LuPlus size={10} /> Text
            </Button>
          </>
        ) : (
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            boxSize="18px"
            borderRadius="full"
            borderWidth="1px"
            borderColor="border.muted"
            color="fg.subtle"
            bg="bg.canvas"
          >
            <Icon as={LuPlus} boxSize="11px" />
          </Box>
        )}
      </HStack>
    </Box>
  );
}
