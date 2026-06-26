'use client';

import { Dialog, Portal, Button, HStack, Text, Badge } from '@chakra-ui/react';
import type { InspectPart } from './inspect-content';
import InspectContent from './InspectContent';

interface ContentInspectModalProps {
  title: string;
  parts: InspectPart[];
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Detail inspector for non-tool conversation entries (User message / App state). Renders the entry's
 * typed parts by content type via {@link InspectContent} — images inline, markup as formatted code,
 * query results as tables, JSON pretty-printed. Mirrors ToolInspectModal's chrome (sans args/re-run).
 */
export default function ContentInspectModal({ title, parts, isOpen, onClose }: ContentInspectModalProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => !e.open && onClose()} size="xl">
      <Portal>
        <Dialog.Backdrop zIndex={100000} />
        <Dialog.Positioner zIndex={100000}>
          <Dialog.Content maxW="900px" p={0} borderRadius="lg" bg="bg.surface" overflow="hidden">
            <Dialog.Header px={5} py={4} borderBottom="1px solid" borderColor="border.default">
              <HStack gap={3}>
                <Text fontWeight="bold" fontSize="md">{title}</Text>
                <Badge colorPalette="gray" size="sm">{parts.length} {parts.length === 1 ? 'part' : 'parts'}</Badge>
              </HStack>
            </Dialog.Header>

            <Dialog.Body p={5} maxH="70vh" overflowY="auto">
              <InspectContent parts={parts} />
            </Dialog.Body>

            <Dialog.Footer px={5} py={4} borderTop="1px solid" borderColor="border.default">
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </Dialog.Footer>

            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
