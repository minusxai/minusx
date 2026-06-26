'use client';

import { useMemo, useState } from 'react';
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
import { LuPencil, LuUser, LuLayoutDashboard } from 'react-icons/lu';
import type { CompletedToolCall as ToolCallTuple, ToolCall, ToolMessage } from '@/lib/types';
import type { CompletedToolCall as FlatToolCall, UserMessage } from '@/store/chatSlice';
import type { MessageWithFlags } from './message/messageHelpers';
import ToolInspectModal from './ToolInspectModal';
import ContentInspectModal from './ContentInspectModal';
import { userMessageParts, appStateParts, type InspectPart } from './inspect-content';

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

// A single inspectable row in the conversation log: a tool call, the user's message, or the app
// state sent with that user turn. User message + app state are rendered by content type (images,
// markup, query data, JSON) — identical rendering, via the shared inspect-content codec.
type Entry =
  | { kind: 'tool'; key: string; name: string; hasError: boolean; preview: string; msg: FlatToolCall }
  | { kind: 'content'; key: string; entryKind: 'user' | 'appState'; title: string; preview: string; parts: InspectPart[] };

function previewParts(parts: InspectPart[]): string {
  return parts.map((p) => p.kind).join(' · ');
}

function buildEntries(messages: MessageWithFlags[]): Entry[] {
  const entries: Entry[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      const um = m as UserMessage & MessageWithFlags;
      const userParts = userMessageParts({ content: um.content, attachments: um.attachments });
      if (userParts.length > 0) {
        entries.push({
          kind: 'content', key: `user-${i}`, entryKind: 'user', title: 'User message',
          preview: typeof um.content === 'string' ? um.content : previewParts(userParts), parts: userParts,
        });
      }
      const stateParts = appStateParts(um.appState);
      if (stateParts.length > 0) {
        entries.push({
          kind: 'content', key: `appstate-${i}`, entryKind: 'appState', title: 'App state',
          preview: previewParts(stateParts), parts: stateParts,
        });
      }
    } else if (m.role === 'tool') {
      const msg = m as FlatToolCall & MessageWithFlags;
      const hasError = typeof msg.content === 'string' && msg.content.includes('"success":false');
      let preview = '';
      try {
        const parsed = typeof msg.function.arguments === 'string' ? JSON.parse(msg.function.arguments) : msg.function.arguments;
        preview = Object.entries(parsed as Record<string, unknown>).slice(0, 2).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('  ');
      } catch { /* skip preview */ }
      entries.push({ kind: 'tool', key: `${msg.tool_call_id}-${i}`, name: msg.function.name, hasError, preview, msg });
    }
  });
  return entries;
}

export default function ToolCallListModal({ messages, isOpen, onClose }: ToolCallListModalProps) {
  const [inspecting, setInspecting] = useState<ToolCallTuple | null>(null);
  const [contentInspect, setContentInspect] = useState<{ title: string; parts: InspectPart[] } | null>(null);

  const entries = useMemo(() => buildEntries(messages), [messages]);

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={(e) => !e.open && onClose()} size="lg">
        <Portal>
        <Dialog.Backdrop zIndex={99999} />
        <Dialog.Positioner zIndex={99999}>
          <Dialog.Content maxW="600px" borderRadius="lg" bg="bg.surface" overflow="hidden">
            <Dialog.Header px={5} py={4} borderBottom="1px solid" borderColor="border.default">
              <HStack gap={2}>
                <Text fontWeight="bold" fontSize="md">Conversation</Text>
                <Badge colorPalette="gray" size="sm">{entries.length}</Badge>
              </HStack>
            </Dialog.Header>

            <Dialog.Body p={4}>
              {entries.length === 0 ? (
                <Text fontSize="sm" color="fg.muted" textAlign="center" py={6}>
                  Nothing in this conversation yet.
                </Text>
              ) : (
                <VStack gap={2} align="stretch">
                  {entries.map((entry) => {
                    const isContent = entry.kind === 'content';
                    const onOpen = () => isContent
                      ? setContentInspect({ title: entry.title, parts: entry.parts })
                      : setInspecting(toInspectTuple(entry.msg));
                    return (
                      <Box
                        key={entry.key}
                        px={3}
                        py={2}
                        border="1px solid"
                        borderColor="border.default"
                        borderRadius="md"
                        bg="bg.canvas"
                        cursor="pointer"
                        _hover={{ borderColor: 'accent.teal' }}
                        onClick={onOpen}
                      >
                        <HStack justify="space-between" gap={3}>
                          <HStack gap={2} minW="0" flex="1">
                            {entry.kind === 'tool' ? (
                              <Badge colorPalette={entry.hasError ? 'red' : 'green'} size="xs" flexShrink={0}>
                                {entry.hasError ? 'err' : 'ok'}
                              </Badge>
                            ) : (
                              <Box flexShrink={0} color={entry.entryKind === 'user' ? 'accent.primary' : 'accent.cyan'}>
                                {entry.entryKind === 'user' ? <LuUser size={14} /> : <LuLayoutDashboard size={14} />}
                              </Box>
                            )}
                            <Text fontFamily="mono" fontSize="sm" fontWeight="600" truncate>
                              {entry.kind === 'tool' ? entry.name : entry.title}
                            </Text>
                          </HStack>
                          {entry.kind === 'tool' && (
                            <IconButton
                              aria-label="Inspect tool call"
                              size="xs"
                              variant="ghost"
                              flexShrink={0}
                              onClick={(e) => { e.stopPropagation(); setInspecting(toInspectTuple(entry.msg)); }}
                            >
                              <LuPencil />
                            </IconButton>
                          )}
                        </HStack>

                        {entry.preview && (
                          <Text fontSize="xs" color="fg.subtle" fontFamily="mono" mt={1} truncate>
                            {entry.preview}
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

      {/* Tool-call detail inspector — opens on top of list */}
      {inspecting && (
        <ToolInspectModal
          toolCall={inspecting[0]}
          toolMessage={inspecting[1]}
          isOpen={!!inspecting}
          onClose={() => setInspecting(null)}
        />
      )}

      {/* User-message / App-state detail inspector */}
      {contentInspect && (
        <ContentInspectModal
          title={contentInspect.title}
          parts={contentInspect.parts}
          isOpen={!!contentInspect}
          onClose={() => setContentInspect(null)}
        />
      )}
    </>
  );
}
