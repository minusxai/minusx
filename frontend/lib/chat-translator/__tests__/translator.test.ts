// Translator TDD spec — RED before any implementation exists.
//
// One module, three exports:
//   piLogToLegacy     pi-ai ConversationLog        → ConversationLogEntry[]   (forward; file reads + done frame)
//   piStreamEventToLegacy  StreamEvent             → legacy SSE payload | null (per-event mid-stream)
//   legacyToolResultToPi   CompletedToolCallFromPython → ToolResultMessage     (reverse; orchestrator resume)

import { describe, it, expect } from 'vitest';
import type {
  ConversationLog,
  ConversationLogEntry as PiLogEntry,
  AgentInvocation,
  StreamEvent,
} from '@/orchestrator/types';
import type {
  AssistantMessage,
  ToolResultMessage,
  ToolCall as PiToolCall,
  TextContent,
  ThinkingContent,
} from '@mariozechner/pi-ai';
import type {
  ConversationLogEntry as LegacyLogEntry,
  TaskLogEntry,
  TaskResultEntry,
  TaskDebugEntry,
} from '@/lib/types';
import type { CompletedToolCallFromPython } from '@/lib/chat-orchestration';
import {
  piLogToLegacy,
  piStreamEventToLegacy,
  legacyToolResultToPi,
} from '../index';

// ─── shared fixture helpers ─────────────────────────────────────────

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
  attachments?: unknown[];
  extraArgs?: Record<string, unknown>;
}): PiLogEntry {
  return {
    type: 'toolCall',
    id: opts.id,
    name: opts.agentName ?? 'WebAnalystAgent',
    arguments: {
      userMessage: opts.userMessage,
      ...(opts.attachments ? { attachments: opts.attachments } : {}),
      ...(opts.extraArgs ?? {}),
    },
    context: {},
    parent_id: null,
  } as AgentInvocation & { parent_id: null };
}

