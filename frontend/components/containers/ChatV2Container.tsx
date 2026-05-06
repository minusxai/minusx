'use client';

// ChatV2Container — renders a `type: 'chat'` file (TS-orchestrator log).
// Minimal first cut: shows the conversation log in a scrollable panel and
// posts new user messages via `sendChatV2Message`. Designed to slot into the
// FileView routing for /f/<id> when the file is a chat.
//
// Future polish: tool-call detail rendering, streaming consumer, etc.

import { useEffect, useState, useCallback } from 'react';
import { Box, VStack, HStack, Text, Textarea, Button, Spinner } from '@chakra-ui/react';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  loadChatV2,
  selectChatV2,
  sendChatV2Message,
  setActiveChat,
} from '@/store/chatV2Slice';
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';
import type { FileComponentProps } from '@/lib/ui/fileComponents';

interface ChatFileContent {
  log: ConversationLog;
  agent: string;
  agent_args: Record<string, unknown>;
  forkedFrom?: number;
}

export default function ChatV2Container({ fileId }: FileComponentProps) {
  const numericId = typeof fileId === 'number' ? fileId : 0;
  const { fileState: file } = useFile(fileId) ?? {};
  const dispatch = useAppDispatch();

  const chatState = useAppSelector((s) => selectChatV2(s, numericId));
  const [input, setInput] = useState('');

  // On first load, snapshot the file's log into Redux so the UI has something
  // to render before any user interaction.
  useEffect(() => {
    if (file && !file.loading && numericId > 0) {
      const content = file.content as unknown as ChatFileContent | undefined;
      if (content?.log) {
        dispatch(loadChatV2({ chatId: numericId, log: content.log }));
        dispatch(setActiveChat({ chatId: numericId }));
      }
    }
  }, [file, numericId, dispatch]);

  const onSend = useCallback(() => {
    const message = input.trim();
    if (!message) return;
    setInput('');
    dispatch(sendChatV2Message({ chatId: numericId, message }));
  }, [input, numericId, dispatch]);

  if (!file || file.loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minH="400px">
        <Spinner size="lg" />
      </Box>
    );
  }

  const log = chatState?.log ?? (file.content as unknown as ChatFileContent | undefined)?.log ?? [];
  const executionState = chatState?.executionState ?? 'idle';

  return (
    <VStack align="stretch" h="100%" gap={3} p={4}>
      <Box flex="1" overflowY="auto" borderWidth="1px" borderRadius="md" p={3} aria-label="chat-log">
        {log.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">No messages yet — send a message below to start the chat.</Text>
        ) : (
          <VStack align="stretch" gap={2}>
            {log.map((entry, i) => (
              <ChatLogEntry key={i} entry={entry} />
            ))}
          </VStack>
        )}
      </Box>
      <HStack aria-label="chat-input-row">
        <Textarea
          aria-label="chat-input"
          placeholder="Send a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={2}
          disabled={executionState === 'running' || executionState === 'pending'}
        />
        <Button
          aria-label="chat-send"
          onClick={onSend}
          loading={executionState === 'running' || executionState === 'pending'}
        >
          Send
        </Button>
      </HStack>
      {chatState?.error && (
        <Text aria-label="chat-error" fontSize="sm" color="accent.danger">
          {chatState.error}
        </Text>
      )}
    </VStack>
  );
}

function ChatLogEntry({ entry }: { entry: ConversationLogEntry }) {
  // Pi-ai entries have `role: 'assistant' | 'toolResult'`. Root agent
  // invocations carry `type: 'toolCall'` with `parent_id: null` and
  // `arguments.userMessage` — render those as user messages.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = entry as any;
  if (e.type === 'toolCall' && e.parent_id === null) {
    const userText = String(e.arguments?.userMessage ?? '(no message)');
    return (
      <Box aria-label="chat-message-user" borderRadius="md" p={2} bg="accent.primary/10">
        <Text fontSize="xs" color="fg.muted">User</Text>
        <Text fontSize="sm" whiteSpace="pre-wrap">{userText}</Text>
      </Box>
    );
  }
  if (e.role === 'assistant') {
    const text = (e.content ?? [])
      .filter((c: { type?: string }) => c?.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('\n');
    const hasToolCall = (e.content ?? []).some((c: { type?: string }) => c?.type === 'toolCall');
    return (
      <Box aria-label="chat-message-assistant" borderRadius="md" p={2} bg="bg.muted">
        <Text fontSize="xs" color="fg.muted">Assistant{hasToolCall ? ' (tool call)' : ''}</Text>
        {text && <Text fontSize="sm" whiteSpace="pre-wrap">{text}</Text>}
        {hasToolCall && (
          <VStack align="stretch" gap={1} mt={1}>
            {(e.content as Array<{ type?: string; name?: string; arguments?: unknown }>)
              .filter((c) => c.type === 'toolCall')
              .map((c, i) => (
                <Text key={i} fontSize="xs" fontFamily="mono" color="accent.secondary">
                  → {c.name}({JSON.stringify(c.arguments)})
                </Text>
              ))}
          </VStack>
        )}
      </Box>
    );
  }
  if (e.role === 'toolResult') {
    const text = (e.content ?? [])
      .filter((c: { type?: string }) => c?.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('\n');
    return (
      <Box aria-label="chat-message-tool-result" borderRadius="md" p={2} borderLeftWidth="2px" borderColor={e.isError ? 'accent.danger' : 'accent.success'}>
        <Text fontSize="xs" color="fg.muted">{e.toolName} result{e.isError ? ' (error)' : ''}</Text>
        <Text fontSize="xs" fontFamily="mono" whiteSpace="pre-wrap">{text}</Text>
      </Box>
    );
  }
  return null;
}
