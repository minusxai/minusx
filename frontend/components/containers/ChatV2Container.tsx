'use client';

// ChatV2Container — renders a `type: 'chat'` file (TS-orchestrator log).
// Routes recognised tool names to existing detail components from
// `components/explore/tools/*` (EditFileDisplay, ExecuteSQLDisplay, etc.) so
// chat-v2 reuses the polished display surfaces. Unknown tool names fall back
// to a generic JSON renderer.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Box, VStack, HStack, Text, Textarea, Button, Spinner } from '@chakra-ui/react';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  loadChatV2,
  selectChatV2,
  sendChatV2Message,
  setActiveChat,
} from '@/store/chatV2Slice';
import type { ConversationLog, ConversationLogEntry, AgentInvocation } from '@/orchestrator/types';
import type { AssistantMessage, ToolResultMessage, ToolCall as PiToolCall } from '@mariozechner/pi-ai';
import type { FileComponentProps } from '@/lib/ui/fileComponents';
import type { ToolCall, ToolMessage, CompletedToolCall, DisplayProps } from '@/lib/types';
import EditFileDisplay from '@/components/explore/tools/EditFileDisplay';
import CreateFileDisplay from '@/components/explore/tools/CreateFileDisplay';
import ExecuteSQLDisplay from '@/components/explore/tools/ExecuteSQLDisplay';
import ReadFilesDisplay from '@/components/explore/tools/ReadFilesDisplay';
import SearchDBSchemaDisplay from '@/components/explore/tools/SearchDBSchemaDisplay';
import SearchFilesDisplay from '@/components/explore/tools/SearchFilesDisplay';
import DefaultToolDisplay from '@/components/explore/tools/DefaultToolDisplay';

// Mirrors `lib/chat-v2/chat-file.ts:ChatContent` (server-only). The component
// only ever reads `content.log` — fork pointers + counters live on `files.meta`
// now, exposed via the `FileState.meta` field.
interface ChatFileContent {
  log: ConversationLog;
}

// Discriminators for ConversationLogEntry. The union is
// `(AgentInvocation | AssistantMessage | ToolResultMessage) & { parent_id }` —
// AgentInvocation has `type: 'toolCall'`, the other two have `role`.
type LogEntryWithParent = ConversationLogEntry;
type AgentInvocationEntry = AgentInvocation & { parent_id: string | null };
type AssistantEntry = AssistantMessage & { parent_id: string | null };
type ToolResultEntry = ToolResultMessage & { parent_id: string | null };

function isAgentInvocation(e: LogEntryWithParent): e is AgentInvocationEntry {
  return (e as { type?: string }).type === 'toolCall';
}
function isAssistant(e: LogEntryWithParent): e is AssistantEntry {
  return 'role' in e && e.role === 'assistant';
}
function isToolResult(e: LogEntryWithParent): e is ToolResultEntry {
  return 'role' in e && e.role === 'toolResult';
}