function subAgentInvocation(opts: {
  id: string;
  agentName: string;
  args: Record<string, unknown>;
  parentAgentId: string;
}): PiLogEntry {
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
}): PiLogEntry {
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
}): PiLogEntry {
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

function findTasks(out: LegacyLogEntry[]): TaskLogEntry[] {
  return out.filter((e): e is TaskLogEntry => e._type === 'task');
}
function findResults(out: LegacyLogEntry[]): TaskResultEntry[] {
  return out.filter((e): e is TaskResultEntry => e._type === 'task_result');
}
function findDebug(out: LegacyLogEntry[]): TaskDebugEntry[] {
  return out.filter((e): e is TaskDebugEntry => e._type === 'task_debug');
}
function taskById(out: LegacyLogEntry[], id: string): TaskLogEntry | undefined {
  return findTasks(out).find((t) => t.unique_id === id);
}
function resultByTaskId(out: LegacyLogEntry[], taskId: string): TaskResultEntry | undefined {
  return findResults(out).find((r) => r._task_unique_id === taskId);
}

// ─── piLogToLegacy: forward ─────────────────────────────────────────

describe('piLogToLegacy — forward translation', () => {
  it('empty log → empty array', () => {
    expect(piLogToLegacy([])).toEqual([]);
  });

  it('root invocation only → one task with agent=AnalystAgent and args.user_message', () => {
    const out = piLogToLegacy([
      rootInvocation({ id: 'r1', userMessage: 'hi there' }),
    ]);
    const tasks = findTasks(out);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].agent).toBe('AnalystAgent');
    expect(tasks[0].args.user_message).toBe('hi there');
    expect(tasks[0].unique_id).toBe('r1');
    expect(typeof tasks[0]._run_id).toBe('string');
    expect(typeof tasks[0].created_at).toBe('string');
  });

  it('user task carries arguments.attachments through to args.attachments', () => {
    const attachments = [{ type: 'image', name: 'foo.png', content: 'data:...' }];
    const out = piLogToLegacy([
      rootInvocation({ id: 'r1', userMessage: 'see this', attachments }),
    ]);
    const t = taskById(out, 'r1')!;
    expect(t.args.attachments).toEqual(attachments);
  });

  it('root + assistant text-only → user task + synthetic TalkToUser task + matching task_result', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hi' }),
      assistantMessage({
        parentAgentId: 'r1',
        text: 'Hi! How can I help?',
        usage: { ...EMPTY_USAGE, totalTokens: 42, input: 30, output: 12 },
        stopReason: 'stop',
      }),
    ];
    const out = piLogToLegacy(log);
    const tasks = findTasks(out);
    expect(tasks).toHaveLength(2);
    const userTask = taskById(out, 'r1')!;
    expect(userTask.agent).toBe('AnalystAgent');
    const ttu = tasks.find((t) => t.agent === 'TalkToUser')!;
    expect(ttu).toBeDefined();
    expect(ttu._parent_unique_id).toBe('r1');
    const result = resultByTaskId(out, ttu.unique_id)!;
    expect(result).toBeDefined();
    // v=1-compatible: result is a JSON string with content_blocks (not raw text).
    const parsed = JSON.parse(String(result.result));
    expect(parsed.content_blocks).toEqual([{ type: 'text', text: 'Hi! How can I help?' }]);
  });

  it('assistant text-only → usage flows to task_debug (NOT task_result.details, which v=1 keeps null)', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hi' }),
      assistantMessage({
        parentAgentId: 'r1',
        text: 'Hi',
        usage: { ...EMPTY_USAGE, totalTokens: 42 },
        stopReason: 'stop',
        model: 'claude-test-model',
      }),
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    // task_result.details is null (matches v=1 — no usage on result).
    const result = resultByTaskId(out, ttu.unique_id)!;
    expect(result.details).toBeNull();
    // task_debug carries the usage on the same task_unique_id.
    const debugs = findDebug(out).filter((d) => d._task_unique_id === ttu.unique_id);
    expect(debugs).toHaveLength(1);
    expect(debugs[0].llmDebug[0].total_tokens).toBe(42);
    expect(debugs[0].llmDebug[0].model).toBe('claude-test-model');
  });

  it('assistant with tool_calls only → per-block task entries, NO task_result yet (pending)', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'do thing' }),
      assistantMessage({
        parentAgentId: 'r1',
        toolCalls: [
          { type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: { path: '/foo' } },
          { type: 'toolCall', id: 'tc2', name: 'ExecuteSQL', arguments: { sql: 'select 1' } },
        ],
        stopReason: 'toolUse',
      }),
    ];
    const out = piLogToLegacy(log);
    expect(taskById(out, 'tc1')).toBeDefined();
    expect(taskById(out, 'tc1')!.agent).toBe('EditFile');
    expect(taskById(out, 'tc1')!.args).toEqual({ path: '/foo' });
    expect(taskById(out, 'tc1')!._parent_unique_id).toBe('r1');
    expect(taskById(out, 'tc2')).toBeDefined();
    // No task_result for either tc1 or tc2 yet (pending).
    expect(resultByTaskId(out, 'tc1')).toBeUndefined();
    expect(resultByTaskId(out, 'tc2')).toBeUndefined();
  });

  it('v2-native server tool names are renamed + reshaped to v1 contract for the UI', () => {
    // The frontend UI speaks the legacy v1 task-log contract (ExecuteQuery
    // with {query, connectionId}). v2 orchestrator emits ExecuteSQL with
    // {sql, connection}. The translator bridges the two so production v2
    // chat and benchmarks both feed the UI the shape it expects.
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'q' }),
      assistantMessage({
        parentAgentId: 'r1',
        toolCalls: [
          {
            type: 'toolCall',
            id: 'tcSQL',
            name: 'ExecuteSQL',
            arguments: { sql: 'select 1', connection: 'default_duckdb' },
          },
          { type: 'toolCall', id: 'tcList', name: 'ListDBConnections', arguments: {} },
        ],
        stopReason: 'toolUse',
      }),
    ];
    const out = piLogToLegacy(log);
    const sqlTask = taskById(out, 'tcSQL')!;
    expect(sqlTask.agent).toBe('ExecuteQuery');
    expect(sqlTask.args).toEqual({ query: 'select 1', connectionId: 'default_duckdb' });
    const listTask = taskById(out, 'tcList')!;
    expect(listTask.agent).toBe('ReadFiles');
  });

  it('assistant with text + tool_calls → TalkToUser task FIRST, then per-tool tasks (preserves order)', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'foo' }),
      assistantMessage({
        parentAgentId: 'r1',
        text: 'Editing now',
        toolCalls: [
          { type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: { path: '/x' } },
        ],
        stopReason: 'toolUse',
      }),
    ];
    const out = piLogToLegacy(log);
    const tasks = findTasks(out);
    // [user task, TalkToUser task, EditFile task]
    expect(tasks.map((t) => t.agent)).toEqual(['AnalystAgent', 'TalkToUser', 'EditFile']);
  });

  it('ToolResultMessage fills its task by _task_unique_id === toolCallId', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'go' }),
      assistantMessage({
        parentAgentId: 'r1',
        toolCalls: [{ type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: { path: '/x' } }],
        stopReason: 'toolUse',
      }),
      toolResult({
        parentAgentId: 'r1',
        toolCallId: 'tc1',
        toolName: 'EditFile',
        text: 'edited 3 lines',
        details: { success: true, diff: '+a\n-b' },
        isError: false,
      }),
    ];
    const out = piLogToLegacy(log);
    const result = resultByTaskId(out, 'tc1')!;
    expect(result).toBeDefined();
    expect(result.result).toBe('edited 3 lines');
    expect(result.details).toMatchObject({ success: true, diff: '+a\n-b' });
  });

  it('ToolResultMessage with isError: true → task_result.details.success === false', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'go' }),
      assistantMessage({
        parentAgentId: 'r1',
        toolCalls: [{ type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: {} }],
        stopReason: 'toolUse',
      }),
      toolResult({
        parentAgentId: 'r1',
        toolCallId: 'tc1',
        toolName: 'EditFile',
        text: 'boom',
        isError: true,
      }),
    ];
    const out = piLogToLegacy(log);
    const result = resultByTaskId(out, 'tc1')!;
    expect((result.details as { success?: boolean }).success).toBe(false);
  });

  it('sub-agent invocation (parent_id !== null) → task with _parent_unique_id', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'analyze' }),
      assistantMessage({
        parentAgentId: 'r1',
        toolCalls: [{ type: 'toolCall', id: 'sa1', name: 'SubAnalystAgent', arguments: { goal: 'x' } }],
        stopReason: 'toolUse',
      }),
      subAgentInvocation({
        id: 'sa1',
        agentName: 'SubAnalystAgent',
        args: { goal: 'x' },
        parentAgentId: 'r1',
      }),
    ];
    const out = piLogToLegacy(log);
    const subTask = taskById(out, 'sa1')!;
    expect(subTask).toBeDefined();
    expect(subTask.agent).toBe('SubAnalystAgent');
    expect(subTask._parent_unique_id).toBe('r1');
    expect(subTask.args).toEqual({ goal: 'x' });
  });

  it('sub-agent ToolResultMessage with details.type === "mx_agent" passes through to task_result', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'analyze' }),
      assistantMessage({
        parentAgentId: 'r1',
        toolCalls: [{ type: 'toolCall', id: 'sa1', name: 'SubAnalystAgent', arguments: {} }],
        stopReason: 'toolUse',
      }),
      toolResult({
        parentAgentId: 'r1',
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
    const out = piLogToLegacy(log);
    const result = resultByTaskId(out, 'sa1')!;
    expect((result.details as { type?: string }).type).toBe('mx_agent');
    expect((result.details as { assistantMessage?: { usage?: { totalTokens?: number } } }).assistantMessage?.usage?.totalTokens).toBe(10);
  });

  it('thinking + text → task_result.result content_blocks contains BOTH (thinking first, text second) — v=1 compat', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hmm' }),
      assistantMessage({
        parentAgentId: 'r1',
        thinking: 'pondering',
        text: 'final answer',
        stopReason: 'stop',
      }),
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    const result = resultByTaskId(out, ttu.unique_id)!;
    const parsed = JSON.parse(String(result.result));
    expect(parsed.content_blocks).toEqual([
      { type: 'thinking', thinking: 'pondering' },
      { type: 'text', text: 'final answer' },
    ]);
    // result.details is null per v=1 convention — frontend's ContentDisplay
    // walks `content_blocks` for thinking/text, not `details.thinking`.
    expect(result.details).toBeNull();
  });

  it('AssistantMessage usage emits a task_debug entry with llmDebug populated', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hi' }),
      assistantMessage({
        parentAgentId: 'r1',
        text: 'Hi',
        usage: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 150,
          cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
        },
        stopReason: 'stop',
        model: 'claude-test',
      }),
    ];
    const out = piLogToLegacy(log);
    const debugs = findDebug(out);
    expect(debugs).toHaveLength(1);
    expect(debugs[0].llmDebug).toHaveLength(1);
    expect(debugs[0].llmDebug[0]).toMatchObject({
      total_tokens: 150,
      prompt_tokens: 100,
      completion_tokens: 50,
      model: 'claude-test',
    });
    // task_debug.task_unique_id points to the TalkToUser task (primary task of the turn).
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    expect(debugs[0]._task_unique_id).toBe(ttu.unique_id);
  });

  it('multi-turn ordering preserved (root1 → asst → root2 → asst)', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'first' }),
      assistantMessage({ parentAgentId: 'r1', text: 'reply one', stopReason: 'stop' }),
      rootInvocation({ id: 'r2', userMessage: 'second' }),
      assistantMessage({ parentAgentId: 'r2', text: 'reply two', stopReason: 'stop' }),
    ];
    const out = piLogToLegacy(log);
    const tasks = findTasks(out);
    // [user1, ttu1, user2, ttu2]
    expect(tasks).toHaveLength(4);
    expect(tasks[0].args.user_message).toBe('first');
    expect(tasks[1].agent).toBe('TalkToUser');
    expect(tasks[2].args.user_message).toBe('second');
    expect(tasks[3].agent).toBe('TalkToUser');
  });

  it('orphan ToolResultMessage (no matching task) is silently dropped', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'x' }),
      toolResult({
        parentAgentId: 'r1',
        toolCallId: 'orphan',
        toolName: 'SomeTool',
        text: 'nope',
      }),
    ];
    const out = piLogToLegacy(log);
    expect(resultByTaskId(out, 'orphan')).toBeUndefined();
  });
});

