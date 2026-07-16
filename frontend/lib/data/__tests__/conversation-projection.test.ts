/**
 * Conversations V2 — display projection unit tests (see /conversations-v2.md).
 * The projection shrinks entries for the wire but must never change count, ids, or kinds.
 */
import {
  projectLogEntryForDisplay,
  projectMessageRowForDisplay,
  extractToolResultImage,
  screenshotUrlFor,
  DISPLAY_DETAILS_CAP_CHARS,
  DISPLAY_UNKNOWN_CONTENT_CAP_CHARS,
  parseConversationView,
} from '@/lib/data/conversation-projection';
import type { MessageRow } from '@/lib/data/conversations.types';
import type { ConversationLogEntry } from '@/orchestrator/types';
import {
  fixtureLog,
  rootInvocation,
  assistantWithToolCall,
  editFileResult,
  searchFilesResult,
  searchFilesPayload,
  executeQueryResult,
  unknownToolResult,
  erroredEditFileResult,
} from './projection-fixtures';

type AnyEntry = Record<string, any>;

const project = (e: ConversationLogEntry) => projectLogEntryForDisplay(e) as AnyEntry;

describe('parseConversationView', () => {
  it("defaults to 'display' for null/undefined/garbage, 'full' only for exact 'full'", () => {
    expect(parseConversationView(null)).toBe('display');
    expect(parseConversationView(undefined)).toBe('display');
    expect(parseConversationView('display')).toBe('display');
    expect(parseConversationView('FULL')).toBe('display');
    expect(parseConversationView('full')).toBe('full');
  });
});

describe('projectLogEntryForDisplay', () => {
  it('preserves entry identity: id/parent_id/kind fields and never drops entries', () => {
    const projected = fixtureLog.map(project);
    expect(projected).toHaveLength(fixtureLog.length);
    projected.forEach((p, i) => {
      const orig = fixtureLog[i] as AnyEntry;
      expect(p.id).toBe(orig.id);
      expect(p.parent_id).toBe(orig.parent_id);
      expect(p.type ?? p.role).toBe(orig.type ?? orig.role);
      expect(p.timestamp).toBe(orig.timestamp);
      expect(p.toolCallId).toBe(orig.toolCallId);
      expect(p.toolName).toBe(orig.toolName);
    });
  });

  it('never mutates its input', () => {
    const snapshot = JSON.parse(JSON.stringify(fixtureLog));
    fixtureLog.forEach(project);
    expect(JSON.parse(JSON.stringify(fixtureLog))).toEqual(snapshot);
  });

  it('agent invocation: keeps arguments, strips context to currentTime + attachments only', () => {
    const p = project(rootInvocation);
    expect(p.arguments).toEqual({ userMessage: 'polish the story' });
    expect(Object.keys(p.context).sort()).toEqual(['attachments', 'currentTime']);
    expect(p.context.currentTime).toBe('2026-07-16T00:00:00Z');
    expect(p.context.attachments).toEqual([{ type: 'image', url: 'https://example.com/a.jpg' }]);
  });

  it('assistant: keeps all content blocks (thinking, text, toolCall args); drops usage + diagnostics', () => {
    const p = project(assistantWithToolCall);
    expect(p.content).toEqual((assistantWithToolCall as AnyEntry).content);
    expect(p.stopReason).toBe('toolUse');
    expect(p.usage).toBeUndefined();
    expect(p.diagnostics).toBeUndefined();
  });

  it('details-only tool (EditFile): drops content; keeps details minus __status; caps diff', () => {
    const p = project(editFileResult);
    expect(p.content).toEqual([]);
    expect(p.details.__status).toBeUndefined();
    expect(p.details.diff.length).toBeLessThanOrEqual(DISPLAY_DETAILS_CAP_CHARS);
    expect(p.details.diff.startsWith('ddd')).toBe(true);
    expect(p.details.screenshotUrl).toBe((editFileResult as AnyEntry).details.screenshotUrl);
    expect(p.details.success).toBe(true);
    expect(p.details.__augmented).toEqual({ rubric: 'ok' });
  });

  it('details-only tool (ExecuteQuery): drops the LLM markdown, keeps details.queryResult', () => {
    const p = project(executeQueryResult);
    expect(p.content).toEqual([]);
    expect(p.details.queryResult).toEqual((executeQueryResult as AnyEntry).details.queryResult);
  });

  it('derive-details tool (SearchFiles): derives details from the JSON result text, drops content', () => {
    const p = project(searchFilesResult);
    expect(p.content).toEqual([]);
    expect(p.details).toEqual(searchFilesPayload);
  });

  it('derive-details tool keeps existing details when the entry already has them', () => {
    const withDetails = {
      ...(searchFilesResult as AnyEntry),
      details: { success: true, selection: ['a'] },
    } as unknown as ConversationLogEntry;
    const p = project(withDetails);
    expect(p.details).toEqual({ success: true, selection: ['a'] });
    expect(p.content).toEqual([]);
  });

  it('unknown tool: keeps details, caps text content, drops image blocks', () => {
    const p = project(unknownToolResult);
    expect(p.details).toEqual({ success: true });
    const texts = p.content.filter((b: AnyEntry) => b.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0].text.length).toBeLessThanOrEqual(DISPLAY_UNKNOWN_CONTENT_CAP_CHARS);
    expect(p.content.some((b: AnyEntry) => b.type === 'image' || b.type === 'image_url')).toBe(false);
  });

  it('errored tool result: keeps the error text (capped), drops image blocks', () => {
    const p = project(erroredEditFileResult);
    const texts = p.content.filter((b: AnyEntry) => b.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toContain('edit failed');
    expect(p.content.some((b: AnyEntry) => b.type === 'image')).toBe(false);
    expect(p.details.success).toBe(false);
  });

  it('is idempotent: projecting a projected entry is a no-op', () => {
    for (const entry of fixtureLog) {
      const once = projectLogEntryForDisplay(entry);
      const twice = projectLogEntryForDisplay(once);
      expect(JSON.parse(JSON.stringify(twice))).toEqual(JSON.parse(JSON.stringify(once)));
    }
  });

  it('shrinks the fixture log by more than 70% (what remains is the rendered screenshot + capped diff)', () => {
    const before = JSON.stringify(fixtureLog).length;
    const after = JSON.stringify(fixtureLog.map(project)).length;
    expect(after).toBeLessThan(before * 0.3);
  });
});

