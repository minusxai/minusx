'use client';

/**
 * Read-only inspector for one /debug bar component: renders the component's
 * actual content (text, images, JSON) via the shared InspectContent part
 * renderer. No editing — plain display only.
 */
import { Dialog, Portal, Button, HStack, Text, Badge, Box } from '@chakra-ui/react';
import type { BarComponent, TurnBar } from '@/lib/convo-debug/types';
import type { InspectPart } from './inspect-content';
import InspectContent from './InspectContent';

interface ConvoDebugInspectModalProps {
  bar: TurnBar;
  component: BarComponent;
  onClose: () => void;
}

function toInspectParts(component: BarComponent): InspectPart[] {
  return component.content.map((c, i) => {
    const label = component.toolName ? `${component.type} · ${component.toolName}` : `${component.type} #${i + 1}`;
    if (c.kind === 'text') return { kind: 'text', label, text: c.text };
    if (c.kind === 'image') return { kind: 'image', label, url: c.src };
    return { kind: 'json', label, value: c.value };
  });
}

export default function ConvoDebugInspectModal({ bar, component, onClose }: ConvoDebugInspectModalProps) {
  const parts = toInspectParts(component);
  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()} size="xl">
      <Portal>
        <Dialog.Backdrop zIndex={100001} />
        <Dialog.Positioner zIndex={100001}>
          <Dialog.Content aria-label="debug component inspector" maxW="900px" p={0} borderRadius="lg" bg="bg.surface" overflow="hidden">
            <Dialog.Header px={5} py={4} borderBottom="1px solid" borderColor="border.default">
              <HStack gap={3}>
                <Text fontWeight="bold" fontSize="md">{bar.label}</Text>
                <Badge colorPalette="gray" size="sm">{component.type}{component.toolName ? ` · ${component.toolName}` : ''}</Badge>
                <Badge colorPalette="blue" size="sm" aria-label="component approx tokens">
                  ~{component.tokens.toLocaleString()} tokens
                </Badge>
              </HStack>
            </Dialog.Header>
            <Dialog.Body p={5} maxH="70vh" overflowY="auto">
              <Box>
                <InspectContent parts={parts} />
              </Box>
            </Dialog.Body>
            <Dialog.Footer px={5} py={4} borderTop="1px solid" borderColor="border.default">
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="close inspector">Close</Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