// ─── piStreamEventToLegacy: streaming ────────────────────────────────

describe('piStreamEventToLegacy — per-event SSE translation', () => {
  const CONVERSATION_ID = 555;

  function partial(parent_id: string): AssistantMessage {
    return {
      role: 'assistant',
      content: [],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-test',
      usage: EMPTY_USAGE,
      stopReason: 'stop',
      timestamp: 0,
    };
    void parent_id;
  }

  it('text_delta → StreamedContent { chunk: delta }', () => {
    const ev: StreamEvent = {
      type: 'text_delta',
      contentIndex: 0,
      delta: 'Hello',
      partial: partial('p'),
      parent_id: 'p',
    } as StreamEvent;
    const out = piStreamEventToLegacy(ev, CONVERSATION_ID);
    expect(out).toEqual({
      type: 'StreamedContent',
      payload: { chunk: 'Hello' },
      conversationID: CONVERSATION_ID,
    });
  });

  it('thinking_delta → StreamedThinking { chunk: delta }', () => {
    const ev: StreamEvent = {
      type: 'thinking_delta',
      contentIndex: 0,
      delta: 'pondering',
      partial: partial('p'),
      parent_id: 'p',
    } as StreamEvent;
    const out = piStreamEventToLegacy(ev, CONVERSATION_ID);
    expect(out).toEqual({
      type: 'StreamedThinking',
      payload: { chunk: 'pondering' },
      conversationID: CONVERSATION_ID,
    });
  });

  it('toolcall_end → ToolCreated with legacy ToolCall shape', () => {
    const ev: StreamEvent = {
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: {
        type: 'toolCall',
        id: 'tc1',
        name: 'EditFile',
        arguments: { path: '/x', diff: 'y' },
      },
      partial: partial('p'),
      parent_id: 'p',
    } as StreamEvent;
    const out = piStreamEventToLegacy(ev, CONVERSATION_ID);
    expect(out).toEqual({
      type: 'ToolCreated',
      payload: {
        id: 'tc1',
        type: 'function',
        function: {
          name: 'EditFile',
          arguments: { path: '/x', diff: 'y' },
        },
      },
      conversationID: CONVERSATION_ID,
    });
  });

  it.each([
    'start',
    'text_start',
    'text_end',
    'thinking_start',
    'thinking_end',
    'toolcall_start',
    'toolcall_delta',
    'done',
    'error',
  ])('%s event → null (no legacy counterpart, caller skips)', (eventType) => {
    const ev = {
      type: eventType,
      contentIndex: 0,
      partial: partial('p'),
      parent_id: 'p',
      // toolcall_delta needs a delta; fill it harmlessly
      delta: '',
      // toolcall_end needs toolCall; fill it harmlessly
      toolCall: { type: 'toolCall', id: 'x', name: 'y', arguments: {} },
      content: '',
      reason: 'stop',
      message: partial('p'),
      error: partial('p'),
    } as unknown as StreamEvent;
    const out = piStreamEventToLegacy(ev, CONVERSATION_ID);
    // Filter the tested type back from the it.each so toolcall_end (which IS translated) doesn't conflict here.
    if (eventType === 'toolcall_end') return;
    expect(out).toBeNull();
  });

  it('PendingToolEvent → null (deferred to final done frame)', () => {
    const ev: StreamEvent = {
      type: 'pending',
      id: 'tc1',
      name: 'EditFile',
      parameters: { path: '/x' },
      context: {},
      parent_id: 'p',
    } as StreamEvent;
    const out = piStreamEventToLegacy(ev, CONVERSATION_ID);
    expect(out).toBeNull();
  });
});

