// Translator TDD spec — RED before any implementation exists.
//
// One module, three exports:
//   piLogToLegacy     orchestrator ConversationLog        → ConversationLogEntry[]   (forward; file reads + done frame)
//   legacyToolResultToPi   CompletedToolCallResult → ToolResultMessage     (reverse; orchestrator resume)

import { describe, it, expect } from 'vitest';
import type {
  ConversationLog,
  ConversationLogEntry as PiLogEntry,
  AgentInvocation,
} from '@/orchestrator/types';
import type { AssistantMessage, ToolResultMessage, ToolCall as PiToolCall, TextContent, ThinkingContent, ImageContent } from '@/orchestrator/llm';
import type {
  ConversationLogEntry as LegacyLogEntry,
  TaskLogEntry,
  TaskResultEntry,
  TaskDebugEntry,
} from '@/lib/types';
import type { CompletedToolCallResult } from '@/lib/chat-orchestration';
import {
  piLogToLegacy,
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

  it('web search: text citations + web_search_tool_result → content_blocks + top-level citations (server_tool_use hidden)', () => {
    const citation = { type: 'web_search_result_location', url: 'https://ex.com', title: 'Ex', cited_text: 'fact' };
    const serverToolUse = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } };
    const wsr = { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://ex.com', title: 'Ex' }] };
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'q' }),
      {
        role: 'assistant',
        content: [serverToolUse, wsr, { type: 'text', text: 'Answer', citations: [citation] }],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-test',
        usage: EMPTY_USAGE,
        stopReason: 'stop',
        timestamp: 1000,
        parent_id: 'r1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ];
    const out = piLogToLegacy(log);
    const ttu = findTasks(out).find((t) => t.agent === 'TalkToUser')!;
    const parsed = JSON.parse(String(resultByTaskId(out, ttu.unique_id)!.result));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlock = parsed.content_blocks.find((b: any) => b.type === 'text');
    expect(textBlock.citations).toEqual([citation]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsrBlock = parsed.content_blocks.find((b: any) => b.type === 'web_search_tool_result');
    expect(wsrBlock.content[0].url).toBe('https://ex.com');
    // top-level citations aggregated (AgentTurnContainer enriches results with cited_text)
    expect(parsed.citations).toEqual([citation]);
    // server_tool_use is internal (API continuity only) — never shown in the UI.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parsed.content_blocks.some((b: any) => b.type === 'server_tool_use')).toBe(false);
    expect(findTasks(out).some((t) => t.agent === 'server_tool_use' || t.agent === 'web_search')).toBe(false);
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
          { type: 'toolCall', id: 'tc2', name: 'ExecuteQuery', arguments: { query: 'select 1' } },
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

  it('v2-native server tool names pass through unchanged to the UI', () => {
    // After ExecuteSQL→ExecuteQuery and a first-class ListDBConnections
    // display, every v2 tool name now matches the UI dispatch keys
    // directly — no rename layer needed in the translator.
    const log: ConversationLog = [
      rootInvocation({ id: 'r1', userMessage: 'q' }),
      assistantMessage({
        parentAgentId: 'r1',
        toolCalls: [
          {
            type: 'toolCall',
            id: 'tcQ',
            name: 'ExecuteQuery',
            arguments: { query: 'select 1', connectionId: 'default_duckdb' },
          },
          { type: 'toolCall', id: 'tcList', name: 'ListDBConnections', arguments: {} },
        ],
        stopReason: 'toolUse',
      }),
    ];
    const out = piLogToLegacy(log);
    const qTask = taskById(out, 'tcQ')!;
    expect(qTask.agent).toBe('ExecuteQuery');
    expect(qTask.args).toEqual({ query: 'select 1', connectionId: 'default_duckdb' });
    const listTask = taskById(out, 'tcList')!;
    expect(listTask.agent).toBe('ListDBConnections');
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

// ─── legacyToolResultToPi: reverse for resume ────────────────────────

describe('legacyToolResultToPi — reverse mapping for orchestrator resume', () => {
  it('basic: tool_call_id → toolCallId, string content → [{type:text,text}]', () => {
    const legacy: CompletedToolCallResult = {
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
    const legacy: CompletedToolCallResult = {
      role: 'tool',
      tool_call_id: 'tc1',
      content: { rows: [{ id: 1 }], columns: ['id'] },
      run_id: 'run-1',
      function: { name: 'ExecuteQuery', arguments: {} },
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
    const legacy: CompletedToolCallResult = {
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
    const legacy: CompletedToolCallResult = {
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
    const legacy: CompletedToolCallResult = {
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

  // ─── image blocks must survive the round-trip (chart-image presentation) ───
  // ReadFiles/ExecuteQuery/EditFile attach an OpenAI-style `image_url` block to their content when
  // a renderable chart is presented as an image. Collapsing the whole content array into one
  // JSON.stringify'd text block (the old behavior) destroyed the image before the projection's
  // `origNonText` pass could preserve it — so the rendered chart never reached the LLM.
  it('preserves an image_url block as an orchestrator image block (not stringified into text)', () => {
    const legacy: CompletedToolCallResult = {
      role: 'tool',
      tool_call_id: 'tc1',
      content: [
        { type: 'text', text: '{"success":true}' },
        { type: 'image_url', image_url: { url: 'https://s3/chart.jpg' } },
      ] as unknown as CompletedToolCallResult['content'],
      run_id: 'run-1',
      function: { name: 'ReadFiles', arguments: {} },
      created_at: '2025-01-01T00:00:00Z',
    };
    const out = legacyToolResultToPi(legacy);
    expect(out.content).toContainEqual({ type: 'text', text: '{"success":true}' });
    expect(out.content).toContainEqual({ type: 'image', url: 'https://s3/chart.jpg' });
    // exactly one image block, preserved (not buried in a stringified text block)
    expect(out.content.filter((c): c is ImageContent => c.type === 'image')).toHaveLength(1);
  });

  it('SPLITS an image_url with a data: URL into {data, mimeType} (provider needs the MIME)', () => {
    const legacy: CompletedToolCallResult = {
      role: 'tool',
      tool_call_id: 'tc1',
      content: [
        { type: 'text', text: '{"success":true}' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
      ] as unknown as CompletedToolCallResult['content'],
      run_id: 'run-1',
      function: { name: 'ExecuteQuery', arguments: {} },
      created_at: '2025-01-01T00:00:00Z',
    };
    const out = legacyToolResultToPi(legacy);
    expect(out.content).toContainEqual({ type: 'image', mimeType: 'image/jpeg', data: 'QUJD' });
  });

  it('passes an existing orchestrator image block ({type:image,url}) through unchanged', () => {
    const legacy: CompletedToolCallResult = {
      role: 'tool',
      tool_call_id: 'tc1',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'image', url: 'https://s3/x.jpg' },
      ] as unknown as CompletedToolCallResult['content'],
      run_id: 'run-1',
      function: { name: 'ReadFiles', arguments: {} },
      created_at: '2025-01-01T00:00:00Z',
    };
    const out = legacyToolResultToPi(legacy);
    expect(out.content).toContainEqual({ type: 'image', url: 'https://s3/x.jpg' });
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

  it('thinking content preserves signature when orchestrator provides one', () => {
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

  it('multi-block ordering matches orchestrator content order (thinking, text, toolCall)', () => {
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
    // thinking block first (orchestrator content order), then text — toolCall is its
    // own task entry, not part of content_blocks.
    expect(blocks.map((b) => b.type)).toEqual(['thinking', 'text']);
  });
});

