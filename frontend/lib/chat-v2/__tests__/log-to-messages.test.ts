import { describe, it, expect } from 'vitest';
import type {
  ConversationLogEntry,
  ConversationLog,
  AgentInvocation,
} from '@/orchestrator/types';
import type {
  AssistantMessage,
  ToolResultMessage,
  ToolCall as PiToolCall,
  TextContent,
  ThinkingContent,
} from '@mariozechner/pi-ai';
import {
  chatV2LogToMessages,
  type ChatV2RenderMessage,
} from '../log-to-messages';
import type { CompletedToolCall, UserMessage } from '@/store/chatSlice';

// ─── helpers ────────────────────────────────────────────────────────

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function rootInvocation(opts: {
  id: string;
  userMessage: string;
  agentName?: string;
}): ConversationLogEntry {
  return {
    type: 'toolCall',
    id: opts.id,
    name: opts.agentName ?? 'WebAnalystAgent',
    arguments: { userMessage: opts.userMessage },
    context: {},
    parent_id: null,
  } as AgentInvocation & { parent_id: null };
}

function subAgentInvocation(opts: {
  id: string;
  agentName: string;
  args: Record<string, unknown>;
  parentAgentId: string;
}): ConversationLogEntry {
  return {
    type: 'toolCall',
    id: opts.id,
    name: opts.agentName,
    arguments: opts.args,
    context: {},
    parent_id: opts.parentAgentId,
  } as AgentInvocation & { parent_id: string };
}

function assistantMessage(opts: {
  parentAgentId: string;
  text?: string;
  thinking?: string;
  toolCalls?: PiToolCall[];
  usage?: AssistantMessage['usage'];
  stopReason?: AssistantMessage['stopReason'];
  model?: string;
  timestamp?: number;
}): ConversationLogEntry {
  const blocks: (TextContent | ThinkingContent | PiToolCall)[] = [];
  if (opts.thinking) blocks.push({ type: 'thinking', thinking: opts.thinking });
  if (opts.text) blocks.push({ type: 'text', text: opts.text });
  if (opts.toolCalls) blocks.push(...opts.toolCalls);
  const msg: AssistantMessage & { parent_id: string } = {
    role: 'assistant',
    content: blocks,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: opts.model ?? 'claude-test',
    usage: opts.usage ?? EMPTY_USAGE,
    stopReason: opts.stopReason ?? 'stop',
    timestamp: opts.timestamp ?? 1000,
    parent_id: opts.parentAgentId,
  };
  return msg;
}

function toolResult(opts: {
  parentAgentId: string;
  toolCallId: string;
  toolName: string;
  text?: string;
  details?: Record<string, unknown>;
  isError?: boolean;
  timestamp?: number;
}): ConversationLogEntry {
  const trm: ToolResultMessage & { parent_id: string } = {
    role: 'toolResult',
    toolCallId: opts.toolCallId,
    toolName: opts.toolName,
    content: opts.text ? [{ type: 'text', text: opts.text }] : [],
    isError: opts.isError ?? false,
    timestamp: opts.timestamp ?? 2000,
    parent_id: opts.parentAgentId,
    ...(opts.details !== undefined ? { details: opts.details } : {}),
  };
  return trm;
}

function findUser(messages: ChatV2RenderMessage[]): UserMessage[] {
  return messages.filter((m): m is UserMessage => m.role === 'user');
}

function findTools(messages: ChatV2RenderMessage[]): CompletedToolCall[] {
  return messages.filter((m): m is CompletedToolCall => m.role === 'tool');
}

// ─── tests ──────────────────────────────────────────────────────────