// Tool name → DisplayProps component. Names match the WebAnalystAgent /
// RemoteAnalystAgent tool schema names so the existing components plug in
// directly.
const TOOL_DISPLAY_BY_NAME: Record<string, React.ComponentType<DisplayProps>> = {
  EditFile: EditFileDisplay,
  CreateFile: CreateFileDisplay,
  ExecuteSQL: ExecuteSQLDisplay,
  ReadFiles: ReadFilesDisplay,
  SearchDBSchema: SearchDBSchemaDisplay,
  SearchFiles: SearchFilesDisplay,
};

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

  const log = chatState?.log ?? (file?.content as unknown as ChatFileContent | undefined)?.log ?? [];
  const executionState = chatState?.executionState ?? 'idle';

  // Pair toolCall blocks with their matching toolResult entries so we can
  // render via the [ToolCall, ToolMessage] DisplayProps shape.
  const toolResultByCallId = useMemo(() => {
    const map = new Map<string, ToolMessage>();
    for (const entry of log) {
      if (isToolResult(entry)) {
        map.set(entry.toolCallId, {
          role: 'tool',
          tool_call_id: entry.toolCallId,
          content: pickText(entry.content),
          details: entry.details as ToolMessage['details'],
        });
      }
    }
    return map;
  }, [log]);

  if (!file || file.loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minH="400px">
        <Spinner size="lg" />
      </Box>
    );
  }

  return (
    <VStack align="stretch" h="100%" gap={3} p={4}>
      <Box flex="1" overflowY="auto" borderWidth="1px" borderRadius="md" p={3} aria-label="chat-log">
        {log.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">No messages yet — send a message below to start the chat.</Text>
        ) : (
          <VStack align="stretch" gap={2}>
            {log.map((entry, i) => (
              <ChatLogEntry key={i} entry={entry} toolResultByCallId={toolResultByCallId} />
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

interface ChatLogEntryProps {
  entry: ConversationLogEntry;
  toolResultByCallId: Map<string, ToolMessage>;
}

function ChatLogEntry({ entry, toolResultByCallId }: ChatLogEntryProps) {
  // Root user message — the first AgentInvocation log entry (parent_id === null).
  if (isAgentInvocation(entry) && entry.parent_id === null) {
    const args = entry.arguments as { userMessage?: unknown };
    const userText =
      typeof args.userMessage === 'string' ? args.userMessage : '(no message)';
    return (
      <Box aria-label="chat-message-user" borderRadius="md" p={2} bg="accent.primary/10">
        <Text fontSize="xs" color="fg.muted">User</Text>
        <Text fontSize="sm" whiteSpace="pre-wrap">{userText}</Text>
      </Box>
    );
  }

  if (isAssistant(entry)) {
    const blocks = entry.content ?? [];
    const text = blocks
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const toolCalls = blocks.filter((c): c is PiToolCall => c.type === 'toolCall');
    return (
      <Box aria-label="chat-message-assistant" borderRadius="md" p={2} bg="bg.muted">
        {text && (
          <>
            <Text fontSize="xs" color="fg.muted">Assistant</Text>
            <Text fontSize="sm" whiteSpace="pre-wrap">{text}</Text>
          </>
        )}
        {toolCalls.length > 0 && (
          <VStack align="stretch" gap={2} mt={text ? 2 : 0}>
            {toolCalls.map((tc, i) => (
              <ToolCallEntry
                key={tc.id ?? i}
                toolCall={tc}
                toolResult={toolResultByCallId.get(tc.id)}
              />
            ))}
          </VStack>
        )}
      </Box>
    );
  }

  // Standalone toolResult entries are rendered as part of their assistant
  // parent; skip here so we don't double-render.
  return null;
}

interface ToolCallEntryProps {
  toolCall: PiToolCall;
  toolResult: ToolMessage | undefined;
}

function ToolCallEntry({ toolCall, toolResult }: ToolCallEntryProps) {
  const Display = TOOL_DISPLAY_BY_NAME[toolCall.name] ?? DefaultToolDisplay;
  const ariaLabel = `chat-tool-${toolCall.name}`;
  if (!toolResult) {
    // Pending — show a placeholder instead of rendering an unfinished tuple.
    return (
      <Box aria-label={`${ariaLabel}-pending`} borderRadius="md" borderWidth="1px" borderColor="accent.secondary/50" p={2}>
        <Text fontSize="xs" color="fg.muted">{toolCall.name} (running…)</Text>
        <Text fontSize="xs" fontFamily="mono">{JSON.stringify(toolCall.arguments)}</Text>
      </Box>
    );
  }
  const tc: ToolCall = {
    id: toolCall.id,
    type: 'function',
    function: { name: toolCall.name, arguments: toolCall.arguments as Record<string, unknown> },
  };
  const tuple: CompletedToolCall = [tc, toolResult];
  return (
    <Box aria-label={ariaLabel}>
      <Display toolCallTuple={tuple} showThinking={false} readOnly={true} />
    </Box>
  );
}

function pickText(content: ToolResultMessage['content']): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? '');
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}
