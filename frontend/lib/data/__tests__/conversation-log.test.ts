// Pure pi-log <-> messages-row mapping. The DB stores one row per pi entry (content verbatim);
// these helpers must round-trip losslessly and derive kind/pi_id/parent_pi_id correctly, since both
// the orchestrator persistence boundary and the backfill migration depend on them.
import { describe, it, expect } from 'vitest';
import {
  entryKind, entryPiId, entryParentPiId, entriesToInserts, rowsToLog, derivePendingToolCalls,
} from '../conversation-log';
import type { ConversationLog } from '@/orchestrator/types';

const LOG = [
  { type: 'toolCall', id: 'root1', name: 'WebAnalystAgent', parent_id: null,
    arguments: { userMessage: 'hi' }, context: { appState: { type: 'file' } } },
  { role: 'assistant', parent_id: 'root1', content: [{ type: 'text', text: 'one sec' }],
    stopReason: 'toolUse', model: 'm', timestamp: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
  { role: 'toolResult', parent_id: 'root1', toolCallId: 'tc1', toolName: 'ReadFiles',
    content: [{ type: 'text', text: '{}' }], isError: false, timestamp: 2 },
] as unknown as ConversationLog;

describe('entryKind / entryPiId / entryParentPiId', () => {
  it('classifies each pi entry shape', () => {
    expect(LOG.map(entryKind)).toEqual(['toolCall', 'assistant', 'toolResult']);
  });
  it('extracts the pi id (anchor) and parent_id', () => {
    expect(LOG.map(entryPiId)).toEqual(['root1', null, null]);
    expect(LOG.map(entryParentPiId)).toEqual([null, 'root1', 'root1']);
  });
});

describe('entriesToInserts', () => {
  it('numbers rows from startSeq and carries the entry verbatim + derived columns', () => {
    const inserts = entriesToInserts(LOG, 0);
    expect(inserts.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(inserts.map((r) => r.kind)).toEqual(['toolCall', 'assistant', 'toolResult']);
    expect(inserts[0].piId).toBe('root1');
    expect(inserts[1].parentPiId).toBe('root1');
    expect(inserts[0].content).toBe(LOG[0]); // verbatim, not a copy
  });

  it('offsets seq for an incremental append (startSeq = current length)', () => {
    const inserts = entriesToInserts(LOG.slice(1), 5);
    expect(inserts.map((r) => r.seq)).toEqual([5, 6]);
  });
});

describe('rowsToLog', () => {
  it('round-trips: entriesToInserts -> rows -> rowsToLog === original log', () => {
    const rows = entriesToInserts(LOG, 0).map((r) => ({ content: r.content }));
    expect(rowsToLog(rows)).toEqual(LOG);
  });
});

describe('derivePendingToolCalls', () => {
  it('returns assistant toolCalls with no matching toolResult (the pending frontend tools)', () => {
    const log = [
      { type: 'toolCall', id: 'root', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'go' }, context: {} },
      { role: 'assistant', parent_id: 'root', content: [
        { type: 'text', text: 'working' },
        { type: 'toolCall', id: 'srv1', name: 'ReadFiles', arguments: { fileIds: [1] } },
        { type: 'toolCall', id: 'fe1', name: 'Navigate', arguments: { fileId: 9 } },
      ] },
      { role: 'toolResult', parent_id: 'root', toolCallId: 'srv1', toolName: 'ReadFiles', content: [], isError: false },
    ] as unknown as ConversationLog;

    const pending = derivePendingToolCalls(log);
    expect(pending).toEqual([{ id: 'fe1', name: 'Navigate', arguments: { fileId: 9 } }]);
  });

  it('returns nothing when every toolCall is answered', () => {
    const log = [
      { role: 'assistant', parent_id: 'root', content: [{ type: 'toolCall', id: 'a', name: 'ReadFiles', arguments: {} }] },
      { role: 'toolResult', parent_id: 'root', toolCallId: 'a', toolName: 'ReadFiles', content: [], isError: false },
    ] as unknown as ConversationLog;
    expect(derivePendingToolCalls(log)).toEqual([]);
  });
});