describe('chatV2LogToMessages', () => {
  it('empty log → empty array', () => {
    expect(chatV2LogToMessages([])).toEqual([]);
  });

  it('root invocation only → one user message, no tool entries', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'hi there' }),
    ];
    const out = chatV2LogToMessages(log);
    expect(findUser(out)).toHaveLength(1);
    expect(findTools(out)).toHaveLength(0);

    const u = findUser(out)[0];
    expect(u.role).toBe('user');
    expect(u.content).toBe('hi there');
    expect(u.logIndex).toBe(0);
    expect(typeof u.created_at).toBe('string');
  });

  it('root → assistant text-only → emits user + a TalkToUser tool entry with content + usage in details', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'hello' }),
      assistantMessage({
        parentAgentId: 'root1',
        text: 'Hi! How can I help?',
        usage: { ...EMPTY_USAGE, totalTokens: 42 },
        stopReason: 'stop',
      }),
    ];
    const out = chatV2LogToMessages(log);
    expect(findUser(out)).toHaveLength(1);
    const tools = findTools(out);
    expect(tools).toHaveLength(1);

    const t = tools[0];
    expect(t.role).toBe('tool');
    expect(t.function.name).toBe('TalkToUser');
    expect(t.content).toBe('Hi! How can I help?');
    expect(t.details).toBeDefined();
    expect((t.details as Record<string, unknown>).type).toBe('assistant_text');
    const usage = (t.details as { usage?: { totalTokens?: number } }).usage;
    expect(usage?.totalTokens).toBe(42);
    expect((t.details as Record<string, unknown>).stopReason).toBe('stop');
    expect((t.details as Record<string, unknown>).model).toBe('claude-test');
  });

  it('assistant tool_calls only (no text) → pending CompletedToolCalls per block', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'do thing' }),
      assistantMessage({
        parentAgentId: 'root1',
        toolCalls: [
          { type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: { path: '/foo' } },
          { type: 'toolCall', id: 'tc2', name: 'ExecuteSQL', arguments: { sql: 'select 1' } },
        ],
        stopReason: 'toolUse',
      }),
    ];
    const out = chatV2LogToMessages(log);
    const tools = findTools(out);
    expect(tools).toHaveLength(2);
    expect(tools[0].tool_call_id).toBe('tc1');
    expect(tools[0].function.name).toBe('EditFile');
    expect(JSON.parse(tools[0].function.arguments)).toEqual({ path: '/foo' });
    expect(tools[0].content).toBe(''); // pending
    expect(tools[0].details).toBeUndefined();
    expect(tools[1].tool_call_id).toBe('tc2');
    expect(tools[1].function.name).toBe('ExecuteSQL');
  });

  it('assistant text + tool_calls → TalkToUser entry FIRST, then per-tool entries (preserves order)', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'foo' }),
      assistantMessage({
        parentAgentId: 'root1',
        text: 'Editing the file now',
        toolCalls: [
          { type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: { path: '/x' } },
        ],
        stopReason: 'toolUse',
      }),
    ];
    const out = chatV2LogToMessages(log);
    const tools = findTools(out);
    expect(tools).toHaveLength(2);
    expect(tools[0].function.name).toBe('TalkToUser');
    expect(tools[0].content).toBe('Editing the file now');
    expect(tools[1].function.name).toBe('EditFile');
    expect(tools[1].tool_call_id).toBe('tc1');
  });

  it('toolResult fills the matching pending tool entry: content + details + isError-mapped', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'go' }),
      assistantMessage({
        parentAgentId: 'root1',
        toolCalls: [{ type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: { path: '/x' } }],
        stopReason: 'toolUse',
      }),
      toolResult({
        parentAgentId: 'root1',
        toolCallId: 'tc1',
        toolName: 'EditFile',
        text: 'edited 3 lines',
        details: { success: true, diff: '+a\n-b' },
        isError: false,
      }),
    ];
    const out = chatV2LogToMessages(log);
    const tools = findTools(out);
    expect(tools).toHaveLength(1);
    expect(tools[0].tool_call_id).toBe('tc1');
    expect(tools[0].content).toBe('edited 3 lines');
    expect(tools[0].details).toMatchObject({ success: true, diff: '+a\n-b' });
  });

  it('toolResult with isError → details.success === false', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'go' }),
      assistantMessage({
        parentAgentId: 'root1',
        toolCalls: [{ type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: {} }],
        stopReason: 'toolUse',
      }),
      toolResult({
        parentAgentId: 'root1',
        toolCallId: 'tc1',
        toolName: 'EditFile',
        text: 'boom',
        isError: true,
      }),
    ];
    const out = chatV2LogToMessages(log);
    const t = findTools(out)[0];
    expect((t.details as { success?: boolean }).success).toBe(false);
  });

  it('sub-agent invocation (parent_id !== null) → pending CompletedToolCall with name=<SubAgent>', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'analyze' }),
      assistantMessage({
        parentAgentId: 'root1',
        toolCalls: [
          { type: 'toolCall', id: 'sa1', name: 'SubAnalystAgent', arguments: { goal: 'x' } },
        ],
        stopReason: 'toolUse',
      }),
      subAgentInvocation({
        id: 'sa1',
        agentName: 'SubAnalystAgent',
        args: { goal: 'x' },
        parentAgentId: 'root1',
      }),
    ];
    const out = chatV2LogToMessages(log);
    const tools = findTools(out);
    expect(tools).toHaveLength(1);
    expect(tools[0].tool_call_id).toBe('sa1');
    expect(tools[0].function.name).toBe('SubAnalystAgent');
  });

  it('toolResult for sub-agent with details.type === "mx_agent" passes through', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'analyze' }),
      assistantMessage({
        parentAgentId: 'root1',
        toolCalls: [{ type: 'toolCall', id: 'sa1', name: 'SubAnalystAgent', arguments: {} }],
        stopReason: 'toolUse',
      }),
      toolResult({
        parentAgentId: 'root1',
        toolCallId: 'sa1',
        toolName: 'SubAnalystAgent',
        text: 'sub agent reply',
        details: {
          type: 'mx_agent',
          assistantMessage: {
            role: 'assistant',
            content: [{ type: 'text', text: 'sub agent reply' }],
            usage: { ...EMPTY_USAGE, totalTokens: 10 },
            stopReason: 'stop',
            api: 'anthropic-messages',
            provider: 'anthropic',
            model: 'claude-test',
            timestamp: 5000,
          },
        },
      }),
    ];
    const out = chatV2LogToMessages(log);
    const t = findTools(out)[0];
    expect((t.details as { type?: string }).type).toBe('mx_agent');
    expect(
      (t.details as { assistantMessage?: { usage?: { totalTokens?: number } } })
        .assistantMessage?.usage?.totalTokens,
    ).toBe(10);
  });

  it('thinking blocks fold into the assistant-text tool entry as details.thinking', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'hmm' }),
      assistantMessage({
        parentAgentId: 'root1',
        thinking: 'pondering',
        text: 'final answer',
        stopReason: 'stop',
      }),
    ];
    const out = chatV2LogToMessages(log);
    const t = findTools(out)[0];
    expect(t.function.name).toBe('TalkToUser');
    expect((t.details as { thinking?: string }).thinking).toBe('pondering');
  });

  it('multiple turns: root1 → asst → root2 → asst → emits two users + two TalkToUser entries in order', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'first' }),
      assistantMessage({ parentAgentId: 'root1', text: 'reply one', stopReason: 'stop' }),
      rootInvocation({ id: 'root2', userMessage: 'second' }),
      assistantMessage({ parentAgentId: 'root2', text: 'reply two', stopReason: 'stop' }),
    ];
    const out = chatV2LogToMessages(log);
    expect(out).toHaveLength(4);
    expect(out[0].role).toBe('user');
    expect((out[0] as UserMessage).content).toBe('first');
    expect(out[1].role).toBe('tool');
    expect((out[1] as CompletedToolCall).content).toBe('reply one');
    expect(out[2].role).toBe('user');
    expect((out[2] as UserMessage).content).toBe('second');
    expect(out[3].role).toBe('tool');
    expect((out[3] as CompletedToolCall).content).toBe('reply two');
  });

  it('user message logIndex matches the entry position in the input log', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'a' }),
      assistantMessage({ parentAgentId: 'root1', text: 'r1', stopReason: 'stop' }),
      rootInvocation({ id: 'root2', userMessage: 'b' }),
    ];
    const out = chatV2LogToMessages(log);
    const users = findUser(out);
    expect(users).toHaveLength(2);
    expect(users[0].logIndex).toBe(0);
    expect(users[1].logIndex).toBe(2);
  });

  it('user message attachments pass through from arguments', () => {
    const root: ConversationLogEntry = {
      type: 'toolCall',
      id: 'root1',
      name: 'WebAnalystAgent',
      arguments: {
        userMessage: 'see image',
        attachments: [
          { type: 'image', name: 'foo.png', content: 'data:image/png;base64,xxx' },
        ],
      },
      context: {},
      parent_id: null,
    } as AgentInvocation & { parent_id: null };
    const out = chatV2LogToMessages([root]);
    const u = findUser(out)[0];
    expect(u.attachments).toBeDefined();
    expect(u.attachments).toHaveLength(1);
    expect(u.attachments![0].name).toBe('foo.png');
  });

  it('tool call arguments stored as a JSON string (matches chatSlice CompletedToolCall shape)', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'q' }),
      assistantMessage({
        parentAgentId: 'root1',
        toolCalls: [
          { type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: { path: '/x', diff: 'y' } },
        ],
        stopReason: 'toolUse',
      }),
    ];
    const out = chatV2LogToMessages(log);
    const t = findTools(out)[0];
    expect(typeof t.function.arguments).toBe('string');
    expect(JSON.parse(t.function.arguments)).toEqual({ path: '/x', diff: 'y' });
  });

  it('orphan toolResult (no matching pending entry) is dropped silently', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'root1', userMessage: 'x' }),
      toolResult({
        parentAgentId: 'root1',
        toolCallId: 'orphan',
        toolName: 'SomeTool',
        text: 'nope',
      }),
    ];
    const out = chatV2LogToMessages(log);
    expect(findTools(out)).toHaveLength(0);
  });
});