describe('lazy screenshot URLs (projection target)', () => {
  const target = { conversationId: 9, mode: 'tutorial' };

  it('rewrites an inline data: screenshotUrl to the lazy endpoint URL', () => {
    const p = projectLogEntryForDisplay(editFileResult, target) as AnyEntry;
    expect(p.details.screenshotUrl).toBe(screenshotUrlFor(target, 'tc-edit-1'));
    expect(p.details.screenshotUrl).toBe('/api/conversations/9/screenshots/tc-edit-1?mode=tutorial');
    expect(p.details.diff).toBeDefined(); // rest of details untouched
  });

  it('without a target, the inline data: URI is kept', () => {
    const p = project(editFileResult);
    expect(p.details.screenshotUrl.startsWith('data:')).toBe(true);
  });

  it('leaves a non-data (remote) screenshotUrl untouched', () => {
    const remote = {
      ...(editFileResult as AnyEntry),
      details: { ...(editFileResult as AnyEntry).details, screenshotUrl: 'https://cdn.example.com/shot.jpg' },
    } as unknown as ConversationLogEntry;
    const p = projectLogEntryForDisplay(remote, target) as AnyEntry;
    expect(p.details.screenshotUrl).toBe('https://cdn.example.com/shot.jpg');
  });

  it('is idempotent: reprojecting keeps the rewritten URL', () => {
    const once = projectLogEntryForDisplay(editFileResult, target);
    const twice = projectLogEntryForDisplay(once, target) as AnyEntry;
    expect(twice.details.screenshotUrl).toBe(screenshotUrlFor(target, 'tc-edit-1'));
  });

  it('is generic across tool names (any toolResult declaring a data: screenshotUrl)', () => {
    const mystery = {
      ...(unknownToolResult as AnyEntry),
      details: { success: true, screenshotUrl: 'data:image/png;base64,QUJD' },
    } as unknown as ConversationLogEntry;
    const p = projectLogEntryForDisplay(mystery, target) as AnyEntry;
    expect(p.details.screenshotUrl).toBe(screenshotUrlFor(target, 'tc-mystery-1'));
  });
});

describe('extractToolResultImage — first image block in the tool call response', () => {
  it('finds a pi image block ({type:image, data, mimeType})', () => {
    const img = extractToolResultImage(editFileResult);
    expect(img).not.toBeNull();
    expect(img!.mimeType).toBe('image/jpeg');
    expect(img!.base64).toBe('i'.repeat(60_000));
  });

  it('finds an image_url block whose url is a data: URI', () => {
    const entry = {
      role: 'toolResult', toolCallId: 'tc-x', toolName: 'Whatever', isError: false, timestamp: 1, parent_id: null,
      content: [
        { type: 'text', text: 'ok' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJDRA==' } },
      ],
    } as unknown as ConversationLogEntry;
    expect(extractToolResultImage(entry)).toEqual({ mimeType: 'image/png', base64: 'QUJDRA==' });
  });

  it('never reads details — only the response content', () => {
    const entry = {
      role: 'toolResult', toolCallId: 'tc-y', toolName: 'Whatever', isError: false, timestamp: 1, parent_id: null,
      content: [{ type: 'text', text: 'no image here' }],
      details: { screenshotUrl: 'data:image/png;base64,QUJD' },
    } as unknown as ConversationLogEntry;
    expect(extractToolResultImage(entry)).toBeNull();
  });

  it('returns null for image-less results and non-toolResult entries', () => {
    expect(extractToolResultImage(searchFilesResult)).toBeNull();
    expect(extractToolResultImage(rootInvocation)).toBeNull();
    expect(extractToolResultImage(assistantWithToolCall)).toBeNull();
  });
});

describe('projectMessageRowForDisplay', () => {
  const baseRow = {
    id: 1, conversationId: 9, seq: 0, kind: 'toolCall', piId: 'root-1',
    parentPiId: null, createdAt: '2026-07-16T00:00:00Z',
  };

  it('projects pi rows through projectLogEntryForDisplay', () => {
    const row = { ...baseRow, content: rootInvocation } as MessageRow;
    const p = projectMessageRowForDisplay(row) as AnyEntry;
    expect(Object.keys(p.content.context).sort()).toEqual(['attachments', 'currentTime']);
    expect(p.seq).toBe(0);
  });

  it("passes kind='error' rows through unchanged", () => {
    const errRow = {
      ...baseRow, seq: null, kind: 'error',
      content: { source: 'session', message: 'boom' },
    } as unknown as MessageRow;
    expect(projectMessageRowForDisplay(errRow)).toBe(errRow);
  });
});