// ─── legacyToolResultToPi: reverse for resume ────────────────────────

describe('legacyToolResultToPi — reverse mapping for orchestrator resume', () => {
  it('basic: tool_call_id → toolCallId, string content → [{type:text,text}]', () => {
    const legacy: CompletedToolCallFromPython = {
      role: 'tool',
      tool_call_id: 'tc1',
      content: 'edit applied',
      run_id: 'run-1',
      function: { name: 'EditFile', arguments: { path: '/x' } },
      created_at: '2025-01-01T00:00:00Z',
    };
    const out = legacyToolResultToPi(legacy);
    expect(out.role).toBe('toolResult');
    expect(out.toolCallId).toBe('tc1');
    expect(out.toolName).toBe('EditFile');
    expect(out.content).toEqual([{ type: 'text', text: 'edit applied' }]);
    expect(out.isError).toBe(false);
  });

  it('object content → JSON-stringified text content', () => {
    const legacy: CompletedToolCallFromPython = {
      role: 'tool',
      tool_call_id: 'tc1',
      content: { rows: [{ id: 1 }], columns: ['id'] },
      run_id: 'run-1',
      function: { name: 'ExecuteSQL', arguments: {} },
      created_at: '2025-01-01T00:00:00Z',
    };
    const out = legacyToolResultToPi(legacy);
    expect(out.content).toHaveLength(1);
    expect(out.content[0]).toMatchObject({ type: 'text' });
    expect((out.content[0] as TextContent).text).toBe(
      JSON.stringify({ rows: [{ id: 1 }], columns: ['id'] }),
    );
  });

  it('details preserved as details', () => {
    const details = { success: true, diff: '+a' };
    const legacy: CompletedToolCallFromPython = {
      role: 'tool',
      tool_call_id: 'tc1',
      content: 'ok',
      run_id: 'run-1',
      function: { name: 'EditFile', arguments: {} },
      created_at: '2025-01-01T00:00:00Z',
      details,
    };
    const out = legacyToolResultToPi(legacy);
    expect(out.details).toEqual(details);
  });

  it('details.success === false → isError: true', () => {
    const legacy: CompletedToolCallFromPython = {
      role: 'tool',
      tool_call_id: 'tc1',
      content: 'boom',
      run_id: 'run-1',
      function: { name: 'EditFile', arguments: {} },
      created_at: '2025-01-01T00:00:00Z',
      details: { success: false, error: 'something went wrong' },
    };
    const out = legacyToolResultToPi(legacy);
    expect(out.isError).toBe(true);
  });

  it('function.name → toolName', () => {
    const legacy: CompletedToolCallFromPython = {
      role: 'tool',
      tool_call_id: 'tc1',
      content: 'ok',
      run_id: 'run-1',
      function: { name: 'WeirdName', arguments: {} },
      created_at: '2025-01-01T00:00:00Z',
    };
    const out = legacyToolResultToPi(legacy);
    expect(out.toolName).toBe('WeirdName');
  });
});

