'use client';

import { useState } from 'react';
import {
  Dialog,
  Portal,
  Button,
  VStack,
  HStack,
  Text,
  Box,
  Badge,
  IconButton,
} from '@chakra-ui/react';
import { LuPencil } from 'react-icons/lu';
import type { CompletedToolCall as ToolCallTuple, ToolCall, ToolMessage } from '@/lib/types';
import type { CompletedToolCall as FlatToolCall } from '@/store/chatSlice';
import type { MessageWithFlags } from './message/messageHelpers';
import ToolInspectModal from './ToolInspectModal';

interface ToolCallListModalProps {
  messages: MessageWithFlags[];
  isOpen: boolean;
  onClose: () => void;
}

/** Build a [ToolCall, ToolMessage] tuple from a flat chatSlice CompletedToolCall */
function toInspectTuple(msg: FlatToolCall): ToolCallTuple {
  let args: Record<string, any> = {};
  try {
    args = typeof msg.function.arguments === 'string'
      ? JSON.parse(msg.function.arguments)
      : msg.function.arguments;
  } catch { /* leave args as {} */ }

  const toolCall: ToolCall = {
    id: msg.tool_call_id,
    type: 'function',
    function: { name: msg.function.name, arguments: args },
  };
  const toolMessage: ToolMessage = {
    role: 'tool',
    tool_call_id: msg.tool_call_id,
    content: msg.content,
    details: msg.details as ToolMessage['details'],
  };
  return [toolCall, toolMessage];
}

export default function ToolCallListModal({ messages, isOpen, onClose }: ToolCallListModalProps) {
  const [inspecting, setInspecting] = useState<ToolCallTuple | null>(null);

  const toolCalls = messages.filter(
    (m): m is FlatToolCall & MessageWithFlags => m.role === 'tool'
  );

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={(e) => !e.open && onClose()} size="lg">
        <Portal>
        <Dialog.Backdrop zIndex={99999} />
        <Dialog.Positioner zIndex={99999}>
          <Dialog.Content maxW="600px" borderRadius="lg" bg="bg.surface" overflow="hidden">
            <Dialog.Header px={5} py={4} borderBottom="1px solid" borderColor="border.default">
              <HStack gap={2}>
                <Text fontWeight="bold" fontSize="md">Tool Calls</Text>
                <Badge colorPalette="gray" size="sm">{toolCalls.length}</Badge>
              </HStack>
            </Dialog.Header>

            <Dialog.Body p={4}>
              {toolCalls.length === 0 ? (
                <Text fontSize="sm" color="fg.muted" textAlign="center" py={6}>
                  No tool calls in this conversation yet.
                </Text>
              ) : (
                <VStack gap={2} align="stretch">
                  {toolCalls.map((msg, idx) => {
                    const hasError =
                      typeof msg.content === 'string' &&
                      msg.content.includes('"success":false');

                    let argPreview = '';
                    try {
                      const parsed = typeof msg.function.arguments === 'string'
                        ? JSON.parse(msg.function.arguments)
                        : msg.function.arguments;
                      argPreview = Object.entries(parsed as Record<string, unknown>)
                        .slice(0, 2)
                        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                        .join('  ');
                    } catch { /* skip preview */ }

                    return (
                      <Box
                        key={`${msg.tool_call_id}-${idx}`}
                        px={3}
                        py={2}
                        border="1px solid"
                        borderColor="border.default"
                        borderRadius="md"
                        bg="bg.canvas"
                        cursor="pointer"
                        _hover={{ borderColor: 'accent.teal' }}
                        onClick={() => setInspecting(toInspectTuple(msg))}
                      >
                        <HStack justify="space-between" gap={3}>
                          <HStack gap={2} minW="0" flex="1">
                            <Badge
                              colorPalette={hasError ? 'red' : 'green'}
                              size="xs"
                              flexShrink={0}
                            >
                              {hasError ? 'err' : 'ok'}
                            </Badge>
                            <Text
                              fontFamily="mono"
                              fontSize="sm"
                              fontWeight="600"
                              truncate
                            >
                              {msg.function.name}
                            </Text>
                          </HStack>
                          <IconButton
                            aria-label="Inspect tool call"
                            size="xs"
                            variant="ghost"
                            flexShrink={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspecting(toInspectTuple(msg));
                            }}
                          >
                            <LuPencil />
                          </IconButton>
                        </HStack>

                        {argPreview && (
                          <Text fontSize="xs" color="fg.subtle" fontFamily="mono" mt={1} truncate>
                            {argPreview}
                          </Text>
                        )}
                      </Box>
                    );
                  })}
                </VStack>
              )}
            </Dialog.Body>

            <Dialog.Footer px={5} py={4} borderTop="1px solid" borderColor="border.default">
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </Dialog.Footer>

            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Detail inspector — opens on top of list */}
      {inspecting && (
        <ToolInspectModal
          toolCall={inspecting[0]}
          toolMessage={inspecting[1]}
          isOpen={!!inspecting}
          onClose={() => setInspecting(null)}
        />
      )}
    </>
  );
}
