'use client';

/**
 * Read-only BAR-level inspector for the /debug viz: lists EVERY component of
 * the clicked bar with its token count (so segments too small to see — a
 * 12-token user message stacked after a 15k system prompt — stay reachable),
 * rendering each component's actual content via the shared InspectContent
 * part renderer. The clicked segment's section is highlighted. No editing.
 */
import { Dialog, Portal, Button, HStack, Text, Badge, Box, VStack } from '@chakra-ui/react';
import type { BarComponent, TurnBar } from '@/lib/convo-debug/types';
import { segmentLabel } from '@/lib/convo-debug';
import type { InspectPart } from './inspect-content';
import InspectContent from './InspectContent';

interface ConvoDebugInspectModalProps {
  bar: TurnBar;
  /** Component index of the clicked segment (highlighted in the list). */
  selectedIndex: number;
  onClose: () => void;
}

function toInspectParts(component: BarComponent): InspectPart[] {
  const label = segmentLabel(component);
  return component.content.map((c) => {
    if (c.kind === 'text') return { kind: 'text', label, text: c.text };
    if (c.kind === 'image') return { kind: 'image', label, url: c.src };
    return { kind: 'json', label, value: c.value };
  });
}

export default function ConvoDebugInspectModal({ bar, selectedIndex, onClose }: ConvoDebugInspectModalProps) {
  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()} size="xl">
      <Portal>
        <Dialog.Backdrop zIndex={100001} />
        <Dialog.Positioner zIndex={100001}>
          <Dialog.Content aria-label="debug component inspector" maxW="900px" p={0} borderRadius="lg" bg="bg.surface" overflow="hidden">
            <Dialog.Header px={5} py={4} borderBottom="1px solid" borderColor="border.default">
              <HStack gap={3}>
                <Text fontWeight="bold" fontSize="md">{bar.label}</Text>
                <Badge colorPalette="gray" size="sm">{bar.components.length} components</Badge>
                <Badge colorPalette="blue" size="sm" aria-label="bar approx tokens">
                  ~{bar.tokens.toLocaleString()} tokens
                </Badge>
              </HStack>
            </Dialog.Header>
            <Dialog.Body p={5} maxH="70vh" overflowY="auto">
              <VStack align="stretch" gap={4}>
                {bar.components.map((component, i) => (
                  <Box
                    key={i}
                    aria-label={`inspect component ${i}`}
                    p={3}
                    borderRadius="md"
                    borderWidth="1px"
                    borderColor={i === selectedIndex ? 'accent.primary' : 'border.default'}
                    bg={i === selectedIndex ? 'bg.subtle' : undefined}
                  >
                    <HStack gap={2} mb={2}>
                      <Text fontSize="sm" fontWeight="bold" fontFamily="mono">{segmentLabel(component)}</Text>
                      <Badge colorPalette="blue" size="sm">~{component.tokens.toLocaleString()} tokens</Badge>
                      {component.imageCount > 0 && (
                        <Badge colorPalette="cyan" size="sm">{component.imageCount} image{component.imageCount > 1 ? 's' : ''}</Badge>
                      )}
                    </HStack>
                    <InspectContent parts={toInspectParts(component)} />
                  </Box>
                ))}
              </VStack>
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
