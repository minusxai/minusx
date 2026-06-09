'use client';

import { useMemo, useState } from 'react';
import { Box, HStack, Text, Button, Input, VStack, Portal, MenuRoot, MenuTrigger, MenuPositioner, MenuContent } from '@chakra-ui/react';
import { LuChartColumn, LuScanSearch, LuSearch } from 'react-icons/lu';

export interface PickableQuestion {
  id: number;
  name: string;
}

interface ChartPickerProps {
  questions: PickableQuestion[];
  onPick: (questionId: number) => void;
  label?: string;
}

/**
 * Shared "Insert chart" control: a clean toolbar button that opens a searchable
 * list of the document's questions. Reused by the report and presentation editors.
 */
export default function ChartPicker({ questions, onPick, label = 'Insert chart' }: ChartPickerProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? questions.filter(x => x.name.toLowerCase().includes(q)) : questions;
  }, [questions, search]);

  return (
    <MenuRoot positioning={{ placement: 'bottom-end' }} closeOnSelect={false}>
      <MenuTrigger asChild>
        <Button
          size="2xs"
          variant="ghost"
          aria-label={label}
          px={2}
          gap={1.5}
          h="24px"
          fontWeight={600}
          color="fg.default"
          _hover={{ bg: 'bg.emphasized' }}
          flexShrink={0}
        >
          <Box color="accent.teal" display="flex"><LuChartColumn size={13} /></Box>
          {label}
        </Button>
      </MenuTrigger>
      <Portal>
        <MenuPositioner>
          <MenuContent minW="280px" bg="bg.surface" borderColor="border.default" shadow="lg" p={2}>
            <Box position="relative" mb={2}>
              <Box position="absolute" left={2.5} top="50%" transform="translateY(-50%)" color="fg.muted" pointerEvents="none">
                <LuSearch size={12} />
              </Box>
              <Input
                placeholder="Search questions…"
                size="xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                pl={7}
                autoFocus
              />
            </Box>
            <VStack align="stretch" gap={0} maxH="260px" overflowY="auto">
              {filtered.length === 0 ? (
                <Text fontSize="xs" color="fg.muted" px={2} py={3} textAlign="center">No questions</Text>
              ) : filtered.map(q => (
                <HStack
                  key={q.id}
                  as="button"
                  aria-label={`Insert ${q.name}`}
                  gap={2}
                  px={2}
                  py={1.5}
                  borderRadius="sm"
                  cursor="pointer"
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => onPick(q.id)}
                >
                  <Box color="accent.primary" flexShrink={0}><LuScanSearch size={13} /></Box>
                  <Text fontSize="xs" fontWeight={500} color="fg.default" lineClamp={1} textAlign="left">{q.name}</Text>
                </HStack>
              ))}
            </VStack>
          </MenuContent>
        </MenuPositioner>
      </Portal>
    </MenuRoot>
  );
}
