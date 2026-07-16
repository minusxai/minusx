/**
 * Shared fixtures for the Conversations V2 display projection tests (see /conversations-v2.md).
 * Shapes mirror real stored pi log entries: a root agent invocation with a heavy `context`,
 * an assistant turn with usage + tool calls, and toolResults of each projection class.
 */
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';

export const big = (n: number, ch = 'x') => ch.repeat(n);

const usage = {
  input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, totalTokens: 1200,
  cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
};

/** Root agent invocation (user turn) — heavy dev-only context around a tiny userMessage. */
export const rootInvocation = {
  type: 'toolCall',
  id: 'root-1',
  parent_id: null,
  name: 'WebAnalystAgent',
  arguments: { userMessage: 'polish the story' },
  context: {
    currentTime: '2026-07-16T00:00:00Z',
    attachments: [{ type: 'image', url: 'https://example.com/a.jpg' }],
    appState: { type: 'file', state: { fileState: big(50_000) } },
    resolvedContextDocs: big(20_000, 'r'),
    schema: { tables: [big(1_000, 't')] },
    whitelistedTables: 'a.b,c.d',
    mode: 'org',
    userId: 7,
    agentName: 'minusx',
  },
} as unknown as ConversationLogEntry;

/** Assistant turn: thinking + reply text + an EditFile tool call; carries usage + diagnostics. */
export const assistantWithToolCall = {
  role: 'assistant',
  parent_id: 'root-1',
  content: [
    { type: 'thinking', thinking: 'let me edit the header' },
    { type: 'text', text: 'Editing the story now.' },
    { type: 'toolCall', id: 'tc-edit-1', name: 'EditFile', arguments: { file_id: 12, edits: 'small edit' } },
  ],
  api: 'anthropic',
  provider: 'anthropic',
  model: 'claude-test',
  usage,
  diagnostics: [{ requestDump: big(5_000, 'q') }],
  stopReason: 'toolUse',
  timestamp: 1752600000000,
} as unknown as ConversationLogEntry;

/** EditFile result — details-only tool: big text echo + inline base64 image in content. */
export const editFileResult = {
  role: 'toolResult',
  toolCallId: 'tc-edit-1',
  toolName: 'EditFile',
  parent_id: 'root-1',
  isError: false,
  timestamp: 1752600001000,
  content: [
    { type: 'text', text: big(40_000, 's') },
    { type: 'image', data: big(60_000, 'i'), mimeType: 'image/jpeg' },
  ],
  details: {
    success: true,
    diff: big(40_000, 'd'),
    __status: big(30_000, 'u'),
    __augmented: { rubric: 'ok' },
    screenshotUrl: `data:image/jpeg;base64,${big(60_000, 'i')}`,
  },
} as unknown as ConversationLogEntry;

export const searchFilesPayload = { success: true, files: [{ id: 1, name: 'Revenue', type: 'question' }] };

/** SearchFiles result — derive-details tool: display data only exists as JSON result text. */
export const searchFilesResult = {
  role: 'toolResult',
  toolCallId: 'tc-search-1',
  toolName: 'SearchFiles',
  parent_id: 'root-1',
  isError: false,
  timestamp: 1752600002000,
  content: [{ type: 'text', text: JSON.stringify(searchFilesPayload) }],
} as unknown as ConversationLogEntry;

/** ExecuteQuery result — LLM markdown in content, chart-card data in details.queryResult. */
export const executeQueryResult = {
  role: 'toolResult',
  toolCallId: 'tc-query-1',
  toolName: 'ExecuteQuery',
  parent_id: 'root-1',
  isError: false,
  timestamp: 1752600003000,
  content: [{ type: 'text', text: big(90_000, 'm') }],
  details: { success: true, queryResult: { columns: ['a'], types: ['number'], data: [[1]], totalRows: 1 } },
} as unknown as ConversationLogEntry;

/** Unknown tool — conservative: keep details, cap content. */
export const unknownToolResult = {
  role: 'toolResult',
  toolCallId: 'tc-mystery-1',
  toolName: 'MysteryTool',
  parent_id: 'root-1',
  isError: false,
  timestamp: 1752600004000,
  content: [{ type: 'text', text: big(20_000, 'z') }],
  details: { success: true },
} as unknown as ConversationLogEntry;

/** Failed tool result — error text must survive (capped); images still dropped. */
export const erroredEditFileResult = {
  role: 'toolResult',
  toolCallId: 'tc-edit-err-1',
  toolName: 'EditFile',
  parent_id: 'root-1',
  isError: true,
  timestamp: 1752600005000,
  content: [
    { type: 'text', text: 'edit failed: markup invalid at line 3' },
    { type: 'image', data: big(10_000, 'e'), mimeType: 'image/jpeg' },
  ],
  details: { success: false, diff: '' },
} as unknown as ConversationLogEntry;

/** A full log in a plausible order, for count/id-preservation + route tests. */
export const fixtureLog: ConversationLog = [
  rootInvocation,
  assistantWithToolCall,
  editFileResult,
  searchFilesResult,
  executeQueryResult,
  unknownToolResult,
  erroredEditFileResult,
];