// ─── piLogToLegacy: format compatibility with v=1 task-log ──────────
//
// These tests assert the EXACT shape v=1 conversation logs use, so the
// frontend's `parseLogToMessages` + `ContentDisplay` + `addStreamingMessage`
// reducers see the same data shape from v=2 conversations.
//
// Key v=1 conventions (derived from real /api/files/<id> responses on a
// v=1 conversation):
//
//   • Assistant text/thinking turns are emitted as `task` entries with
//     `agent: 'TalkToUser'` and `args.content_blocks: [...]` — NOT a flat
//     `args.content` string.
//   • The matching `task_result.result` is a JSON-stringified `{ success,
//     content_blocks: [...] }` object — frontend's `ContentDisplay` JSON
//     parses this and walks `content_blocks` for `type:'text'` and
//     `type:'thinking'` entries.
//   • `task_result.details` for assistant text/thinking turns is `null` —
//     usage/stopReason live on the matching `task_debug` entry.
//   • Each `content_blocks` entry preserves its `signature` field when
//     present (used for opaque thinking continuations).

describe('piLogToLegacy — v=1 format compatibility', () => {
  it('assistant text-only → TalkToUser task with args.content_blocks=[{type:text,text}]', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hi' }),
      assistantMessage({
        parentAgentId: 'r1',
        text: 'Hi! How can I help?',
        stopReason: 'stop',
      }),
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    expect(ttu).toBeDefined();
    expect(ttu.args).toEqual({
      content_blocks: [{ type: 'text', text: 'Hi! How can I help?' }],
    });
  });

  it('assistant thinking-only → TalkToUser task with args.content_blocks=[{type:thinking,thinking}]', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hi' }),
      assistantMessage({
        parentAgentId: 'r1',
        thinking: 'pondering deeply',
        // no text — the agent emits ONLY a thinking message before tool calls
        stopReason: 'toolUse',
      }),
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    expect(ttu).toBeDefined();
    expect(ttu.args).toMatchObject({
      content_blocks: [{ type: 'thinking', thinking: 'pondering deeply' }],
    });
  });

  it('assistant thinking + text → ONE TalkToUser task with both blocks (thinking first)', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hmm' }),
      assistantMessage({
        parentAgentId: 'r1',
        thinking: 'let me think',
        text: 'Done.',
        stopReason: 'stop',
      }),
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    expect(ttu).toBeDefined();
    expect(ttu.args).toMatchObject({
      content_blocks: [
        { type: 'thinking', thinking: 'let me think' },
        { type: 'text', text: 'Done.' },
      ],
    });
  });

  it('assistant text → task_result.result is JSON-stringified {success, content_blocks}', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hi' }),
      assistantMessage({
        parentAgentId: 'r1',
        text: 'Hi there.',
        stopReason: 'stop',
      }),
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    const result = resultByTaskId(out, ttu.unique_id)!;
    expect(typeof result.result).toBe('string');
    const parsed = JSON.parse(String(result.result));
    expect(parsed).toMatchObject({
      success: true,
      content_blocks: [{ type: 'text', text: 'Hi there.' }],
    });
  });

  it('assistant thinking → task_result.result is JSON-stringified with thinking content_block', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hi' }),
      assistantMessage({
        parentAgentId: 'r1',
        thinking: 'pondering',
        stopReason: 'toolUse',
      }),
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    const result = resultByTaskId(out, ttu.unique_id)!;
    const parsed = JSON.parse(String(result.result));
    expect(parsed).toMatchObject({
      success: true,
      content_blocks: [{ type: 'thinking', thinking: 'pondering' }],
    });
  });

  it('TalkToUser task_result.details is null (matching v=1; usage lives on task_debug)', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hi' }),
      assistantMessage({
        parentAgentId: 'r1',
        text: 'Hi.',
        stopReason: 'stop',
        usage: { ...EMPTY_USAGE, totalTokens: 42, input: 30, output: 12 },
      }),
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    const result = resultByTaskId(out, ttu.unique_id)!;
    expect(result.details).toBeNull();
    // task_debug for the same task carries the usage.
    const debugs = findDebug(out).filter((d) => d._task_unique_id === ttu.unique_id);
    expect(debugs).toHaveLength(1);
    expect(debugs[0].llmDebug[0].total_tokens).toBe(42);
  });

  it('thinking content preserves signature when pi-ai provides one', () => {
    const sig = 'opaque-signature-blob';
    const partial: AssistantMessage & { parent_id: string } = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'hmm', thinkingSignature: sig }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-test',
      usage: EMPTY_USAGE,
      stopReason: 'toolUse',
      timestamp: 1000,
      parent_id: 'r1',
    };
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'hi' }),
      partial,
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    const blocks = (ttu.args as { content_blocks: Array<Record<string, unknown>> }).content_blocks;
    expect(blocks[0]).toMatchObject({ type: 'thinking', thinking: 'hmm', signature: sig });
  });

  it('multi-block ordering matches pi-ai content order (thinking, text, toolCall)', () => {
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'do thing' }),
      assistantMessage({
        parentAgentId: 'r1',
        thinking: 'plan',
        text: 'Editing now',
        toolCalls: [
          { type: 'toolCall', id: 'tc1', name: 'EditFile', arguments: { path: '/x' } },
        ],
        stopReason: 'toolUse',
      }),
    ];
    const out = piLogToLegacy(log);
    const tasks = findTasks(out);
    // Order: user → TalkToUser (thinking + text) → EditFile
    expect(tasks.map((t) => t.agent)).toEqual(['AnalystAgent', 'TalkToUser', 'EditFile']);
    const ttu = tasks[1];
    const blocks = (ttu.args as { content_blocks: Array<{ type: string }> }).content_blocks;
    // thinking block first (pi-ai content order), then text — toolCall is its
    // own task entry, not part of content_blocks.
    expect(blocks.map((b) => b.type)).toEqual(['thinking', 'text']);
  });
});

// ─── piStreamEventToLegacy: streaming wire-format ──────────────────
//
// The frontend's `addStreamingMessage` reducer consumes each frame and
// updates Redux state mid-turn. These tests pin the exact shape it expects:
//
//   • text_delta → StreamedContent — accreted into a synthetic TalkToUser
//     CompletedToolCall in `streamedCompletedToolCalls`.
//   • thinking_delta → StreamedThinking — accumulated into
//     `conv.streamedThinking` (string), surfaced in StreamingInfoBlock.
//   • toolcall_end → ToolCreated — currently ignored by the reducer but
//     wire-format must still match the legacy ToolCall shape.
//   • Pure-text events (text_start/end, thinking_start/end, etc.) → null.
//
// Format mismatches between v=1 and v=2 here would manifest as thinking
// rendering inline in the answer instead of in the "Show Thinking" panel,
// or tool calls not appearing in the streaming progress badge — exactly
// the rendering issues the user observed.

describe('piStreamEventToLegacy — wire format and frontend compatibility', () => {
  const CID = 555;

  function partial(): AssistantMessage {
    return {
      role: 'assistant',
      content: [],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-test',
      usage: EMPTY_USAGE,
      stopReason: 'stop',
      timestamp: 0,
    };
  }

  it('thinking delta → StreamedThinking; text delta → StreamedContent (separated, NOT merged)', () => {
    // Most important property: thinking and text deltas use DIFFERENT legacy
    // event types, so the frontend's reducer routes thinking into
    // streamedThinking (Show-Thinking panel) and text into the answer body.
    const tdelta: StreamEvent = {
      type: 'text_delta',
      contentIndex: 1,
      delta: 'Hello',
      partial: partial(),
      parent_id: 'p',
    } as StreamEvent;
    const thdelta: StreamEvent = {
      type: 'thinking_delta',
      contentIndex: 0,
      delta: 'pondering',
      partial: partial(),
      parent_id: 'p',
    } as StreamEvent;

    const t = piStreamEventToLegacy(tdelta, CID);
    const th = piStreamEventToLegacy(thdelta, CID);
    expect(t?.type).toBe('StreamedContent');
    expect(th?.type).toBe('StreamedThinking');
    expect(t?.type).not.toBe(th?.type);
  });

  it('text_delta payload is exactly { chunk: delta } (no extra fields)', () => {
    const ev: StreamEvent = {
      type: 'text_delta',
      contentIndex: 0,
      delta: 'world',
      partial: partial(),
      parent_id: 'p',
    } as StreamEvent;
    const out = piStreamEventToLegacy(ev, CID);
    expect(out?.payload).toEqual({ chunk: 'world' });
  });

  it('thinking_delta payload is exactly { chunk: delta } (no extra fields)', () => {
    const ev: StreamEvent = {
      type: 'thinking_delta',
      contentIndex: 0,
      delta: 'still pondering',
      partial: partial(),
      parent_id: 'p',
    } as StreamEvent;
    const out = piStreamEventToLegacy(ev, CID);
    expect(out?.payload).toEqual({ chunk: 'still pondering' });
  });

  it('toolcall_end emits ToolCreated with legacy ToolCall shape (id, type:function, function:{name,arguments})', () => {
    const ev: StreamEvent = {
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: {
        type: 'toolCall',
        id: 'tc-stream-1',
        name: 'EditFile',
        arguments: { path: '/x', diff: 'y' },
      },
      partial: partial(),
      parent_id: 'p',
    } as StreamEvent;
    const out = piStreamEventToLegacy(ev, CID);
    expect(out?.type).toBe('ToolCreated');
    expect(out?.payload).toEqual({
      id: 'tc-stream-1',
      type: 'function',
      function: {
        name: 'EditFile',
        arguments: { path: '/x', diff: 'y' },
      },
    });
  });

  it('every legacy frame carries conversationID', () => {
    const ev: StreamEvent = {
      type: 'text_delta',
      contentIndex: 0,
      delta: 'x',
      partial: partial(),
      parent_id: 'p',
    } as StreamEvent;
    const out = piStreamEventToLegacy(ev, CID);
    expect(out?.conversationID).toBe(CID);
  });

  it('text_start/end + thinking_start/end + toolcall_start/delta → null (no legacy counterpart, caller skips)', () => {
    const types = ['text_start', 'text_end', 'thinking_start', 'thinking_end', 'toolcall_start', 'toolcall_delta'];
    for (const type of types) {
      const ev = {
        type,
        contentIndex: 0,
        partial: partial(),
        parent_id: 'p',
        delta: '',
      } as unknown as StreamEvent;
      expect(piStreamEventToLegacy(ev, CID)).toBeNull();
    }
  });

  it('stream of [thinking_delta, thinking_delta, text_delta, text_delta] produces 4 frames in order', () => {
    // Simulates a real turn where the model thinks first, then answers.
    const events: StreamEvent[] = [
      { type: 'thinking_delta', contentIndex: 0, delta: 'pon', partial: partial(), parent_id: 'p' } as StreamEvent,
      { type: 'thinking_delta', contentIndex: 0, delta: 'dering', partial: partial(), parent_id: 'p' } as StreamEvent,
      { type: 'text_delta', contentIndex: 1, delta: 'Done', partial: partial(), parent_id: 'p' } as StreamEvent,
      { type: 'text_delta', contentIndex: 1, delta: '!', partial: partial(), parent_id: 'p' } as StreamEvent,
    ];
    const frames = events
      .map((e) => piStreamEventToLegacy(e, CID))
      .filter((f): f is NonNullable<typeof f> => f !== null);
    expect(frames.map((f) => f.type)).toEqual([
      'StreamedThinking',
      'StreamedThinking',
      'StreamedContent',
      'StreamedContent',
    ]);
    expect(frames.map((f) => (f.payload as { chunk: string }).chunk)).toEqual([
      'pon',
      'dering',
      'Done',
      '!',
    ]);
  });
});
